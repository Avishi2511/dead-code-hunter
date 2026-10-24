from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from dch.result import Finding
from dch_api import ratelimit
from dch_api.db.models import FileRow, FindingRow, Scan
from dch_api.deps import RunnerDep, SessionDep, SettingsDep, client_ip, require_scan
from dch_api.jobs.runner import Job
from dch_api.schemas import (
    CodeExcerpt,
    FileView,
    FindingDetail,
    FindingList,
    FindingSummary,
    GraphView,
    ScanCreate,
    ScanCreated,
    ScanView,
)
from dch_api.services import graph_queries
from dch_api.services.github_url import InvalidRepo, parse_repo
from dch_api.services.scans import claim, create_scan, load_findings, load_graph, mark_stale

router = APIRouter(prefix="/api/scans", tags=["scans"])

EXCERPT_CONTEXT = 5
EXCERPT_MAX_LINES = 80


def scan_view(scan: Scan) -> ScanView:
    return ScanView.model_validate(scan, from_attributes=True)


def covered_by(findings: list[Finding]) -> dict[str, str]:
    return {cid: f.id for f in findings if f.suggestion for cid in f.suggestion.contains_ids}


@router.post("", response_model=ScanCreated, status_code=201)
def post_scan(body: ScanCreate, request: Request, session: SessionDep, settings: SettingsDep):
    try:
        spec = parse_repo(body.repo_url, body.ref, body.subdir)
    except InvalidRepo as exc:
        raise HTTPException(422, str(exc)) from exc
    ratelimit.hit(session, f"{client_ip(request)}:create", settings.scan_rate_limit_per_hour)
    return ScanCreated(scan_id=create_scan(session, spec).id)


@router.post("/{scan_id}/run", response_model=ScanView)
async def run_scan_job(scan_id: str, session: SessionDep, runner: RunnerDep):
    require_scan(session, scan_id)
    if not claim(session, Scan, scan_id):
        raise HTTPException(409, "This scan is already running or finished")
    await runner.run(Job("scan", scan_id))
    session.expire_all()
    return scan_view(require_scan(session, scan_id))


@router.get("/{scan_id}", response_model=ScanView)
def get_scan(scan_id: str, session: SessionDep, settings: SettingsDep):
    scan = require_scan(session, scan_id)
    mark_stale(scan, settings.stale_job_timeout_s)
    return scan_view(scan)


@router.get("/{scan_id}/findings", response_model=FindingList)
def list_findings(
    scan_id: str,
    session: SessionDep,
    type: str | None = None,
    level: Literal["high", "medium", "low"] | None = None,
    q: str | None = None,
    path: str | None = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = 1000,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    require_scan(session, scan_id)
    findings = load_findings(session, scan_id)
    covered = covered_by(findings)
    needle, prefix = (q or "").lower(), path or ""
    matched = [
        f
        for f in findings
        if (not type or f.type == type)
        and (not level or f.level == level)
        and (not needle or needle in f.name.lower() or needle in f.file.lower())
        and (not prefix or f.file.startswith(prefix))
    ]
    items = [
        FindingSummary(
            **f.model_dump(include=set(FindingSummary.model_fields)),
            static_check=f.suggestion.static_check if f.suggestion else None,
            manual=bool(f.suggestion and f.suggestion.manual),
            covered_by=covered.get(f.id),
        )
        for f in matched[offset : offset + limit]
    ]
    return FindingList(total=len(matched), items=items)


@router.get("/{scan_id}/findings/{finding_id}", response_model=FindingDetail)
def get_finding(scan_id: str, finding_id: str, session: SessionDep):
    require_scan(session, scan_id)
    findings = load_findings(session, scan_id)
    finding = next((f for f in findings if f.id == finding_id), None)
    if finding is None:
        raise HTTPException(404, "Finding not found")
    return FindingDetail(
        **finding.model_dump(),
        excerpt=excerpt(session, scan_id, finding),
        covered_by=covered_by(findings).get(finding.id),
    )


def excerpt(session: Session, scan_id: str, finding: Finding) -> CodeExcerpt | None:
    content = session.scalar(
        select(FileRow.content).where(FileRow.scan_id == scan_id, FileRow.path == finding.file)
    )
    if content is None:
        return None
    lines = content.splitlines()
    start = max(1, finding.line - EXCERPT_CONTEXT)
    end = min(len(lines), finding.end_line + EXCERPT_CONTEXT, start + EXCERPT_MAX_LINES - 1)
    return CodeExcerpt(
        start_line=start,
        lines=lines[start - 1 : end],
        highlight_start=finding.line,
        highlight_end=min(finding.end_line, end),
    )


@router.get("/{scan_id}/graph", response_model=GraphView)
def get_graph(
    scan_id: str,
    session: SessionDep,
    focus: Annotated[list[str] | None, Query()] = None,
    hops: Annotated[int, Query(ge=0, le=4)] = 2,
    view: Literal["neighborhood", "modules"] = "neighborhood",
):
    require_scan(session, scan_id, done=True)
    graph = load_graph(session, scan_id)
    if graph is None:
        raise HTTPException(404, "No graph stored for this scan")
    if view == "modules":
        per_file = dict(session.execute(_findings_per_file(scan_id)).all())
        return graph_queries.module_projection(graph, per_file)
    if not focus:
        raise HTTPException(422, "Pass at least one focus node id, or view=modules")
    try:
        return graph_queries.neighborhood(graph, focus, hops)
    except graph_queries.UnknownNode as exc:
        raise HTTPException(404, f"Unknown graph node: {exc.args[0]}") from exc


def _findings_per_file(scan_id: str):  # noqa: ANN202
    return (
        select(FindingRow.file, func.count()).where(FindingRow.scan_id == scan_id).group_by(FindingRow.file)
    )


@router.get("/{scan_id}/files", response_model=FileView)
def get_file(scan_id: str, session: SessionDep, path: str):
    require_scan(session, scan_id)
    content = session.scalar(select(FileRow.content).where(FileRow.scan_id == scan_id, FileRow.path == path))
    if content is None:
        raise HTTPException(404, "File not found")
    return FileView(path=path, content=content)
