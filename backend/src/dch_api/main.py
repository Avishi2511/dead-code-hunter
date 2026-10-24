"""FastAPI application factory. Nothing in here is platform specific (plan §12.3)."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from dch_api.db.session import Database, create_all
from dch_api.jobs.runner import Job, make_runner
from dch_api.routes import cleanups, scans, system
from dch_api.services.cleanups import run_cleanup_job
from dch_api.services.scans import SourceFactory, github_source, run_scan
from dch_api.settings import Settings, get_settings

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, source_factory: SourceFactory = github_source) -> FastAPI:
    settings = settings or get_settings()
    db = Database(settings.database_url)
    if settings.database_url.startswith("sqlite"):
        create_all(db.engine)  # throw-away dev databases; Postgres schemas come from Alembic

    def handle(job: Job) -> None:
        if job.kind == "scan":
            run_scan(db, settings, source_factory, job.id)
        else:
            run_cleanup_job(db, settings, job.id)

    app = FastAPI(title="Dead Code Hunter", version="0.1.0")
    app.state.settings, app.state.db = settings, db
    app.state.runner = make_runner(settings.job_runner, handle)
    if origins := [o.strip() for o in settings.cors_origins.split(",") if o.strip()]:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
    for module in (scans, cleanups, system):
        app.include_router(module.router)
    if settings.serve_static:
        mount_spa(app, Path(settings.static_dir))
    return app


def mount_spa(app: FastAPI, directory: Path) -> None:
    if not (directory / "index.html").exists():
        logger.warning("SERVE_STATIC is set but %s has no index.html", directory)
        return
    app.mount("/assets", StaticFiles(directory=directory / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404)
        candidate = (directory / path).resolve()
        if path and candidate.is_file() and directory.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(directory / "index.html")


def app_factory() -> FastAPI:
    """Entry point for ``uvicorn dch_api.main:app_factory --factory`` and the Vercel adapter."""
    return create_app()
