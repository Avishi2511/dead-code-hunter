from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from dch_api.db.models import Scan
from dch_api.db.session import Database
from dch_api.jobs.runner import JobRunner
from dch_api.settings import Settings


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_runner(request: Request) -> JobRunner:
    return request.app.state.runner


def get_session(db: Annotated[Database, Depends(get_db)]) -> Iterator[Session]:
    with db.session() as session:
        yield session


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
RunnerDep = Annotated[JobRunner, Depends(get_runner)]


def require_scan(session: Session, scan_id: str, *, done: bool = False) -> Scan:
    scan = session.get(Scan, scan_id)
    if scan is None:
        raise HTTPException(404, "Scan not found")
    if done and scan.status != "done":
        raise HTTPException(409, "The scan has not finished")
    return scan
