"""In-memory code graph shared by all language analyzers and the language-neutral engine."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from dch.result import GraphData, GraphEdge, GraphNode, Location

# Edges that carry liveness from src to dst when src is live.
PROPAGATING = {
    "references",
    "calls",
    "imports",
    "inherits",
    "decorated_by",
    "depends_on",
    "includes_router",
    "mounts",
    "registers_route",
    "handles",
    "root",
    "uses_distribution",
    "registers_hook",
    "auto_live",
    "overrides",
}


@dataclass
class Node:
    id: str
    kind: str
    name: str
    file: str | None = None
    line: int | None = None
    end_line: int | None = None
    language: str = "python"
    attrs: dict[str, Any] = field(default_factory=dict)
    liveness: str = "unknown"
    live_reason: str | None = None


@dataclass
class Edge:
    src: str
    dst: str
    kind: str
    attrs: dict[str, Any] = field(default_factory=dict)
    locations: list[Location] = field(default_factory=list)


ROOT_ID = "<root>"


class CodeGraph:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.edges: list[Edge] = []
        self._out: dict[str, list[Edge]] = defaultdict(list)
        self._in: dict[str, list[Edge]] = defaultdict(list)
        self._seen: set[tuple[str, str, str]] = set()

    def add_node(self, node: Node) -> Node:
        self.nodes[node.id] = node
        return node

    def add_edge(
        self, src: str, dst: str, kind: str, *, location: Location | None = None, **attrs: Any
    ) -> Edge | None:
        if src == dst and kind != "root":
            return None
        key = (src, dst, kind)
        if key in self._seen:
            edge = next(e for e in self._out[src] if e.dst == dst and e.kind == kind)
            if location and location not in edge.locations:
                edge.locations.append(location)
            return edge
        self._seen.add(key)
        edge = Edge(src, dst, kind, dict(attrs), [location] if location else [])
        self.edges.append(edge)
        self._out[src].append(edge)
        self._in[dst].append(edge)
        return edge

    def out_edges(self, node_id: str) -> list[Edge]:
        return self._out.get(node_id, [])

    def in_edges(self, node_id: str) -> list[Edge]:
        return self._in.get(node_id, [])

    def children(self, node_id: str) -> list[Node]:
        return [self.nodes[e.dst] for e in self.out_edges(node_id) if e.kind == "contains"]

    def reachable(self, roots: list[str]) -> dict[str, str]:
        """Fixpoint reachability over propagating edges. Returns node id -> predecessor id."""
        parent: dict[str, str] = {r: ROOT_ID for r in roots if r in self.nodes}
        stack = list(parent)
        while stack:
            current = stack.pop()
            for edge in self.out_edges(current):
                if edge.kind in PROPAGATING and edge.dst in self.nodes and edge.dst not in parent:
                    parent[edge.dst] = current
                    stack.append(edge.dst)
        return parent

    def to_data(self) -> GraphData:
        return GraphData(
            nodes=[
                GraphNode(
                    id=n.id,
                    kind=n.kind,
                    name=n.name,
                    language=n.language,
                    file=n.file,
                    line=n.line,
                    end_line=n.end_line,
                    liveness=n.liveness,
                    live_reason=n.live_reason,
                    attrs=n.attrs,
                )
                for n in self.nodes.values()
            ],
            edges=[
                GraphEdge(src=e.src, dst=e.dst, kind=e.kind, attrs=e.attrs, locations=e.locations)
                for e in self.edges
            ],
        )
