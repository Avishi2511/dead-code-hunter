"""Request / response bodies. Analyzer models from ``dch.result`` are reused as-is (plan §11)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from dch.result import (
    Action,
    CleanupSummary,
    Finding,
    GraphEdge,
    GraphNode,
    ValidationReport,
)

Status = Literal["pending", "running", "done", "failed"]


class Camel(BaseModel):
    """Request bodies accept the camelCase names from the plan as well as snake_case."""

    model_config = ConfigDict(populate_by_name=True)


class ScanCreate(Camel):
    repo_url: str = Field(alias="repoUrl", max_length=300)
    ref: str | None = Field(default=None, max_length=200)
    subdir: str | None = Field(default=None, max_length=300)


class ScanCreated(Camel):
    scan_id: str = Field(alias="scanId")


class ScanView(BaseModel):
    id: str
    repo_url: str
    ref: str | None
    subdir: str | None
    commit_sha: str | None
    status: Status
    stage: str
    progress: int
    stats: dict[str, Any]
    warnings: list[str]
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class FindingSummary(BaseModel):
    id: str
    type: str
    name: str
    file: str
    line: int
    end_line: int
    confidence: int
    level: str
    summary: str
    impact_lines: int
    static_check: str | None = None
    covered_by: str | None = None
    manual: bool = False


class FindingList(BaseModel):
    total: int
    items: list[FindingSummary]


class CodeExcerpt(BaseModel):
    start_line: int
    lines: list[str]
    highlight_start: int
    highlight_end: int


class FindingDetail(Finding):
    excerpt: CodeExcerpt | None = None
    covered_by: str | None = None


class GraphView(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    focus: list[str] = Field(default_factory=list)
    hidden: dict[str, int] = Field(default_factory=dict)  # node id -> neighbours not shown ("+N more")


class FileView(BaseModel):
    path: str
    content: str


class SelectionIn(Camel):
    finding_id: str = Field(alias="findingId")
    action: Action = "remove"


class CleanupCreate(Camel):
    selections: list[SelectionIn] = Field(min_length=1, max_length=2000)


class CleanupCreated(Camel):
    cleanup_id: str = Field(alias="cleanupId")


class CleanupView(BaseModel):
    id: str
    scan_id: str
    status: Status
    error: str | None
    selections: list[dict[str, Any]]
    diff: str | None
    summary: CleanupSummary | None
    validation: ValidationReport | None
    created_at: datetime


class Health(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]


class PurgeResult(BaseModel):
    scans_deleted: int
