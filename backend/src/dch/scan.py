"""The scan pipeline: source tree in, ``ScanResult`` out."""

from __future__ import annotations

import logging
import time
from collections import Counter
from collections.abc import Callable

from dch.cleanup.engine import compute_suggestions
from dch.config import load_config
from dch.deps.analyze import analyze_dependencies
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
from dch.verify.run import run_verification

logger = logging.getLogger(__name__)

ProgressReporter = Callable[[str, int, str], None]
SYMBOL_KINDS = {"function", "class", "method", "variable"}


def _noop(stage: str, percent: int, message: str) -> None:
    return None


def scan_tree(
    tree: SourceTree,
    *,
    reporter: ProgressReporter = _noop,
    include_graph: bool = False,
    verifier: str = "none",
    time_budget_s: float | None = None,
    suggestions: bool = True,
    static_checks: bool = True,
) -> ScanResult:
    started = time.perf_counter()
    deadline = time.monotonic() + time_budget_s if time_budget_s else None
    graph = CodeGraph()
    reporter("parsing", 10, f"Parsing {len(tree.py_files)} Python files")
    project, resolver = build_python_graph(tree, graph)
    config = load_config(tree.files)

    reporter("analyzing", 50, "Finding entry points and computing reachability")
    entry = find_entrypoints(project, tree.files, config)
    framework_roots = apply_decorator_frameworks(project, resolver)
    apps, app_warnings = app_roots(project, entry)
    dep_candidates, dep_roots = analyze_dependencies(project, tree.files, config)
    roots = production_roots(project, entry, {**framework_roots, **apps, **dep_roots})
    compute_liveness(graph, roots, test_roots(project))

    reporter("analyzing", 70, "Detecting dead code")
    candidates = [*detect_all(project, config), *dep_candidates]

    reporter("verifying", 78, "Verifying references with a type checker")
    outcome, verify_warnings = run_verification(project, tree.files, candidates, verifier, deadline)

    reporter("scoring", 90, "Scoring findings")
    ctx = ScoringContext(
        project,
        resolver,
        StringIndex(project),
        TextIndex(tree.files),
        any_dynamic_import=any(m.dynamic for m in project.modules.values()),
        verified_no_refs=outcome.verified_no_refs if outcome else set(),
    )
    scorer = Scorer(ctx)
    findings = [scorer.score(c) for c in candidates]
    findings.sort(key=lambda f: (-f.confidence, f.file, f.line, f.name))

    suggestion_warnings: list[str] = []
    if suggestions:
        reporter("suggestions", 95, "Preparing suggested changes")
        suggestion_warnings = compute_suggestions(
            tree,
            ScanResult(repo=tree.repo, findings=findings),
            static_checks=static_checks,
            deadline=deadline,
        )
    covered = {cid for f in findings if f.suggestion for cid in f.suggestion.contains_ids}

    warnings = [
        *tree.warnings,
        *project.warnings,
        *config.warnings,
        *app_warnings,
        *verify_warnings,
        *suggestion_warnings,
    ]
    if not entry.modules:
        warnings.append("No entry points detected; unreferenced modules cannot be judged reliably")
    stats = ScanStats(
        python_files=len(tree.py_files),
        modules=len(project.modules),
        symbols=sum(1 for n in graph.nodes.values() if n.kind in SYMBOL_KINDS),
        findings_by_type=dict(Counter(f.type for f in findings)),
        findings_by_level=dict(Counter(f.level for f in findings)),
        potential_cleanup_lines=sum(
            f.impact_lines for f in findings if f.level != "low" and f.id not in covered
        ),
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
