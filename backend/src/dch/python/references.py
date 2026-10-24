"""Pass B: extract reference edges, string literals and dynamic-access markers."""

from __future__ import annotations

import libcst as cst
from libcst.metadata import ExpressionContext, GlobalScope

from dch.python.collect import absolute_module, dotted
from dch.python.model import Ent, ModuleInfo, ProjectIndex, StringLit
from dch.python.resolve import LocalCtx, Resolver
from dch.result import Location

DYNAMIC_CALLS = {"importlib.import_module", "__import__", "globals"}
DEPENDS_CALLS = {"fastapi.Depends", "fastapi.params.Depends", "fastapi.Security", "fastapi.params.Security"}


class ReferenceVisitor(cst.CSTVisitor):
    def __init__(self, project: ProjectIndex, resolver: Resolver, mod: ModuleInfo, hooks=()) -> None:
        self.hooks = hooks
        self.suppress = 0
        self.depends_targets: set[cst.CSTNode] = set()
        self.p = project
        self.r = resolver
        self.m = mod
        self.g = project.graph
        self.owners: list[str] = [mod.node_id]
        self.locals: list[LocalCtx] = []
        self.ids = {n: i for i, n in project.cst_nodes.items() if project.node_module.get(i) == mod.name}
        self.call_funcs: set[cst.CSTNode] = set()
        self.skip_strings: set[cst.CSTNode] = set()
        self.annotation_depth = 0
        self.glob_only = False
        self.current_line = 1

    # ---- helpers ---------------------------------------------------------------------------

    @property
    def owner(self) -> str:
        return self.owners[-1]

    @property
    def local(self) -> LocalCtx | None:
        return self.locals[-1] if self.locals else None

    def loc(self, node: cst.CSTNode) -> Location:
        pos = self.m.positions.get(node)
        if pos is not None:
            self.current_line = pos.start.line
        return Location(file=self.m.path, line=self.current_line)

    def visit_suppressed(self, node: cst.CSTNode) -> None:
        """Visit a subtree for bookkeeping (loaded names) without emitting reference edges."""
        self.suppress += 1
        try:
            node.visit(self)
        finally:
            self.suppress -= 1

    def emit(self, via: tuple[str, ...], node: cst.CSTNode, kind: str = "references") -> None:
        if not via or self.suppress:
            return
        location = self.loc(node)
        for dst in via:
            self.g.add_edge(self.owner, dst, kind, location=location)

    def edge_kind(self, node: cst.CSTNode) -> str:
        if node in self.depends_targets:
            return "depends_on"
        return "calls" if node in self.call_funcs else "references"

    def enter(self, owner: str, local: LocalCtx | None) -> None:
        self.owners.append(owner)
        if local is not None:
            self.locals.append(local)

    def leave(self, local: bool) -> None:
        self.owners.pop()
        if local:
            self.locals.pop()

    # ---- definitions -----------------------------------------------------------------------

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        node_id = self.ids.get(node)
        if node_id is None:
            return True  # nested function: its references belong to the enclosing owner
        attrs = self.g.nodes[node_id].attrs
        info = self.p.classes.get(attrs.get("class_id", ""))
        local = self.r.local_for_function(self.m, node, info, attrs.get("is_static", False))
        handled: set[cst.Decorator] = set()
        for hook in self.hooks:
            handled |= hook.on_function(self, node, node_id)
        for decorator in node.decorators:
            if decorator not in handled:
                decorator.visit(self)
        self.enter(node_id, local)
        node.params.visit(self)
        if node.returns is not None:
            node.returns.visit(self)
        node.body.visit(self)
        self.leave(True)
        return False

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        node_id = self.ids.get(node)
        if node_id is None:
            return True
        for decorator in node.decorators:
            decorator.visit(self)
        self.enter(node_id, None)
        for base in node.bases:
            base.visit(self)
        for keyword in node.keywords:
            keyword.visit(self)
        node.body.visit(self)
        self.leave(False)
        return False

    # ---- imports ---------------------------------------------------------------------------

    def visit_Import(self, node: cst.Import) -> bool:
        if self.locals:
            for alias in node.names:
                module = dotted(alias.name) or ""
                parts = module.split(".")
                for i in range(len(parts)):
                    self.emit_module(".".join(parts[: i + 1]), node, "imports")
                if alias.asname and isinstance(alias.asname.name, cst.Name):
                    self.locals[-1].types[alias.asname.name.value] = self.r.module_res(module).ent
                else:
                    self.locals[-1].types[parts[0]] = self.r.module_res(parts[0]).ent
        return False

    def visit_ImportFrom(self, node: cst.ImportFrom) -> bool:
        if not self.locals or isinstance(node.names, cst.ImportStar):
            return False
        target = absolute_module(self.m, len(node.relative), dotted(node.module))
        parts = target.split(".") if target else []
        for i in range(len(parts)):
            self.emit_module(".".join(parts[: i + 1]), node, "imports")
        for alias in node.names:
            symbol = dotted(alias.name) or ""
            local = alias.asname.name.value if alias.asname else symbol
            if target in self.p.modules or self.r.is_internal(target):
                res = self.r.lookup_member(target, symbol, set()) or None
            else:
                res = None
            if res is None:
                ref = f"{target}.{symbol}" if target else symbol
                self.locals[-1].types[local] = Ent("external", ref)
                continue
            self.emit(res.via, node, "imports")
            self.locals[-1].types[local] = res.ent
        return False

    def emit_module(self, name: str, node: cst.CSTNode, kind: str) -> None:
        mod = self.p.modules.get(name)
        if mod:
            self.emit((mod.node_id,), node, kind)

    # ---- expressions -----------------------------------------------------------------------

    def visit_Expr(self, node: cst.Expr) -> None:
        value = node.value
        if isinstance(value, cst.SimpleString):
            self.skip_strings.add(value)
        elif isinstance(value, cst.ConcatenatedString):
            self.skip_strings.add(value.left)
            self.skip_strings.add(value.right)

    def visit_Annotation(self, node: cst.Annotation) -> None:
        self.annotation_depth += 1

    def leave_Annotation(self, original_node: cst.Annotation) -> None:
        self.annotation_depth -= 1

    def visit_SimpleString(self, node: cst.SimpleString) -> None:
        value = node.evaluated_value
        if not isinstance(value, str):
            return
        if self.annotation_depth:
            self.string_annotation(node, value)
        elif node not in self.skip_strings:
            self.p.string_literals.append(StringLit(value, self.m.path, self.loc(node).line))

    def visit_FormattedStringText(self, node: cst.FormattedStringText) -> None:
        self.p.string_literals.append(StringLit(node.value, self.m.path, self.current_line))

    def string_annotation(self, node: cst.SimpleString, value: str) -> None:
        try:
            parsed = cst.parse_expression(value)
        except cst.ParserSyntaxError:
            return
        line = self.loc(node)
        self.glob_only = True
        try:
            parsed.visit(self)
        finally:
            self.glob_only = False
        self.current_line = line.line

    def visit_Name(self, node: cst.Name) -> None:
        if self.glob_only:
            if node.value in self.m.defs or node.value in self.m.bindings:
                self.m.loaded.add(node.value)
            self.emit(self.r.eval_name(self.m, node, None, True).via, node)
            return
        if self.m.contexts.get(node) != ExpressionContext.LOAD:
            return
        scope = self.m.scopes.get(node)
        if scope is None:
            return
        if any(isinstance(a.scope, GlobalScope) for a in scope[node.value]):
            self.m.loaded.add(node.value)
        res = self.r.eval_name(self.m, node, self.local, False)
        self.emit(res.via, node, self.edge_kind(node))

    def visit_Attribute(self, node: cst.Attribute) -> bool:
        if self.glob_only:
            res = self.r.eval_attribute(self.m, node, None, True)
            self.emit(res.via, node)
            return True
        if self.m.contexts.get(node) in (ExpressionContext.STORE, ExpressionContext.DEL):
            return True
        res = self.r.eval_attribute(self.m, node, self.local, False)
        self.emit(res.via, node, self.edge_kind(node))
        if res.miss:
            self.p.unresolved_attrs.setdefault(node.attr.value, []).append(self.loc(node))
        return True

    def visit_Call(self, node: cst.Call) -> bool:
        for hook in self.hooks:
            if hook.on_call(self, node):
                return False
        self.call_funcs.add(node.func)
        name = dotted(node.func)
        if node.args and isinstance(node.func, cst.Name | cst.Attribute):
            if self.r.external_name(self.m, node.func, self.local) in DEPENDS_CALLS:
                self.depends_targets.add(node.args[0].value)
        if name in DYNAMIC_CALLS or (name == "getattr" and self.module_like(node)):
            self.m.dynamic.append(self.loc(node))
        return True

    def module_like(self, call: cst.Call) -> bool:
        if not call.args:
            return False
        first = call.args[0].value
        if isinstance(first, cst.Subscript) and dotted(first.value) == "sys.modules":
            return True
        if isinstance(first, cst.Name | cst.Attribute):
            return self.r.eval(self.m, first, self.local).ent.kind == "module"
        return False

    def visit_Subscript(self, node: cst.Subscript) -> None:
        if isinstance(node.value, cst.Call) and dotted(node.value.func) in ("globals",):
            self.m.dynamic.append(self.loc(node))

    # ---- local type tracking ---------------------------------------------------------------

    def visit_Assign(self, node: cst.Assign) -> None:
        if not self.locals:
            return
        res = self.r.eval(self.m, node.value, self.local)
        for target in node.targets:
            if isinstance(target.target, cst.Name) and res.ent.kind == "instance":
                self.locals[-1].types[target.target.value] = res.ent

    def visit_AnnAssign(self, node: cst.AnnAssign) -> None:
        if self.locals and isinstance(node.target, cst.Name):
            cls = self.r.annotation_class(self.m, node.annotation, self.local)
            if cls:
                self.locals[-1].types[node.target.value] = Ent("instance", cls)


def extract_references(project: ProjectIndex, resolver: Resolver, hooks=()) -> None:
    for mod in project.modules.values():
        assert mod.tree is not None
        mod.tree.visit(ReferenceVisitor(project, resolver, mod, hooks))
