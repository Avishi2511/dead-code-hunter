"""Roots and the production / test reachability fixpoints."""

from __future__ import annotations

from dch.frameworks.entrypoints import EntryPoints
from dch.graph.model import CodeGraph
from dch.python.model import ProjectIndex


def production_roots(
    project: ProjectIndex, entry: EntryPoints, extra: dict[str, str] | None = None
) -> dict[str, str]:
    roots: dict[str, str] = dict(extra or {})
    for name, reason in entry.modules.items():
        roots[project.modules[name].node_id] = f"entry point: {reason}"
    for module, attr, reason in entry.symbols:
        for node_id in project.modules[module].defs.get(attr, []):
            roots[node_id] = f"entry point: {reason}"
    return roots


def test_roots(project: ProjectIndex) -> list[str]:
    roots = []
    for node in project.graph.nodes.values():
        mod = project.by_path.get(node.file or "")
        if mod is not None and mod.is_test:
            roots.append(node.id)
    return roots


def compute_liveness(graph: CodeGraph, prod: dict[str, str], tests: list[str]) -> None:
    prod_parent = graph.reachable(list(prod))
    test_parent = graph.reachable(tests)
    for node in graph.nodes.values():
        if node.id in prod_parent:
            node.liveness = "live"
            node.live_reason = prod.get(node.id) or f"referenced by {prod_parent[node.id]}"
        elif node.id in test_parent:
            node.liveness = "test_only"
            node.live_reason = "only reachable from tests"
        else:
            node.liveness = "dead"
