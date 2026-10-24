"""Import resolution and static expression evaluation (the heart of reference extraction)."""

from __future__ import annotations

from dataclasses import dataclass, field

import libcst as cst
from libcst.metadata import BuiltinAssignment, GlobalScope

from dch.python.collect import dotted
from dch.python.model import UNKNOWN, ClassInfo, Ent, ImportBinding, ModuleInfo, ProjectIndex, Res

VARIABLE_KINDS = ("variable", "fastapi_app", "router")


@dataclass
class LocalCtx:
    types: dict[str, Ent] = field(default_factory=dict)
    class_id: str | None = None


class Resolver:
    def __init__(self, project: ProjectIndex) -> None:
        self.p = project
        self._binding_cache: dict[str, Res] = {}
        self._binding_active: set[str] = set()

    # ---- imports ---------------------------------------------------------------------------

    def is_internal(self, dotted_name: str) -> bool:
        return dotted_name in self.p.internal_prefixes

    def binding_target(self, b: ImportBinding) -> Res:
        cached = self._binding_cache.get(b.node_id)
        if cached:
            return cached
        if b.node_id in self._binding_active:
            return Res(UNKNOWN)
        self._binding_active.add(b.node_id)
        try:
            res = self._compute_binding(b)
        finally:
            self._binding_active.discard(b.node_id)
        self._binding_cache[b.node_id] = res
        return res

    def module_res(self, name: str) -> Res:
        if name in self.p.modules:
            return Res(Ent("module", name), (self.p.modules[name].node_id,))
        if self.is_internal(name):
            return Res(Ent("module", name))  # namespace package: no file of its own
        return Res(Ent("external", name))

    def _compute_binding(self, b: ImportBinding) -> Res:
        if b.symbol is None:
            target = b.module if b.asname else b.module.split(".")[0]
            return self.module_res(target)
        if b.module in self.p.modules or self.is_internal(b.module):
            return self.lookup_member(b.module, b.symbol, set()) or Res(UNKNOWN)
        return Res(Ent("external", f"{b.module}.{b.symbol}" if b.module else b.symbol))

    def executed_modules(self, b: ImportBinding) -> list[str]:
        """Repo modules whose code runs when this import statement executes."""
        parts = b.module.split(".") if b.module else []
        names = [".".join(parts[: i + 1]) for i in range(len(parts))] if b.symbol is None else []
        if b.symbol is not None:
            names = [".".join(parts[: i + 1]) for i in range(len(parts))]
            names.append(f"{b.module}.{b.symbol}" if b.module else b.symbol)
        return [n for n in names if n in self.p.modules]

    # ---- module / class member lookup ------------------------------------------------------

    def ent_for_node(self, node_id: str) -> Ent:
        node = self.p.graph.nodes.get(node_id)
        if node is None:
            return UNKNOWN
        if node.kind == "class":
            return Ent("class", node_id)
        if node.kind in ("function", "method"):
            return Ent("function", node_id)
        if node.kind in VARIABLE_KINDS:
            cls = self.p.var_types.get(node_id)
            if cls:
                return Ent("instance", cls)
            external = self.p.var_external.get(node_id)
            return Ent("external", external) if external else Ent("variable", node_id)
        return UNKNOWN

    def lookup_module_name(self, mod: ModuleInfo, name: str, seen: set | None = None) -> Res | None:
        seen = seen if seen is not None else set()
        key = (mod.name, name)
        if key in seen:
            return None
        seen.add(key)
        ids = mod.defs.get(name)
        if ids:
            return Res(self.ent_for_node(ids[-1]), tuple(ids))
        bindings = mod.bindings.get(name)
        if bindings:
            return Res(self.binding_target(bindings[-1]).ent, tuple(b.node_id for b in bindings))
        for star in mod.star_modules:
            target = self.p.modules.get(star)
            if target and (target.exports is None or name in target.exports):
                found = self.lookup_module_name(target, name, seen)
                if found:
                    return found
        return None

    def lookup_member(self, modname: str, member: str, seen: set) -> Res | None:
        sub = f"{modname}.{member}" if modname else member
        if sub in self.p.modules:
            return Res(Ent("module", sub), (self.p.modules[sub].node_id,))
        mod = self.p.modules.get(modname)
        if mod is None:
            return Res(Ent("module", sub)) if self.is_internal(sub) else None
        return self.lookup_module_name(mod, member, seen)

    def class_member(self, cls_id: str, name: str, seen: set | None = None) -> list[str]:
        seen = seen if seen is not None else set()
        if cls_id in seen:
            return []
        seen.add(cls_id)
        info = self.p.classes.get(cls_id)
        if info is None:
            return []
        if info.methods.get(name):
            return list(info.methods[name])
        for base in info.bases:
            if base.kind == "class":
                found = self.class_member(base.ref, name, seen)
                if found:
                    return found
        return []

    def class_attr_type(self, cls_id: str, attr: str, seen: set | None = None) -> str | None:
        seen = seen if seen is not None else set()
        info = self.p.classes.get(cls_id)
        if info is None or cls_id in seen:
            return None
        seen.add(cls_id)
        if attr in info.attr_types:
            return info.attr_types[attr]
        for base in info.bases:
            if base.kind == "class":
                found = self.class_attr_type(base.ref, attr, seen)
                if found:
                    return found
        return None

    def mro(self, cls_id: str) -> list[str]:
        out: list[str] = []
        stack = [cls_id]
        while stack:
            current = stack.pop(0)
            if current in out or current not in self.p.classes:
                continue
            out.append(current)
            stack.extend(b.ref for b in self.p.classes[current].bases if b.kind == "class")
        return out

    def has_unknown_base(self, cls_id: str) -> bool:
        """True if any ancestor is external or unresolvable (members may come from elsewhere)."""
        for cid in self.mro(cls_id):
            for base in self.p.classes[cid].bases:
                if base.kind != "class" and not (base.kind == "builtin" and base.ref == "object"):
                    return True
        return False

    # ---- expression evaluation -------------------------------------------------------------

    def eval(
        self,
        mod: ModuleInfo,
        node: cst.BaseExpression,
        local: LocalCtx | None = None,
        glob_only: bool = False,
    ) -> Res:
        if isinstance(node, cst.Name):
            return self.eval_name(mod, node, local, glob_only)
        if isinstance(node, cst.Attribute):
            return self.eval_attribute(mod, node, local, glob_only)
        if isinstance(node, cst.Call):
            return self.eval_call(mod, node, local, glob_only)
        return Res(UNKNOWN)

    def eval_name(self, mod: ModuleInfo, node: cst.Name, local: LocalCtx | None, glob_only: bool) -> Res:
        name = node.value
        if not glob_only:
            scope = mod.scopes.get(node)
            if scope is None:
                return Res(UNKNOWN)
            assigns = scope[name]
            local_assigns = [
                a
                for a in assigns
                if not isinstance(a, BuiltinAssignment) and not isinstance(a.scope, GlobalScope)
            ]
            if local_assigns:
                ent = local.types.get(name) if local else None
                return Res(ent or UNKNOWN)
            if assigns and all(isinstance(a, BuiltinAssignment) for a in assigns):
                return Res(Ent("builtin", name))
        found = self.lookup_module_name(mod, name)
        if found:
            return found
        return Res(Ent("builtin", name)) if name in ("super", "object") else Res(UNKNOWN)

    def eval_attribute(
        self, mod: ModuleInfo, node: cst.Attribute, local: LocalCtx | None, glob_only: bool
    ) -> Res:
        base = self.eval(mod, node.value, local, glob_only)
        attr = node.attr.value
        kind, ref = base.ent
        if kind == "module":
            return self.lookup_member(ref, attr, set()) or Res(UNKNOWN)
        if kind == "external":
            return Res(Ent("external", f"{ref}.{attr}"))
        if kind in ("class", "instance", "super"):
            cls_id = ref
            if kind == "super":
                ids: list[str] = []
                for b in self.p.classes[cls_id].bases:
                    if b.kind == "class":
                        ids = self.class_member(b.ref, attr)
                        if ids:
                            break
            else:
                ids = self.class_member(cls_id, attr)
            if ids:
                return Res(self.ent_for_node(ids[-1]), tuple(ids))
            typed = self.class_attr_type(cls_id, attr)
            if typed:
                return Res(Ent("instance", typed))
            return Res(UNKNOWN, miss=True)
        return Res(UNKNOWN, miss=kind in ("unknown", "variable", "function"))

    def eval_call(self, mod: ModuleInfo, node: cst.Call, local: LocalCtx | None, glob_only: bool) -> Res:
        func = self.eval(mod, node.func, local, glob_only)
        kind, ref = func.ent
        if kind == "class":
            return Res(Ent("instance", ref))
        if kind == "external":
            return Res(Ent("external", ref))
        if kind == "function" and ref in self.p.func_returns:
            return Res(Ent("instance", self.p.func_returns[ref]))
        if kind == "builtin" and ref == "super" and local and local.class_id:
            return Res(Ent("super", local.class_id))
        return Res(UNKNOWN)

    def target_nodes(self, via: tuple[str, ...]) -> list[str]:
        """Follow import bindings to the symbol/module nodes they finally refer to."""
        out: list[str] = []
        stack = list(via)
        seen: set[str] = set()
        while stack:
            node_id = stack.pop()
            if node_id in seen:
                continue
            seen.add(node_id)
            binding = self.p.binding_by_id.get(node_id)
            if binding is None:
                out.append(node_id)
            else:
                stack.extend(self.binding_target(binding).via)
        return out

    def external_name(
        self, mod: ModuleInfo, node: cst.BaseExpression, local: LocalCtx | None = None
    ) -> str | None:
        """Dotted external name an expression resolves to, e.g. ``fastapi.APIRouter``."""
        if isinstance(node, cst.Call):
            node = node.func
        res = self.eval(mod, node, local)
        return res.ent.ref if res.ent.kind == "external" else None

    # ---- annotations & local typing --------------------------------------------------------

    def annotation_class(
        self,
        mod: ModuleInfo,
        expr: cst.CSTNode | None,
        local: LocalCtx | None = None,
        glob_only: bool = False,
    ) -> str | None:
        if isinstance(expr, cst.Annotation):
            expr = expr.annotation
        if isinstance(expr, cst.SimpleString):
            value = expr.evaluated_value
            if not isinstance(value, str):
                return None
            try:
                parsed = cst.parse_expression(value)
            except cst.ParserSyntaxError:
                return None
            return self.annotation_class(mod, parsed, local, glob_only=True)
        if isinstance(expr, cst.BinaryOperation) and isinstance(expr.operator, cst.BitOr):
            return self.annotation_class(mod, expr.left, local, glob_only) or self.annotation_class(
                mod, expr.right, local, glob_only
            )
        if isinstance(expr, cst.Subscript):
            head = (dotted(expr.value) or "").rsplit(".", 1)[-1]
            if head in ("Optional", "Annotated") and expr.slice:
                inner = expr.slice[0].slice
                if isinstance(inner, cst.Index):
                    return self.annotation_class(mod, inner.value, local, glob_only)
            return None
        if isinstance(expr, cst.Name | cst.Attribute):
            res = self.eval(mod, expr, local, glob_only)
            return res.ent.ref if res.ent.kind == "class" else None
        return None

    def local_for_function(
        self, mod: ModuleInfo, fn: cst.FunctionDef, cls: ClassInfo | None, is_static: bool = False
    ) -> LocalCtx:
        ctx = LocalCtx(class_id=cls.node_id if cls else None)
        params = [*fn.params.posonly_params, *fn.params.params, *fn.params.kwonly_params]
        for i, param in enumerate(params):
            if i == 0 and cls is not None and not is_static:
                ctx.types[param.name.value] = Ent("instance", cls.node_id)
                continue
            if param.annotation is not None:
                cid = self.annotation_class(mod, param.annotation)
                if cid:
                    ctx.types[param.name.value] = Ent("instance", cid)
        return ctx


class _SelfAssigns(cst.CSTVisitor):
    def __init__(self) -> None:
        self.found: list[tuple[str, cst.BaseExpression]] = []

    def visit_Assign(self, node: cst.Assign) -> None:
        for target in node.targets:
            t = target.target
            if isinstance(t, cst.Attribute) and isinstance(t.value, cst.Name) and t.value.value == "self":
                self.found.append((t.attr.value, node.value))

    def visit_AnnAssign(self, node: cst.AnnAssign) -> None:
        t = node.target
        if isinstance(t, cst.Attribute) and isinstance(t.value, cst.Name) and t.value.value == "self":
            self.found.append((t.attr.value, node.annotation))  # type: ignore[arg-type]


def resolve_types(project: ProjectIndex, resolver: Resolver) -> None:
    """Pass A2: class bases, return types, module variable types, ``self.x`` attribute types."""
    for info in project.classes.values():
        mod = project.modules[info.module]
        info.bases = [resolver.eval(mod, e).ent for e in info.base_exprs]
    nodes = project.graph.nodes
    for node_id, node in nodes.items():
        if node.kind in ("function", "method"):
            fn = project.cst_nodes[node_id]
            if isinstance(fn, cst.FunctionDef) and fn.returns is not None:
                mod = project.modules[project.node_module[node_id]]
                cid = resolver.annotation_class(mod, fn.returns)
                if cid:
                    project.func_returns[node_id] = cid
    for _ in range(2):
        for node_id, node in nodes.items():
            if node.kind != "variable" or node_id in project.var_types:
                continue
            stmt = project.cst_nodes[node_id]
            small = stmt.body[0] if isinstance(stmt, cst.SimpleStatementLine) and stmt.body else None
            value = getattr(small, "value", None)
            if isinstance(value, cst.Call):
                mod = project.modules[project.node_module[node_id]]
                res = resolver.eval(mod, value)
                if res.ent.kind == "instance":
                    project.var_types[node_id] = res.ent.ref
                elif res.ent.kind == "external":
                    project.var_external[node_id] = res.ent.ref
    for cid, info in project.classes.items():
        mod = project.modules[info.module]
        cls_node = project.cst_nodes[cid]
        for stmt in cls_node.body.body:
            if isinstance(stmt, cst.SimpleStatementLine):
                for small in stmt.body:
                    if isinstance(small, cst.AnnAssign) and isinstance(small.target, cst.Name):
                        ann = resolver.annotation_class(mod, small.annotation)
                        if ann:
                            info.attr_types[small.target.value] = ann
        for ids in info.methods.values():
            for mid in ids:
                fn = project.cst_nodes[mid]
                if not isinstance(fn, cst.FunctionDef):
                    continue
                local = resolver.local_for_function(mod, fn, info, nodes[mid].attrs.get("is_static", False))
                finder = _SelfAssigns()
                fn.body.visit(finder)
                for attr, value in finder.found:
                    cid2 = None
                    if isinstance(value, cst.Annotation):
                        cid2 = resolver.annotation_class(mod, value, local)
                    elif isinstance(value, cst.Call):
                        res = resolver.eval(mod, value, local)
                        cid2 = res.ent.ref if res.ent.kind == "instance" else None
                    elif isinstance(value, cst.Name):
                        ent = local.types.get(value.value)
                        cid2 = ent.ref if ent and ent.kind == "instance" else None
                    if cid2:
                        info.attr_types.setdefault(attr, cid2)
