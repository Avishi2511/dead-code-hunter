"""Subgraph queries over a stored graph (repos are small, so everything runs in memory)."""

from __future__ import annotations

from collections import defaultdict

from dch.result import GraphData, GraphEdge
from dch_api.schemas import GraphView

NEIGHBORHOOD_CAP = 60
NOISE_EDGES = {"auto_live", "registers_hook"}
MODULE_EDGES = {"imports", "references", "calls", "inherits", "includes_router", "mounts", "depends_on"}


class UnknownNode(KeyError):
    pass


def neighborhood(graph: GraphData, focus: list[str], hops: int = 2, cap: int = NEIGHBORHOOD_CAP) -> GraphView:
    nodes = {n.id: n for n in graph.nodes}
    missing = [f for f in focus if f not in nodes]
    if missing:
        raise UnknownNode(missing[0])
    adjacency: dict[str, list[str]] = defaultdict(list)
    for e in graph.edges:
        if e.kind in NOISE_EDGES or e.src == e.dst:
            continue
        adjacency[e.src].append(e.dst)
        adjacency[e.dst].append(e.src)

    included = list(dict.fromkeys(focus))
    seen = set(included)
    frontier = included[:]
    for _ in range(max(hops, 0)):
        nxt: list[str] = []
        for node_id in frontier:
            for other in adjacency[node_id]:
                if other not in seen and other in nodes and len(seen) < cap:
                    seen.add(other)
                    included.append(other)
                    nxt.append(other)
        frontier = nxt
    hidden = {
        n: count
        for n in included
        if (count := len({o for o in adjacency[n] if o in nodes and o not in seen})) > 0
    }
    edges = [e for e in graph.edges if e.src in seen and e.dst in seen and e.kind not in NOISE_EDGES]
    return GraphView(nodes=[nodes[i] for i in included], edges=edges, focus=focus, hidden=hidden)


def module_projection(graph: GraphData, findings_per_file: dict[str, int]) -> GraphView:
    modules = {n.file: n for n in graph.nodes if n.kind == "module" and n.file}
    file_of = {n.id: n.file for n in graph.nodes if n.file}
    out_nodes = [
        n.model_copy(update={"attrs": {**n.attrs, "finding_count": findings_per_file.get(n.file or "", 0)}})
        for n in modules.values()
    ]
    counts: dict[tuple[str, str, str], int] = defaultdict(int)
    for e in graph.edges:
        if e.kind not in MODULE_EDGES:
            continue
        src, dst = file_of.get(e.src), file_of.get(e.dst)
        if src and dst and src != dst and src in modules and dst in modules:
            counts[(src, dst, e.kind)] += 1
    out_edges = [
        GraphEdge(src=modules[s].id, dst=modules[d].id, kind=kind, attrs={"count": count})
        for (s, d, kind), count in sorted(counts.items())
    ]
    return GraphView(nodes=out_nodes, edges=out_edges)
