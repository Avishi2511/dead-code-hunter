from __future__ import annotations

import logging

from sqlalchemy import select, update

from dch.cleanup.engine import run_cleanup
from dch.result import ScanResult, Selection
from dch.source.base import SourceTree
from dch_api.db.models import Cleanup, FileRow, Scan, utcnow
from dch_api.db.session import Database
from dch_api.services.scans import fail, load_findings
from dch_api.settings import Settings

logger = logging.getLogger(__name__)


def run_cleanup_job(db: Database, settings: Settings, cleanup_id: str) -> None:
    """Rebuild the scanned tree from the database and produce the diff, patch and report."""
    try:
        with db.session() as session:
            cleanup = session.get(Cleanup, cleanup_id)
            scan = session.get(Scan, cleanup.scan_id)
            selections = [Selection.model_validate(s) for s in cleanup.selections]
            files = dict(
                session.execute(select(FileRow.path, FileRow.content).where(FileRow.scan_id == scan.id)).all()
            )
            repo = scan.repo_url.removeprefix("https://github.com/")
            tree = SourceTree(repo, files, scan.commit_sha, prefix=scan.project_root)
            scan_result = ScanResult(
                repo=repo, commit_sha=scan.commit_sha, findings=load_findings(session, scan.id)
            )
        result = run_cleanup(tree, scan_result, selections, time_budget_s=settings.scan_time_budget_s)
        with db.session() as session:
            session.execute(
                update(Cleanup)
                .where(Cleanup.id == cleanup_id)
                .values(
                    status="done",
                    diff=result.diff,
                    patch=result.patch,
                    report_md=result.report_md,
                    summary=result.summary.model_dump(mode="json"),
                    validation=result.validation.model_dump(mode="json"),
                    last_progress_at=utcnow(),
                )
            )
    except Exception:
        logger.exception("Cleanup %s failed", cleanup_id)
        fail(db, Cleanup, cleanup_id, "The cleanup failed unexpectedly. Try again.")
