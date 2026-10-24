"""Data structures shared by the Python analysis passes."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any, NamedTuple

import libcst as cst

from dch.graph.model import CodeGraph
from dch.result import Location


class Ent(NamedTuple):
    """What an expression evaluates to, as far as static resolution can tell."""

    kind: str  # module class instance function variable external super builtin unknown
    ref: str = ""


UNKNOWN = Ent("unknown")


@dataclass(frozen=True)
class Res:
    ent: Ent
    via: tuple[str, ...] = ()  # graph nodes a reference to this expression should point at
    miss: bool = False  # attribute lookup on a repo object found nothing


@dataclass
class ImportBinding:
    node_id: str
    local: str
    module: str  # absolute dotted module (from-imports) or the imported dotted path (plain)
    symbol: str | None  # None for plain ``import x.y``
    asname: bool
    line: int
    is_star: bool = False


@dataclass
class ClassInfo:
    node_id: str
    module: str
    qualname: str
    base_exprs: list[cst.BaseExpression] = field(default_factory=list)
    bases: list[Ent] = field(default_factory=list)
    methods: dict[str, list[str]] = field(default_factory=dict)
    attr_types: dict[str, str] = field(default_factory=dict)


@dataclass
class ModuleInfo:
    name: str
    path: str
    node_id: str
    is_package: bool
    is_test: bool
    source: str
    tree: cst.Module | None = None
    positions: dict[cst.CSTNode, Any] = field(default_factory=dict)
    scopes: dict[cst.CSTNode, Any] = field(default_factory=dict)
    contexts: dict[cst.CSTNode, Any] = field(default_factory=dict)
    defs: dict[str, list[str]] = field(default_factory=dict)
    bindings: dict[str, list[ImportBinding]] = field(default_factory=dict)
    star_modules: list[str] = field(default_factory=list)
    exports: set[str] | None = None
    loaded: set[str] = field(default_factory=set)
    dynamic: list[Location] = field(default_factory=list)
    has_getattr: bool = False
    has_main_guard: bool = False

    def line_text(self, line: int) -> str:
        lines = self.source.splitlines()
        return lines[line - 1] if 0 < line <= len(lines) else ""


class StringLit(NamedTuple):
    value: str
    file: str
    line: int


@dataclass
class UnreachableBlock:
    file: str
    scope: str  # qualname of the enclosing function/class, or "<module>"
    start: int
    end: int
    reason: str
    kind: str = "after_terminator"  # after_terminator | if_false | else_of_if_true | after_loop
    anchor: int = 0  # line of the statement that makes the block unreachable


def is_test_path(path: str) -> bool:
    p = PurePosixPath(path)
    return (
        p.name.startswith("test_")
        or p.name.endswith("_test.py")
        or p.name == "conftest.py"
        or any(part in ("tests", "test") for part in p.parts[:-1])
    )


def module_name_for(path: str, source_roots: list[str]) -> str:
    p = PurePosixPath(path)
    for root in source_roots:
        if root and p.is_relative_to(root):
            p = p.relative_to(root)
            break
    parts = list(p.with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


class ProjectIndex:
    def __init__(self, repo: str, graph: CodeGraph) -> None:
        self.repo = repo
        self.graph = graph
        self.modules: dict[str, ModuleInfo] = {}
        self.by_path: dict[str, ModuleInfo] = {}
        self.classes: dict[str, ClassInfo] = {}
        self.cst_nodes: dict[str, cst.CSTNode] = {}
        self.node_module: dict[str, str] = {}
        self.func_returns: dict[str, str] = {}
        self.var_types: dict[str, str] = {}
        self.var_external: dict[str, str] = {}
        self.binding_by_id: dict[str, ImportBinding] = {}
        self.extras: dict[str, Any] = {}
        self.unresolved_attrs: dict[str, list[Location]] = {}
        self.string_literals: list[StringLit] = []
        self.unreachable: list[UnreachableBlock] = []
        self.warnings: list[str] = []
        self.opaque_files: set[str] = set()
        self.internal_prefixes: set[str] = set()

    def module_node_id(self, path: str) -> str:
        return f"{self.repo}:{path}"

    def symbol_id(self, path: str, qualname: str) -> str:
        return f"{self.repo}:{path}#{qualname}"

    def ancestors(self, name: str) -> list[str]:
        parts = name.split(".")
        return [".".join(parts[:i]) for i in range(1, len(parts)) if ".".join(parts[:i]) in self.modules]
