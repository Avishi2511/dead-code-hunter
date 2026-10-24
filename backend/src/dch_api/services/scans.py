from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from dch.result import Finding, GraphData, ScanResult
from dch.scan import scan_tree
from dch.source.base import GitHubTarballSource, Limits, SourceError, SourceTree
from dch_api.db.models import Cleanup, FileRow, FindingRow, GraphRow, Scan, utcnow
from dch_api.db.session import Database
from dch_api.services.github_url import RepoSpec, parse_repo
from dch_api.settings import Settings

logger = logging.getLogger(__name__)

SourceFactory = Callable[[RepoSpec, Settings], SourceTree]


def github_source(spec: RepoSpec, settings: Settings) -> SourceTree:
    return GitHubTarballSource(
        spec.owner,
        spec.name,
        ref=spec.ref,
        subdir=spec.subdir,
        token=settings.github_token,
        limits=Limits(max_py_files=settings.max_py_files, max_tarball_mb=settings.max_tarball_mb),
    ).load()


def aware(moment: datetime) -> datetime:
    """SQLite hands back naive datetimes; everything we store is UTC."""
    return moment if moment.tzinfo else moment.replace(tzinfo=utcnow().tzinfo)


def mark_stale(row: Scan | Cleanup, timeout_s: int) -> None:
    """A job whose function was killed never reports back; fail it once progress stalls."""
    if row.status == "running" and utcnow() - aware(row.last_progress_at) > timedelta(seconds=timeout_s):
        row.status = "failed"
        row.error = "The job stopped responding (it was probably cut off by a time limit). Try again."
        if isinstance(row, Scan):
            row.finished_at = utcnow()


def create_scan(session: Session, spec: RepoSpec) -> Scan:
    scan = Scan(repo_url=spec.url, ref=spec.ref, subdir=spec.subdir)
    session.add(scan)
    session.flush()
    return scan


def claim(session: Session, model: type[Scan] | type[Cleanup], row_id: str) -> bool:
    """Atomically move a pending (or failed, i.e. retried) job to running: one active job per row."""
    values: dict = {"status": "running", "error": None, "last_progress_at": utcnow()}
    if model is Scan:
        values |= {"stage": "downloading", "progress": 0, "finished_at": None}
    result = session.execute(
        update(model).where(model.id == row_id, model.status.in_(("pending", "failed"))).values(**values)
    )
    session.commit()
    return result.rowcount == 1


def _progress(db: Database, scan_id: str) -> Callable[[str, int, str], None]:
    def report(stage: str, percent: int, message: str) -> None:
        with db.session() as session:
            session.execute(
                update(Scan)
                .where(Scan.id == scan_id)
                .values(stage=stage, progress=percent, last_progress_at=utcnow())
            )

    return report


def run_scan(db: Database, settings: Settings, source_factory: SourceFactory, scan_id: str) -> None:
    """Execute a claimed scan and persist everything the read endpoints need."""
    try:
        with db.session() as session:
            scan = session.get(Scan, scan_id)
            spec = parse_repo(scan.repo_url, scan.ref, scan.subdir)
        report = _progress(db, scan_id)
        report("downloading", 3, f"Downloading {spec.owner}/{spec.name}")
        tree = source_factory(spec, settings)
        result = scan_tree(
            tree,
            reporter=report,
            include_graph=True,
            verifier=settings.verifier,
            time_budget_s=settings.scan_time_budget_s,
        )
        store_result(db, scan_id, tree, result)
    except SourceError as exc:
        fail(db, Scan, scan_id, str(exc))
    except Exception:
        logger.exception("Scan %s failed", scan_id)
        fail(db, Scan, scan_id, "The scan failed unexpectedly. Try again or pick another repository.")


def fail(db: Database, model: type[Scan] | type[Cleanup], row_id: str, message: str) -> None:
    values: dict = {"status": "failed", "error": message}
    if model is Scan:
        values["finished_at"] = utcnow()
    with db.session() as session:
        session.execute(update(model).where(model.id == row_id).values(**values))


def store_result(db: Database, scan_id: str, tree: SourceTree, result: ScanResult) -> None:
    with db.session() as session:
        for model in (FindingRow, GraphRow, FileRow):
            session.execute(delete(model).where(model.scan_id == scan_id))
        session.add_all(
            FindingRow(
                scan_id=scan_id,
                **f.model_dump(mode="json", exclude={"suggestion"}),
                suggestion=f.suggestion.model_dump(mode="json") if f.suggestion else None,
            )
            for f in result.findings
        )
        if result.graph:
            graph = result.graph.model_dump(mode="json")
            session.add(GraphRow(scan_id=scan_id, nodes=graph["nodes"], edges=graph["edges"]))
        session.add_all(FileRow(scan_id=scan_id, path=p, content=c) for p, c in tree.files.items())
        session.execute(
            update(Scan)
            .where(Scan.id == scan_id)
            .values(
                status="done",
                stage="done",
                progress=100,
                commit_sha=result.commit_sha,
                project_root=result.project_root,
                stats=result.stats.model_dump(mode="json"),
                warnings=result.warnings,
                finished_at=utcnow(),
                last_progress_at=utcnow(),
            )
        )


def load_findings(session: Session, scan_id: str) -> list[Finding]:
    rows = session.scalars(select(FindingRow).where(FindingRow.scan_id == scan_id)).all()
    findings = [
        Finding.model_validate({c: getattr(r, c) for c in Finding.model_fields if hasattr(r, c)})
        for r in rows
    ]
    findings.sort(key=lambda f: (-f.confidence, f.file, f.line, f.name))
    return findings


def load_graph(session: Session, scan_id: str) -> GraphData | None:
    row = session.get(GraphRow, scan_id)
    return GraphData.model_validate({"nodes": row.nodes, "edges": row.edges}) if row else None


def purge_scans(session: Session, older_than_days: int) -> int:
    ids = list(
        session.scalars(select(Scan.id).where(Scan.created_at < utcnow() - timedelta(days=older_than_days)))
    )
    for model in (FindingRow, GraphRow, FileRow, Cleanup):
        session.execute(delete(model).where(model.scan_id.in_(ids)))
    session.execute(delete(Scan).where(Scan.id.in_(ids)))
    return len(ids)
