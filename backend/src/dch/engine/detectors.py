"""Language-neutral detectors: turn liveness + graph facts into dead-code candidates."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from dch.config import Config
from dch.graph.model import Node
from dch.python.model import ModuleInfo, ProjectIndex

NOQA = re.compile(r"#\s*noqa(?::\s*(?P<codes>[A-Z0-9, ]+))?", re.IGNORECASE)
SKIP_MODULE_NAMES = {"__init__.py", "__main__.py", "setup.py", "manage.py", "conftest.py"}
KIND_TO_TYPE = {
    "function": "unused_function",
    "class": "unused_class",
    "method": "unused_method",
    "variable": "unused_variable",
}


@dataclass
class Candidate:
    type: str
    node_id: str
    name: str
    file: str
    line: int
    end_line: int
    test_only: bool = False
    node_ids: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.node_ids:
            self.node_ids = [self.node_id]


def skip_module(mod: ModuleInfo) -> bool:
    name = mod.path.rsplit("/", 1)[-1]
    parts = mod.path.split("/")
    return name in SKIP_MODULE_NAMES or mod.has_main_guard or "alembic" in parts or "migrations" in parts


def is_migration(mod: ModuleInfo) -> bool:
    """Alembic scripts are driven by the framework by name (upgrade, revision, ...), not by imports."""
    parts = mod.path.split("/")
    return "alembic" in parts or "migrations" in parts


def noqa_suppresses(line_text: str) -> bool:
    match = NOQA.search(line_text)
    if not match:
        return False
    codes = match.group("codes")
    return codes is None or "F401" in codes.upper()


def detect_modules(project: ProjectIndex, config: Config) -> tuple[list[Candidate], set[str]]:
    found: list[Candidate] = []
    covered: set[str] = set()
    for mod in project.modules.values():
        node = project.graph.nodes[mod.node_id]
        if mod.is_test or node.liveness == "live" or skip_module(mod):
            continue
        if config.is_ignored(mod.path):
            continue
        found.append(
            Candidate(
                "unused_module",
                node.id,
                mod.path,
                mod.path,
                1,
                node.end_line or 1,
                test_only=node.liveness == "test_only",
            )
        )
        covered.add(mod.name)
    return found, covered


def detect_symbols(project: ProjectIndex, config: Config, covered: set[str]) -> list[Candidate]:
    g = project.graph
    found: list[Candidate] = []
    for node in g.nodes.values():
        if node.kind not in KIND_TO_TYPE or node.liveness == "live":
            continue
        mod = project.modules[project.node_module[node.id]]
        if mod.is_test or is_migration(mod) or mod.name in covered:
            continue
        if config.is_ignored(mod.path, node.name):
            continue
        if node.kind == "method" and g.nodes[node.attrs["class_id"]].liveness != "live":
            continue  # covered by the class finding
        if node.kind == "class" and "." in node.name:
            outer = project.symbol_id(mod.path, node.name.rsplit(".", 1)[0])
            if outer in g.nodes and g.nodes[outer].liveness != "live":
                continue
        if node.attrs.get("route_handler"):
            continue  # reported through its route
        if node.kind in ("function", "variable") and node.name.startswith("__"):
            continue
        found.append(
            Candidate(
                KIND_TO_TYPE[node.kind],
                node.id,
                node.name,
                mod.path,
                node.line or 1,
                node.end_line or 1,
                test_only=node.liveness == "test_only",
            )
        )
    return found


def detect_imports(project: ProjectIndex, config: Config, covered: set[str]) -> list[Candidate]:
    found: list[Candidate] = []
    for node in project.graph.nodes.values():
        if node.kind != "import":
            continue
        mod = project.modules[project.node_module[node.id]]
        if mod.is_test or is_migration(mod) or mod.name in covered or mod.path.endswith("__init__.py"):
            continue
        if node.name in mod.loaded or (mod.exports and node.name in mod.exports):
            continue
        if node.attrs.get("module") == "__future__" or noqa_suppresses(node.attrs["line_text"]):
            continue
        if config.is_ignored(mod.path, node.name):
            continue
        found.append(
            Candidate("unused_import", node.id, node.name, mod.path, node.line or 1, node.end_line or 1)
        )
    return found


def enclosing_dead_symbol(project: ProjectIndex, file: str, start: int, end: int) -> Node | None:
    for node in project.graph.nodes.values():
        if node.file != file or node.kind not in ("function", "method", "class"):
            continue
        if (node.line or 0) <= start and (node.end_line or 0) >= end and node.liveness != "live":
            return node
    return None


def detect_unreachable(project: ProjectIndex, config: Config, covered: set[str]) -> list[Candidate]:
    found: list[Candidate] = []
    for block in project.unreachable:
        mod = project.by_path[block.file]
        if mod.is_test or mod.name in covered or config.is_ignored(block.file, block.scope):
            continue
        if enclosing_dead_symbol(project, block.file, block.start, block.end):
            continue
        node_id = f"{project.repo}:{block.file}#unreachable@{block.start}"
        found.append(
            Candidate(
                "unreachable_code",
                node_id,
                block.scope,
                block.file,
                block.start,
                block.end,
                extra={"block": block},
            )
        )
    return found


def detect_routes(project: ProjectIndex, config: Config, covered: set[str]) -> list[Candidate]:
    g = project.graph
    found: list[Candidate] = []
    for node in g.nodes.values():
        if node.kind != "route" or node.liveness == "live":
            continue
        handler = g.nodes[node.attrs["handler"]]
        mod = project.by_path[handler.file or ""]
        if mod.is_test or mod.name in covered or config.is_ignored(mod.path, handler.name):
            continue
        shadowed_by = node.attrs.get("shadowed_by")
        found.append(
            Candidate(
                "unused_route",
                node.id,
                node.name,
                node.file or "",
                node.line or 1,
                node.end_line or 1,
                test_only=node.liveness == "test_only" and not shadowed_by,
                node_ids=[node.id, handler.id],
                extra={"shadowed_by": shadowed_by, "router": node.attrs["router"]},
            )
        )
    return found


def detect_all(project: ProjectIndex, config: Config) -> list[Candidate]:
    modules, covered = detect_modules(project, config)
    return [
        *modules,
        *detect_symbols(project, config, covered),
        *detect_imports(project, config, covered),
        *detect_routes(project, config, covered),
        *detect_unreachable(project, config, covered),
    ]
