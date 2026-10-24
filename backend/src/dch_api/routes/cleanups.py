from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from dch_api import ratelimit
from dch_api.db.models import Cleanup, FindingRow
from dch_api.deps import RunnerDep, SessionDep, SettingsDep, client_ip, require_scan
from dch_api.jobs.runner import Job
from dch_api.schemas import CleanupCreate, CleanupCreated, CleanupView
from dch_api.services.scans import claim, mark_stale

router = APIRouter(prefix="/api", tags=["cleanups"])


def require_cleanup(session: SessionDep, cleanup_id: str) -> Cleanup:
    cleanup = session.get(Cleanup, cleanup_id)
    if cleanup is None:
        raise HTTPException(404, "Cleanup not found")
    return cleanup


@router.post("/scans/{scan_id}/cleanups", response_model=CleanupCreated, status_code=201)
def post_cleanup(
    scan_id: str, body: CleanupCreate, request: Request, session: SessionDep, settings: SettingsDep
):
    require_scan(session, scan_id, done=True)
    ids = {s.finding_id for s in body.selections}
    known = set(
        session.scalars(select(FindingRow.id).where(FindingRow.scan_id == scan_id, FindingRow.id.in_(ids)))
    )
    if unknown := sorted(ids - known):
        raise HTTPException(422, f"Unknown finding id: {unknown[0]}")
    ratelimit.hit(session, f"{client_ip(request)}:cleanup", settings.scan_rate_limit_per_hour)
    cleanup = Cleanup(
        scan_id=scan_id,
        selections=[{"finding_id": s.finding_id, "action": s.action} for s in body.selections],
    )
    session.add(cleanup)
    session.flush()
    return CleanupCreated(cleanup_id=cleanup.id)


@router.post("/cleanups/{cleanup_id}/run", response_model=CleanupView)
async def run_cleanup_job(cleanup_id: str, session: SessionDep, runner: RunnerDep):
    require_cleanup(session, cleanup_id)
    if not claim(session, Cleanup, cleanup_id):
        raise HTTPException(409, "This cleanup is already running or finished")
    await runner.run(Job("cleanup", cleanup_id))
    session.expire_all()
    return CleanupView.model_validate(require_cleanup(session, cleanup_id), from_attributes=True)


@router.get("/cleanups/{cleanup_id}", response_model=CleanupView)
def get_cleanup(cleanup_id: str, session: SessionDep, settings: SettingsDep):
    cleanup = require_cleanup(session, cleanup_id)
    mark_stale(cleanup, settings.stale_job_timeout_s)
    return CleanupView.model_validate(cleanup, from_attributes=True)


def download(text: str | None, media_type: str, filename: str) -> Response:
    if text is None:
        raise HTTPException(409, "The cleanup has not finished")
    return Response(
        text.encode("utf-8"),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/cleanups/{cleanup_id}/patch")
def get_patch(cleanup_id: str, session: SessionDep):
    return download(require_cleanup(session, cleanup_id).patch, "text/x-diff", "dead-code-cleanup.patch")


@router.get("/cleanups/{cleanup_id}/report")
def get_report(cleanup_id: str, session: SessionDep):
    return download(require_cleanup(session, cleanup_id).report_md, "text/markdown", "CLEANUP_REPORT.md")
