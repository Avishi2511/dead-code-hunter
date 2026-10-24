"""Analyzer output contracts (``ScanResult`` / ``CleanupResult``)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = 1

FindingType = Literal[
    "unused_function",
    "unused_class",
    "unused_method",
    "unused_variable",
    "unused_import",
    "unused_module",
    "unused_dependency",
    "unused_route",
    "unreachable_code",
]
Level = Literal["high", "medium", "low"]
Action = Literal["remove", "mark_alive"]


class Location(BaseModel):
    file: str
    line: int


class Evidence(BaseModel):
    polarity: Literal["supports", "weakens"]
    code: str
    text: str
    locations: list[Location] = Field(default_factory=list)


class Reference(BaseModel):
    """A graph edge touching the finding's node, for the detail page."""

    direction: Literal["incoming", "outgoing"]
    kind: str
    node_id: str
    liveness: str = "unknown"
    locations: list[Location] = Field(default_factory=list)


class Suggestion(BaseModel):
    actions: list[Action] = Field(default_factory=lambda: ["remove", "mark_alive"])
    diff: str = ""
    cascades: list[str] = Field(default_factory=list)
    static_check: Literal["pass", "fail", "skipped"] = "skipped"
    contains_ids: list[str] = Field(default_factory=list)
    static_notes: list[str] = Field(default_factory=list)
    manual: bool = False


class Finding(BaseModel):
    id: str
    type: FindingType
    name: str
    node_ids: list[str]
    file: str
    line: int
    end_line: int
    confidence: int
    level: Level
    summary: str = ""
    evidence: list[Evidence] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    impact_lines: int = 0
    suggestion: Suggestion | None = None
    details: dict[str, Any] = Field(default_factory=dict)  # type-specific data for cleanup transforms


class GraphNode(BaseModel):
    id: str
    kind: str
    name: str
    language: str = "python"
    file: str | None = None
    line: int | None = None
    end_line: int | None = None
    liveness: Literal["live", "test_only", "dead", "unknown"] = "unknown"
    live_reason: str | None = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    src: str
    dst: str
    kind: str
    attrs: dict[str, Any] = Field(default_factory=dict)
    locations: list[Location] = Field(default_factory=list)


class GraphData(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class ScanStats(BaseModel):
    python_files: int = 0
    python_lines: int = 0
    modules: int = 0
    symbols: int = 0
    findings_by_type: dict[str, int] = Field(default_factory=dict)
    findings_by_level: dict[str, int] = Field(default_factory=dict)
    potential_cleanup_lines: int = 0
    duration_s: float = 0.0


class ScanResult(BaseModel):
    schema_version: int = SCHEMA_VERSION
    repo: str
    commit_sha: str | None = None
    project_root: str = ""
    stats: ScanStats = Field(default_factory=ScanStats)
    warnings: list[str] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    graph: GraphData | None = None


class Selection(BaseModel):
    finding_id: str
    action: Action = "remove"


class ValidationReport(BaseModel):
    compileall: Literal["pass", "fail", "skipped"] = "skipped"
    ruff_new_issues: list[str] = Field(default_factory=list)
    typecheck_new_errors: list[str] = Field(default_factory=list)
    typecheck: Literal["pass", "fail", "skipped"] = "skipped"
    ruff: Literal["pass", "fail", "skipped"] = "skipped"
    notes: list[str] = Field(default_factory=list)


class CleanupSummary(BaseModel):
    findings: int = 0
    by_type: dict[str, int] = Field(default_factory=dict)
    files_changed: int = 0
    lines_removed: int = 0
    lines_added: int = 0
    covered: list[str] = Field(default_factory=list)
    manual: list[str] = Field(default_factory=list)


class CleanupResult(BaseModel):
    schema_version: int = SCHEMA_VERSION
    base_commit_sha: str | None = None
    selections: list[Selection]
    diff: str
    patch: str
    report_md: str
    summary: CleanupSummary
    validation: ValidationReport
