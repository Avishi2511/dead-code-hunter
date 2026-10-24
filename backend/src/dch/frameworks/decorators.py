"""Decorator-driven frameworks: Pydantic / SQLAlchemy hooks and Celery tasks."""

from __future__ import annotations

import logging

import libcst as cst

from dch.python.model import ProjectIndex
from dch.python.resolve import Resolver

logger = logging.getLogger(__name__)

HOOK_PREFIXES = ("pydantic.", "pydantic_core.", "sqlalchemy.", "pytest.")
CELERY_TASKS = {"celery.Celery.task", "celery.shared_task", "celery.task", "celery.app.shared_task"}
LISTENERS = {"sqlalchemy.event.listens_for", "sqlalchemy.event.api.listens_for"}


def decorator_externals(project: ProjectIndex, resolver: Resolver, node_id: str) -> list[str]:
    node = project.cst_nodes[node_id]
    if not isinstance(node, cst.FunctionDef | cst.ClassDef):
        return []
    mod = project.modules[project.node_module[node_id]]
    names = []
    for dec in node.decorators:
        name = resolver.external_name(mod, dec.decorator)
        if name:
            names.append(name)
    return names


def apply_decorator_frameworks(project: ProjectIndex, resolver: Resolver) -> dict[str, str]:
    """Add framework edges and return extra production roots (node id -> reason)."""
    g = project.graph
    roots: dict[str, str] = {}
    for node in list(g.nodes.values()):
        if node.kind not in ("function", "method"):
            continue
        externals = decorator_externals(project, resolver, node.id)
        if not externals:
            continue
        if node.kind == "method":
            if any(name.startswith(HOOK_PREFIXES) for name in externals):
                g.add_edge(node.attrs["class_id"], node.id, "auto_live")
            continue
        mod = project.modules[project.node_module[node.id]]
        if any(name in CELERY_TASKS for name in externals):
            roots[node.id] = "Celery task"
            roots[mod.node_id] = "module defining a Celery task"
        for dec in project.cst_nodes[node.id].decorators:
            if resolver.external_name(mod, dec.decorator) in LISTENERS:
                register_listener(project, resolver, node.id, dec, mod, roots)
    return roots


def register_listener(project, resolver, node_id, dec, mod, roots) -> None:
    call = dec.decorator
    target = call.args[0].value if isinstance(call, cst.Call) and call.args else None
    classes = []
    if target is not None:
        res = resolver.eval(mod, target)
        classes = [n for n in resolver.target_nodes(res.via) if project.graph.nodes[n].kind == "class"]
    if classes:
        for cls_id in classes:
            project.graph.add_edge(cls_id, node_id, "registers_hook")
    else:
        roots[node_id] = "SQLAlchemy event listener"
