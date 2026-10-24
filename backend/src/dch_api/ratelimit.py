"""Per-IP fixed-window rate limit stored in the database (no KV dependency)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from dch_api.db.models import RateLimit, utcnow


def hit(session: Session, key: str, limit: int, window: timedelta = timedelta(hours=1)) -> None:
    """Count one request for ``key``; raise 429 once ``limit`` is exceeded in the current window."""
    now = utcnow()
    start = now.replace(minute=0, second=0, microsecond=0)
    if window != timedelta(hours=1):
        start = now - timedelta(seconds=now.timestamp() % window.total_seconds())
    row = session.scalar(select(RateLimit).where(RateLimit.key == key, RateLimit.window_start == start))
    if row is None:
        row = RateLimit(key=key, window_start=start, count=0)
        session.add(row)
    row.count += 1
    session.flush()
    if row.count > limit:
        raise HTTPException(429, "Rate limit reached, try again later")


def purge_old(session: Session, older_than: timedelta = timedelta(days=1)) -> int:
    result = session.execute(delete(RateLimit).where(RateLimit.window_start < utcnow() - older_than))
    return result.rowcount or 0
