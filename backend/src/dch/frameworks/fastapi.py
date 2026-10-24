"""FastAPI: apps, routers, routes, include/mount edges, and unmounted / shadowed route detection."""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field

import libcst as cst

from dch.frameworks.entrypoints import EntryPoints
from dch.graph.model import Node
from dch.python.model import ProjectIndex
from dch.result import Location

logger = logging.getLogger(__name__)

APP_TYPES = {"fastapi.FastAPI", "fastapi.applications.FastAPI"}
ROUTER_TYPES = {"fastapi.APIRouter", "fastapi.routing.APIRouter"}
VERBS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
ROUTE_DECORATORS = VERBS | {"api_route", "websocket"}
HOOK_DECORATORS = {"on_event", "exception_handler", "middleware"}
DEPENDS = {"fastapi.Depends", "fastapi.params.Depends", "fastapi.Security", "fastapi.params.Security"}
FASTAPI_KINDS = ("router", "fastapi_app")
PARAM = re.compile(r"\{[^}/]*\}")


@dataclass
class RouteReg:
    parent: str
    handler: str
    methods: list[str]
    path: str | None  # None when the path is not a string literal
    decorator_line: int


@dataclass
class FastApiState:
    regs: list[RouteReg] = field(default_factory=list)
    dynamic_includes: list[Location] = field(default_factory=list)


def string_arg(call: cst.Call, index: int, keyword: str) -> cst.BaseExpression | None:
    positional = [a for a in call.args if a.keyword is None and a.star == ""]
    for arg in call.args:
        if arg.keyword is not None and arg.keyword.value == keyword:
            return arg.value
    return positional[index].value if index < len(positional) else None


def literal_string(expr: cst.BaseExpression | None) -> str | None:
    if isinstance(expr, cst.SimpleString):
        value = expr.evaluated_value
        return value if isinstance(value, str) else None
    return None


def literal_methods(expr: cst.BaseExpression | None) -> list[str]:
    if isinstance(expr, cst.List | cst.Tuple):
        return [m.upper() for el in expr.elements if (m := literal_string(el.value))]
    return []


def classify_apps(project: ProjectIndex) -> None:
    """Re-kind module variables created by ``FastAPI()`` / ``APIRouter()``."""
    for node_id, external in project.var_external.items():
        if external not in APP_TYPES | ROUTER_TYPES:
            continue
        node = project.graph.nodes[node_id]
        node.kind = "fastapi_app" if external in APP_TYPES else "router"
        stmt = project.cst_nodes[node_id]
        call = getattr(stmt.body[0], "value", None) if isinstance(stmt, cst.SimpleStatementLine) else None
        prefix = literal_string(string_arg(call, 99, "prefix")) if isinstance(call, cst.Call) else None
        node.attrs["prefix"] = prefix or ""


class FastApiHooks:
    """Hooks called by the reference visitor for FastAPI-specific syntax."""

    def __init__(self, project: ProjectIndex) -> None:
        self.p = project
        self.state: FastApiState = project.extras.setdefault("fastapi", FastApiState())

    def fastapi_nodes(self, v, expr: cst.BaseExpression) -> list[str]:
        res = v.r.eval(v.m, expr, v.local)
        return [n for n in v.r.target_nodes(res.via) if self.p.graph.nodes[n].kind in FASTAPI_KINDS]

    def on_function(self, v, node: cst.FunctionDef, node_id: str) -> set[cst.Decorator]:
        handled: set[cst.Decorator] = set()
        for dec in node.decorators:
            call = dec.decorator if isinstance(dec.decorator, cst.Call) else None
            func = call.func if call else dec.decorator
            if not isinstance(func, cst.Attribute):
                continue
            verb = func.attr.value
            if verb not in ROUTE_DECORATORS | HOOK_DECORATORS:
                continue
            parents = self.fastapi_nodes(v, func.value)
            if not parents:
                continue
            handled.add(dec)
            parent = parents[0]
            line = v.loc(dec).line
            if verb in HOOK_DECORATORS:
                v.g.add_edge(parent, node_id, "registers_hook", location=v.loc(dec))
            else:
                self.register_decorator_route(v, call, verb, parent, node_id, line)
            v.owners.append(node_id)
            v.visit_suppressed(func.value)
            for arg in call.args if call else []:
                arg.visit(v)
            v.owners.pop()
        return handled

    def register_decorator_route(self, v, call, verb, parent, handler, line) -> None:
        path_expr = string_arg(call, 0, "path") if call else None
        path = literal_string(path_expr)
        if verb == "api_route":
            methods = literal_methods(string_arg(call, 99, "methods")) or ["GET"]
        else:
            methods = ["WEBSOCKET" if verb == "websocket" else verb.upper()]
        v.g.nodes[handler].attrs["route_handler"] = True
        self.state.regs.append(RouteReg(parent, handler, methods, path, line))

    def on_call(self, v, node: cst.Call) -> bool:
        func = node.func
        if not isinstance(func, cst.Attribute):
            return False
        name = func.attr.value
        if name == "include_router":
            return self.include_router(v, node, func)
        if name == "mount":
            return self.mount(v, node, func)
        if name == "add_api_route":
            return self.add_api_route(v, node, func)
        return False

    def visit_call_args(self, v, node: cst.Call, func: cst.Attribute, suppressed: set) -> None:
        v.visit_suppressed(func.value)
        for arg in node.args:
            if arg.value in suppressed:
                v.visit_suppressed(arg)
            else:
                arg.visit(v)

    def include_router(self, v, node: cst.Call, func: cst.Attribute) -> bool:
        child_expr = string_arg(node, 0, "router")
        if child_expr is None:
            return False
        children = self.fastapi_nodes(v, child_expr)
        if not children:
            self.state.dynamic_includes.append(v.loc(node))
            return False
        parents = self.fastapi_nodes(v, func.value)
        parent = parents[0] if parents else v.owner
        prefix = literal_string(string_arg(node, 99, "prefix")) or ""
        for child in children:
            edge = v.g.add_edge(parent, child, "includes_router", location=v.loc(node))
            if edge is not None and prefix not in edge.attrs.setdefault("prefixes", []):
                edge.attrs["prefixes"].append(prefix)
        self.visit_call_args(v, node, func, {child_expr})
        return True

    def mount(self, v, node: cst.Call, func: cst.Attribute) -> bool:
        app_expr = string_arg(node, 1, "app")
        if app_expr is None:
            return False
        children = self.fastapi_nodes(v, app_expr)
        if not children:
            return False
        parents = self.fastapi_nodes(v, func.value)
        parent = parents[0] if parents else v.owner
        path = literal_string(string_arg(node, 0, "path")) or ""
        for child in children:
            edge = v.g.add_edge(parent, child, "mounts", location=v.loc(node))
            if edge is not None and path not in edge.attrs.setdefault("prefixes", []):
                edge.attrs["prefixes"].append(path)
        self.visit_call_args(v, node, func, {app_expr})
        return True

    def add_api_route(self, v, node: cst.Call, func: cst.Attribute) -> bool:
        endpoint_expr = string_arg(node, 1, "endpoint")
        parents = self.fastapi_nodes(v, func.value)
        if endpoint_expr is None or not parents:
            return False
        res = v.r.eval(v.m, endpoint_expr, v.local)
        handlers = [n for n in v.r.target_nodes(res.via) if self.p.graph.nodes[n].kind == "function"]
        if not handlers:
            return False
        methods = literal_methods(string_arg(node, 99, "methods")) or ["GET"]
        path = literal_string(string_arg(node, 0, "path"))
        for handler in handlers:
            v.g.nodes[handler].attrs["route_handler"] = True
            self.state.regs.append(RouteReg(parents[0], handler, methods, path, v.loc(node).line))
        self.visit_call_args(v, node, func, {endpoint_expr})
        return True


def normalize_path(path: str) -> str:
    path = re.sub(r"/{2,}", "/", path)
    return path if path.startswith("/") else f"/{path}"


def finalize_routes(project: ProjectIndex) -> None:
    """Compose full paths through include/mount chains and create route nodes + edges."""
    state: FastApiState | None = project.extras.get("fastapi")
    if state is None or not state.regs:
        return
    g = project.graph
    parents_of: dict[str, list[tuple[str, str, Location | None]]] = defaultdict(list)
    for edge in g.edges:
        if edge.kind in ("includes_router", "mounts"):
            site = edge.locations[0] if edge.locations else None
            for prefix in edge.attrs.get("prefixes", [""]):
                parents_of[edge.dst].append((edge.src, prefix, site))
    memo: dict[str, list[str]] = {}

    def outer_prefixes(node_id: str, stack: frozenset[str] = frozenset()) -> list[str]:
        if node_id in memo:
            return memo[node_id]
        if node_id in stack:
            return []
        out: list[str] = []
        node = g.nodes[node_id]
        if node.kind == "fastapi_app" and not parents_of.get(node_id):
            out.append("")
        for parent, prefix, _ in parents_of.get(node_id, []):
            pnode = g.nodes.get(parent)
            if pnode is None:
                continue
            if pnode.kind in FASTAPI_KINDS:
                own = pnode.attrs.get("prefix", "") if pnode.kind == "router" else ""
                out.extend(f"{outer}{own}{prefix}" for outer in outer_prefixes(parent, stack | {node_id}))
            else:
                out.append(prefix)
        memo[node_id] = out
        return out

    def site_order(node_id: str) -> tuple[str, int]:
        sites = [s for _, _, s in parents_of.get(node_id, []) if s]
        return min(((s.file, s.line) for s in sites), default=("", 0))

    planned: list[tuple[RouteReg, str, str, bool]] = []
    for reg in state.regs:
        parent = g.nodes[reg.parent]
        own = parent.attrs.get("prefix", "") if parent.kind == "router" else ""
        outers = outer_prefixes(reg.parent)
        path = reg.path if reg.path is not None else "{dynamic}"
        fulls = [(f"{o}{own}{path}", True) for o in outers] or [(f"{own}{path}", False)]
        for full, mounted in fulls:
            for method in reg.methods:
                planned.append((reg, method, normalize_path(full), mounted))

    planned.sort(key=lambda item: (site_order(item[0].parent), g.nodes[item[0].handler].file or "",
                                   g.nodes[item[0].handler].line or 0))  # fmt: skip
    first_seen: dict[tuple[str, str], str] = {}
    for reg, method, full, mounted in planned:
        handler = g.nodes[reg.handler]
        route_id = f"{project.repo}:route#{method} {full}"
        if route_id in g.nodes:
            route_id = f"{route_id}@{handler.file}:{handler.line}"
        route = g.add_node(Node(
            route_id, "route", f"{method} {full}", handler.file, handler.line, handler.end_line,
            attrs={"method": method, "full_path": full, "router": reg.parent, "handler": reg.handler,
                   "mounted": mounted, "dynamic_path": reg.path is None,
                   "decorator_line": reg.decorator_line},
        ))  # fmt: skip
        g.add_edge(route_id, reg.handler, "handles")
        shadow_key = (method, PARAM.sub("{}", full))
        if mounted and reg.path is not None and shadow_key in first_seen:
            route.attrs["shadowed_by"] = first_seen[shadow_key]
            continue
        if mounted and reg.path is not None:
            first_seen[shadow_key] = route_id
        g.add_edge(reg.parent, route_id, "registers_route")


def app_roots(project: ProjectIndex, entry: EntryPoints) -> tuple[dict[str, str], list[str]]:
    apps = [n for n in project.graph.nodes.values() if n.kind == "fastapi_app"]
    roots: dict[str, str] = {}
    for app in apps:
        module = project.modules[project.node_module[app.id]]
        if module.name in entry.modules:
            roots[app.id] = f"FastAPI app in entry module ({entry.modules[module.name]})"
    warnings: list[str] = []
    if apps and not roots:
        for app in apps:
            module = project.modules[project.node_module[app.id]]
            roots[app.id] = "FastAPI app (no entry module detected)"
            roots[module.node_id] = "module defining a FastAPI app"
        warnings.append("No ASGI entry point detected; treating every FastAPI() instance as a root")
    return roots, warnings
