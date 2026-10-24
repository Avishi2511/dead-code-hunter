from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy import text

from dch_api import ratelimit
from dch_api.deps import SessionDep, SettingsDep
from dch_api.schemas import Health, PurgeResult
from dch_api.services.scans import purge_scans

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", response_model=Health)
def health(session: SessionDep):
    session.execute(text("SELECT 1"))
    return Health(status="ok", database="ok")


@router.api_route("/maintenance/purge", methods=["POST", "GET"], response_model=PurgeResult)
def purge(session: SessionDep, settings: SettingsDep, authorization: Annotated[str | None, Header()] = None):
    """Delete old scans. GET is accepted too because most cron services (Vercel Cron) only issue GETs."""
    token = settings.maintenance_token
    if not token:
        raise HTTPException(503, "Maintenance is disabled (MAINTENANCE_TOKEN is not set)")
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "Invalid maintenance token")
    ratelimit.purge_old(session)
    return PurgeResult(scans_deleted=purge_scans(session, settings.purge_after_days))
