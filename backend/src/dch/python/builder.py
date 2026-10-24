"""Assemble the Python part of the code graph from the per-pass results."""

from __future__ import annotations

import logging

from dch.graph.model import CodeGraph
from dch.python.collect import build_index
from dch.python.model import ProjectIndex
from dch.python.references import extract_references
from dch.python.resolve import Resolver, resolve_types
from dch.python.unreachable import find_unreachable
from dch.result import Location
from dch.source.base import SourceTree

logger = logging.getLogger(__name__)


def add_import_edges(project: ProjectIndex, resolver: Resolver) -> None:
    g = project.graph
    for mod in project.modules.values():
        for name in project.ancestors(mod.name):
            g.add_edge(mod.node_id, project.modules[name].node_id, "imports")
        for bindings in mod.bindings.values():
            for b in bindings:
                target = resolver.binding_target(b)
                location = Location(file=mod.path, line=b.line)
                for dst in target.via:
                    g.add_edge(b.node_id, dst, "imports", location=location)
                for executed in resolver.executed_modules(b):
                    g.add_edge(mod.node_id, project.modules[executed].node_id, "imports", location=location)
        for star in mod.star_modules:
            target_mod = project.modules.get(star)
            if target_mod:
                g.add_edge(mod.node_id, target_mod.node_id, "imports")


def add_class_edges(project: ProjectIndex, resolver: Resolver) -> None:
    g = project.graph
    for cls_id, info in project.classes.items():
        for base in info.bases:
            if base.kind == "class":
                g.add_edge(cls_id, base.ref, "inherits")
        if "." in info.qualname:
            outer_qual = info.qualname.rsplit(".", 1)[0]
            outer = project.symbol_id(g.nodes[cls_id].file or "", outer_qual)
            if outer in project.classes:
                g.add_edge(outer, cls_id, "auto_live")
        mro = resolver.mro(cls_id)[1:]
        for name, ids in info.methods.items():
            for mid in ids:
                node = g.nodes[mid]
                if node.kind != "method":
                    continue
                attrs = node.attrs
                if attrs.get("is_dunder") or attrs.get("is_property") or attrs.get("is_abstract"):
                    g.add_edge(cls_id, mid, "auto_live")
                for base_id in mro:
                    for base_method in project.classes[base_id].methods.get(name, []):
                        g.add_edge(base_method, mid, "overrides")


def build_python_graph(tree: SourceTree, graph: CodeGraph) -> tuple[ProjectIndex, Resolver]:
    project = build_index(tree, graph)
    resolver = Resolver(project)
    resolve_types(project, resolver)
    add_import_edges(project, resolver)
    add_class_edges(project, resolver)
    extract_references(project, resolver)
    find_unreachable(project)
    logger.info("Graph: %d nodes, %d edges", len(graph.nodes), len(graph.edges))
    return project, resolver
