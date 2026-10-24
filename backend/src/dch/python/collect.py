"""Pass A: parse modules and create graph nodes for modules, symbols and import bindings."""

from __future__ import annotations

import logging
from collections.abc import Sequence

import libcst as cst
from libcst.metadata import (
    ExpressionContextProvider,
    MetadataWrapper,
    PositionProvider,
    ScopeProvider,
)

from dch.graph.model import CodeGraph, Node
from dch.python.model import (
    ClassInfo,
    ImportBinding,
    ModuleInfo,
    ProjectIndex,
    is_test_path,
    module_name_for,
)
from dch.source.base import SourceTree

logger = logging.getLogger(__name__)

PROPERTY_DECORATORS = {"property", "cached_property", "setter", "getter", "deleter"}
ABSTRACT_DECORATORS = {"abstractmethod", "abstractproperty"}


def detect_source_roots(paths: list[str]) -> list[str]:
    roots = []
    py = set(paths)
    if "src/__init__.py" not in py and any(p.startswith("src/") for p in paths):
        roots.append("src")
    return [*roots, ""]


def block_statements(suite: cst.BaseSuite) -> Sequence[cst.CSTNode]:
    return suite.body


def dotted(node: cst.BaseExpression | None) -> str | None:
    """Dotted source text for a Name/Attribute chain, else None."""
    if isinstance(node, cst.Name):
        return node.value
    if isinstance(node, cst.Attribute):
        base = dotted(node.value)
        return f"{base}.{node.attr.value}" if base else None
    return None


def is_main_guard(test: cst.BaseExpression) -> bool:
    if not (isinstance(test, cst.Comparison) and len(test.comparisons) == 1):
        return False
    comparison = test.comparisons[0]
    pair = (test.left, comparison.comparator)
    names = [e for e in pair if isinstance(e, cst.Name) and e.value == "__name__"]
    strings = [e for e in pair if isinstance(e, cst.SimpleString) and e.evaluated_value == "__main__"]
    return isinstance(comparison.operator, cst.Equal) and bool(names) and bool(strings)


def decorator_name(dec: cst.Decorator) -> str | None:
    expr = dec.decorator
    if isinstance(expr, cst.Call):
        expr = expr.func
    return dotted(expr)


def absolute_module(mod: ModuleInfo, level: int, name: str | None) -> str:
    """Absolute dotted name of ``from {'.' * level}{name} import ...`` seen in ``mod``."""
    if level == 0:
        return name or ""
    parts = mod.name.split(".") if mod.name else []
    package = parts if mod.is_package else parts[:-1]
    base = package[: len(package) - (level - 1)] if level > 1 else package
    return ".".join([*base, *([name] if name else [])])


class Collector:
    def __init__(self, project: ProjectIndex, module: ModuleInfo) -> None:
        self.p = project
        self.m = module
        self.g: CodeGraph = project.graph

    def run(self) -> None:
        wrapper = MetadataWrapper(cst.parse_module(self.m.source))
        self.m.tree = wrapper.module
        self.m.positions = wrapper.resolve(PositionProvider)
        self.m.scopes = wrapper.resolve(ScopeProvider)
        self.m.contexts = wrapper.resolve(ExpressionContextProvider)
        self.collect_block(self.m.tree.body, qual="", cls=None)

    def lines(self, node: cst.CSTNode) -> tuple[int, int]:
        pos = self.m.positions[node]
        return pos.start.line, pos.end.line

    def abs_module(self, level: int, name: str | None) -> str:
        return absolute_module(self.m, level, name)

    def add_node(self, node_id: str, kind: str, name: str, cst_node: cst.CSTNode, **attrs) -> Node:
        start, end = self.lines(cst_node)
        if isinstance(cst_node, cst.FunctionDef | cst.ClassDef) and cst_node.decorators:
            start = min(start, *(self.lines(d)[0] for d in cst_node.decorators))
        if node_id in self.g.nodes:  # redefinition: keep ids unique and stable
            node_id = f"{node_id}@{start}"
        node = self.g.add_node(Node(node_id, kind, name, self.m.path, start, end, attrs=attrs))
        self.g.add_edge(self.m.node_id, node_id, "contains")
        self.p.cst_nodes[node_id] = cst_node
        self.p.node_module[node_id] = self.m.name
        return node

    def collect_block(self, body: Sequence[cst.CSTNode], qual: str, cls: ClassInfo | None) -> None:
        for stmt in body:
            if isinstance(stmt, cst.SimpleStatementLine):
                for small in stmt.body:
                    self.collect_small(small, stmt, qual, cls)
            elif isinstance(stmt, cst.FunctionDef):
                self.collect_function(stmt, qual, cls)
            elif isinstance(stmt, cst.ClassDef):
                self.collect_class(stmt, qual, cls)
            elif isinstance(stmt, cst.If):
                self.collect_if(stmt, qual, cls)
            elif isinstance(stmt, cst.Try | cst.TryStar):
                self.collect_block(block_statements(stmt.body), qual, cls)
                for handler in stmt.handlers:
                    self.collect_block(block_statements(handler.body), qual, cls)
                for tail in (stmt.orelse, stmt.finalbody):
                    if tail:
                        self.collect_block(block_statements(tail.body), qual, cls)
            elif isinstance(stmt, cst.With | cst.For | cst.While):
                self.collect_block(block_statements(stmt.body), qual, cls)
                if getattr(stmt, "orelse", None):
                    self.collect_block(block_statements(stmt.orelse.body), qual, cls)

    def collect_if(self, stmt: cst.If, qual: str, cls: ClassInfo | None) -> None:
        if is_main_guard(stmt.test):
            self.m.has_main_guard = True
        self.collect_block(block_statements(stmt.body), qual, cls)
        orelse = stmt.orelse
        if isinstance(orelse, cst.If):
            self.collect_if(orelse, qual, cls)
        elif orelse is not None:
            self.collect_block(block_statements(orelse.body), qual, cls)

    def decorators(self, node: cst.FunctionDef | cst.ClassDef) -> list[str]:
        return [n for n in (decorator_name(d) for d in node.decorators) if n]

    def collect_function(self, node: cst.FunctionDef, qual: str, cls: ClassInfo | None) -> None:
        name = node.name.value
        qualname = f"{qual}{name}"
        decorators = self.decorators(node)
        last = [d.rsplit(".", 1)[-1] for d in decorators]
        if cls is None:
            node_obj = self.add_node(
                self.p.symbol_id(self.m.path, qualname),
                "function",
                qualname,
                node,
                decorators=decorators,
                is_async=node.asynchronous is not None,
            )
            self.m.defs.setdefault(name, []).append(node_obj.id)
            if name == "__getattr__":
                self.m.has_getattr = True
            return
        is_dunder = name.startswith("__") and name.endswith("__")
        node_obj = self.add_node(
            self.p.symbol_id(self.m.path, qualname),
            "method",
            qualname,
            node,
            decorators=decorators,
            is_dunder=is_dunder,
            class_id=cls.node_id,
            is_property=bool(PROPERTY_DECORATORS & set(last)),
            is_abstract=bool(ABSTRACT_DECORATORS & set(last)),
            is_static="staticmethod" in last,
            is_classmethod="classmethod" in last,
        )
        cls.methods.setdefault(name, []).append(node_obj.id)

    def collect_class(self, node: cst.ClassDef, qual: str, outer: ClassInfo | None) -> None:
        name = node.name.value
        qualname = f"{qual}{name}"
        node_obj = self.add_node(
            self.p.symbol_id(self.m.path, qualname),
            "class",
            qualname,
            node,
            decorators=self.decorators(node),
            bases=[b for b in (dotted(a.value) for a in node.bases) if b],
        )
        info = ClassInfo(node_obj.id, self.m.name, qualname, base_exprs=[a.value for a in node.bases])
        self.p.classes[node_obj.id] = info
        if outer is None:
            self.m.defs.setdefault(name, []).append(node_obj.id)
        else:
            outer.methods.setdefault(name, []).append(node_obj.id)  # nested: attribute access
        self.collect_block(block_statements(node.body), f"{qualname}.", info)

    def collect_small(self, small, stmt, qual: str, cls: ClassInfo | None) -> None:
        if cls is not None:
            return
        if isinstance(small, cst.Import):
            self.collect_import(small, stmt)
        elif isinstance(small, cst.ImportFrom):
            self.collect_import_from(small, stmt)
        elif not qual:
            if isinstance(small, cst.Assign):
                self.collect_assign(small, stmt)
            elif isinstance(small, cst.AnnAssign) and small.value is not None:
                if isinstance(small.target, cst.Name):
                    self.add_variable(small.target.value, small, stmt)
            elif isinstance(small, cst.AugAssign):
                if dotted(small.target) == "__all__":
                    self.add_exports(small.value)

    def collect_assign(self, small: cst.Assign, stmt: cst.SimpleStatementLine) -> None:
        if len(small.targets) != 1 or not isinstance(small.targets[0].target, cst.Name):
            return
        name = small.targets[0].target.value
        if name == "__all__":
            self.add_exports(small.value)
            return
        self.add_variable(name, small, stmt)

    def add_exports(self, value: cst.BaseExpression) -> None:
        if isinstance(value, cst.List | cst.Tuple):
            names = {
                el.value.evaluated_value
                for el in value.elements
                if isinstance(el.value, cst.SimpleString) and isinstance(el.value.evaluated_value, str)
            }
            self.m.exports = (self.m.exports or set()) | names

    def add_variable(self, name: str, small, stmt: cst.SimpleStatementLine) -> None:
        if name.startswith("__") and name.endswith("__"):
            return
        node = self.add_node(self.p.symbol_id(self.m.path, name), "variable", name, stmt)
        self.m.defs.setdefault(name, []).append(node.id)

    def binding_node(self, local: str, stmt: cst.CSTNode, alias: cst.CSTNode, **attrs) -> Node:
        line = self.lines(alias)[0]
        stmt_start, stmt_end = self.lines(stmt)
        node_id = self.p.symbol_id(self.m.path, f"import:{local}")
        node = self.add_node(
            node_id,
            "import",
            local,
            alias,
            stmt_start=stmt_start,
            stmt_end=stmt_end,
            line_text=self.m.line_text(line),
            **attrs,
        )
        node.line = line
        return node

    def collect_import(self, node: cst.Import, stmt: cst.SimpleStatementLine) -> None:
        for alias in node.names:
            module = dotted(alias.name) or ""
            if alias.asname and isinstance(alias.asname.name, cst.Name):
                local = alias.asname.name.value
            else:
                local = module.split(".")[0]
            gn = self.binding_node(local, stmt, alias, module=module)
            binding = ImportBinding(gn.id, local, module, None, alias.asname is not None, gn.line or 0)
            self.m.bindings.setdefault(local, []).append(binding)
            self.p.binding_by_id[gn.id] = binding

    def collect_import_from(self, node: cst.ImportFrom, stmt: cst.SimpleStatementLine) -> None:
        target = self.abs_module(len(node.relative), dotted(node.module))
        if isinstance(node.names, cst.ImportStar):
            self.m.star_modules.append(target)
            return
        for alias in node.names:
            symbol = dotted(alias.name) or ""
            local = alias.asname.name.value if alias.asname else symbol
            gn = self.binding_node(local, stmt, alias, module=target, symbol=symbol)
            binding = ImportBinding(gn.id, local, target, symbol, alias.asname is not None, gn.line or 0)
            self.m.bindings.setdefault(local, []).append(binding)
            self.p.binding_by_id[gn.id] = binding


def build_index(tree: SourceTree, graph: CodeGraph) -> ProjectIndex:
    project = ProjectIndex(tree.repo, graph)
    py_files = tree.py_files
    roots = detect_source_roots(py_files)
    for path in py_files:
        name = module_name_for(path, roots)
        if name in project.modules:
            project.warnings.append(f"Duplicate module name {name!r}: {path} ignored")
            continue
        info = ModuleInfo(
            name=name,
            path=path,
            node_id=project.module_node_id(path),
            is_package=path.endswith("__init__.py"),
            is_test=is_test_path(path),
            source=tree.files[path],
        )
        project.modules[name] = info
        project.by_path[path] = info
    for info in list(project.modules.values()):
        try:
            Collector(project, info).run()
        except cst.ParserSyntaxError as exc:
            project.warnings.append(f"Could not parse {info.path}: {exc.message}")
            project.opaque_files.add(info.path)
            del project.modules[info.name]
            del project.by_path[info.path]
            continue
        graph.add_node(
            Node(
                info.node_id,
                "module",
                info.name or info.path,
                info.path,
                1,
                len(info.source.splitlines()) or 1,
                attrs={"is_package": info.is_package, "is_test": info.is_test},
            )
        )
    for name in project.modules:
        parts = name.split(".")
        project.internal_prefixes.update(".".join(parts[:i]) for i in range(1, len(parts) + 1))
    return project
