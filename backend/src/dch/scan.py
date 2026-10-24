"""The scan pipeline: source tree in, ``ScanResult`` out."""

from __future__ import annotations

import logging
import time
from collections import Counter
from collections.abc import Callable

from dch.config import load_config
from dch.engine.detectors import detect_all
from dch.engine.index import StringIndex, TextIndex
from dch.engine.liveness import compute_liveness, production_roots, test_roots
from dch.engine.scoring import Scorer, ScoringContext
from dch.frameworks.decorators import apply_decorator_frameworks
from dch.frameworks.entrypoints import find_entrypoints
from dch.frameworks.fastapi import app_roots
from dch.graph.model import CodeGraph
from dch.python.builder import build_python_graph
from dch.result import ScanResult, ScanStats
from dch.source.base import SourceTree

logger = logging.getLogger(__name__)

ProgressReporter = Callable[[str, int, str], None]
SYMBOL_KINDS = {"function", "class", "method", "variable"}


def _noop(stage: str, percent: int, message: str) -> None:
    return None


def scan_tree(
    tree: SourceTree, *, reporter: ProgressReporter = _noop, include_graph: bool = False
) -> ScanResult:
    started = time.perf_counter()
    graph = CodeGraph()
    reporter("parsing", 10, f"Parsing {len(tree.py_files)} Python files")
    project, resolver = build_python_graph(tree, graph)
    config = load_config(tree.files)

    reporter("analyzing", 50, "Finding entry points and computing reachability")
    entry = find_entrypoints(project, tree.files, config)
    framework_roots = apply_decorator_frameworks(project, resolver)
    apps, app_warnings = app_roots(project, entry)
    roots = production_roots(project, entry, {**framework_roots, **apps})
    compute_liveness(graph, roots, test_roots(project))

    reporter("analyzing", 70, "Detecting dead code")
    candidates = detect_all(project, config)

    reporter("scoring", 85, "Scoring findings")
    ctx = ScoringContext(
        project,
        resolver,
        StringIndex(project),
        TextIndex(tree.files),
        any_dynamic_import=any(m.dynamic for m in project.modules.values()),
    )
    scorer = Scorer(ctx)
    findings = [scorer.score(c) for c in candidates]
    findings.sort(key=lambda f: (-f.confidence, f.file, f.line, f.name))

    warnings = [*tree.warnings, *project.warnings, *config.warnings, *app_warnings]
    if not entry.modules:
        warnings.append("No entry points detected; unreferenced modules cannot be judged reliably")
    stats = ScanStats(
        python_files=len(tree.py_files),
        modules=len(project.modules),
        symbols=sum(1 for n in graph.nodes.values() if n.kind in SYMBOL_KINDS),
        findings_by_type=dict(Counter(f.type for f in findings)),
        findings_by_level=dict(Counter(f.level for f in findings)),
        potential_cleanup_lines=sum(f.impact_lines for f in findings if f.level != "low"),
        duration_s=round(time.perf_counter() - started, 3),
    )
    reporter("done", 100, f"{len(findings)} findings")
    return ScanResult(
        repo=tree.repo,
        commit_sha=tree.commit_sha,
        stats=stats,
        warnings=warnings,
        findings=findings,
        graph=graph.to_data() if include_graph else None,
    )
