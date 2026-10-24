"""Reference verification: ask a type checker for references to each dead-code candidate."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Protocol

import libcst as cst

from dch.engine.detectors import Candidate
from dch.graph.model import Node
from dch.python.model import ProjectIndex
from dch.result import Location

logger = logging.getLogger(__name__)

VERIFIED_TYPES = {"unused_function", "unused_class", "unused_method", "unused_variable"}


@dataclass(frozen=True)
class RefLocation:
    file: str
    line: int


class Verifier(Protocol):
    name: str

    def references(self, file: str, source: str, line: int, column: int) -> list[RefLocation] | None: ...

    def close(self) -> None: ...


@dataclass
class VerificationOutcome:
    verified_no_refs: set[str]
    dropped: list[tuple[str, str]]  # (candidate name, live referrer name)
    only_dead_refs: dict[str, list[Location]]
    checked: int = 0
    skipped: int = 0


def name_position(project: ProjectIndex, node: Node) -> tuple[int, int] | None:
    """Line (1-based) and column (0-based) of the identifier defining ``node``."""
    cst_node = project.cst_nodes.get(node.id)
    mod = project.by_path.get(node.file or "")
    if mod is None or cst_node is None:
        return None
    target: cst.CSTNode | None = None
    if isinstance(cst_node, cst.FunctionDef | cst.ClassDef):
        target = cst_node.name
    elif isinstance(cst_node, cst.SimpleStatementLine) and cst_node.body:
        small = cst_node.body[0]
        if isinstance(small, cst.Assign):
            target = small.targets[0].target
        elif isinstance(small, cst.AnnAssign):
            target = small.target
    pos = mod.positions.get(target) if target is not None else None
    return (pos.start.line, pos.start.column) if pos else None


def owner_of(project: ProjectIndex, ref: RefLocation) -> Node | None:
    """Innermost graph node enclosing a reference; ``None`` for import statements."""
    best: Node | None = None
    for node in project.graph.nodes.values():
        if node.file != ref.file or node.line is None or node.end_line is None:
            continue
        if not node.line <= ref.line <= node.end_line:
            continue
        if node.kind == "import":
            return None
        if node.kind in ("module", "function", "method", "class") and (
            best is None or (node.end_line - node.line) < ((best.end_line or 0) - (best.line or 0))
        ):
            best = node
    return best


def verify_candidates(
    project: ProjectIndex, candidates: list[Candidate], verifier: Verifier, deadline: float | None
) -> VerificationOutcome:
    outcome = VerificationOutcome(set(), [], {})
    graph = project.graph
    for cand in list(candidates):
        if cand.type not in VERIFIED_TYPES:
            continue
        if deadline is not None and time.monotonic() > deadline:
            outcome.skipped += 1
            continue
        node = graph.nodes[cand.node_id]
        position = name_position(project, node)
        mod = project.by_path.get(cand.file)
        if position is None or mod is None:
            continue
        try:
            refs = verifier.references(cand.file, mod.source, *position)
        except Exception as exc:  # noqa: BLE001 - a flaky verifier must never fail the scan
            logger.warning("Verifier failed on %s: %s", cand.name, exc)
            continue
        if refs is None:
            continue
        outcome.checked += 1
        external = []
        for ref in refs:
            owner = owner_of(project, ref)
            if owner is None or (owner.file == node.file and node.line <= ref.line <= (node.end_line or 0)):
                continue  # import statement, the definition itself or its own body
            external.append((ref, owner))
        live = [owner for _, owner in external if owner.liveness == "live"]
        if live:
            candidates.remove(cand)
            outcome.dropped.append((cand.name, live[0].name))
            logger.info("Verifier found a live reference to %s from %s", cand.name, live[0].name)
        elif external:
            outcome.only_dead_refs[cand.node_id] = [Location(file=r.file, line=r.line) for r, _ in external]
        else:
            outcome.verified_no_refs.add(cand.node_id)
    return outcome
