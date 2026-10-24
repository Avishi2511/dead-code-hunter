"""SQLAlchemy models (plain Postgres; JSON columns become jsonb there)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Json = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    repo_url: Mapped[str] = mapped_column(String(300))
    ref: Mapped[str | None] = mapped_column(String(200))
    subdir: Mapped[str | None] = mapped_column(String(300))
    commit_sha: Mapped[str | None] = mapped_column(String(64))
    project_root: Mapped[str] = mapped_column(String(300), default="")  # relative to the repo root
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|running|done|failed
    stage: Mapped[str] = mapped_column(String(32), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    stats: Mapped[dict[str, Any]] = mapped_column(Json, default=dict)
    warnings: Mapped[list[str]] = mapped_column(Json, default=list)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    last_progress_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FindingRow(Base):
    __tablename__ = "findings"

    scan_id: Mapped[str] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    type: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(500))
    file: Mapped[str] = mapped_column(String(500))
    line: Mapped[int] = mapped_column(Integer)
    end_line: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[int] = mapped_column(Integer)
    level: Mapped[str] = mapped_column(String(8))
    evidence: Mapped[list[Any]] = mapped_column(Json, default=list)
    references: Mapped[list[Any]] = mapped_column(Json, default=list)
    node_ids: Mapped[list[str]] = mapped_column(Json, default=list)
    impact_lines: Mapped[int] = mapped_column(Integer, default=0)
    suggestion: Mapped[dict[str, Any] | None] = mapped_column(Json)
    summary: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[dict[str, Any]] = mapped_column(Json, default=dict)


class GraphRow(Base):
    __tablename__ = "graphs"

    scan_id: Mapped[str] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"), primary_key=True)
    nodes: Mapped[list[Any]] = mapped_column(Json)
    edges: Mapped[list[Any]] = mapped_column(Json)


class FileRow(Base):
    __tablename__ = "files"

    scan_id: Mapped[str] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"), primary_key=True)
    path: Mapped[str] = mapped_column(String(500), primary_key=True)
    content: Mapped[str] = mapped_column(Text)


class Cleanup(Base):
    __tablename__ = "cleanups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scan_id: Mapped[str] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"), index=True)
    selections: Mapped[list[Any]] = mapped_column(Json)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    diff: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[dict[str, Any] | None] = mapped_column(Json)
    validation: Mapped[dict[str, Any] | None] = mapped_column(Json)
    patch: Mapped[str | None] = mapped_column(Text)
    report_md: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_progress_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RateLimit(Base):
    __tablename__ = "rate_limits"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
