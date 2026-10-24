"""Public cleanup API: per-finding suggestions and the combined cleanup."""

from __future__ import annotations

import logging
import subprocess
import time
from collections import Counter

from dch.cleanup.apply import Applied, apply_selections, covers
from dch.cleanup.files import count_changes
from dch.cleanup.report import build_patch, build_report
from dch.result import (
    CleanupResult,
    CleanupSummary,
    Finding,
    ScanResult,
    Selection,
    Suggestion,
)
from dch.source.base import SourceTree
from dch.validate.checks import format_issue, ruff_issues, validate_cleanup

logger = logging.getLogger(__name__)


def index_findings(result: ScanResult) -> dict[str, Finding]:
    return {f.id: f for f in result.findings}


def selection_summary(findings: dict[str, Finding], applied: Applied, selections: list[Selection],
                      diff: str) -> CleanupSummary:  # fmt: skip
    actions = {s.finding_id: s.action for s in selections}
    done = [findings[fid] for fid in applied.applied if fid in findings]
    added, removed = count_changes(diff)
    return CleanupSummary(
        findings=len(done),
        by_type=dict(Counter(f.type for f in done if actions.get(f.id) == "remove")),
        files_changed=len(applied.changed),
        lines_removed=removed,
        lines_added=added,
        covered=sorted(applied.covered),
        manual=sorted(applied.manual),
    )


def run_cleanup(
    tree: SourceTree, scan: ScanResult, selections: list[Selection], *, typecheck: str = "auto",
    validate: bool = True, time_budget_s: float | None = None,
) -> CleanupResult:  # fmt: skip
    """Apply the chosen actions to the scanned files and describe the outcome."""
    from dch.scan import scan_tree  # local import: scan imports this package for suggestions

    deadline = time.monotonic() + time_budget_s if time_budget_s else None
    findings = index_findings(scan)
    known_unused = {f.name for f in scan.findings if f.type == "unused_dependency"}

    def rescan(files: dict[str, str]) -> set[str]:
        rescanned = scan_tree(
            SourceTree(tree.repo, files, tree.commit_sha, prefix=tree.prefix), suggestions=False
        )
        return {f.name for f in rescanned.findings if f.type == "unused_dependency"}

    applied = apply_selections(
        tree.files, findings, selections, rescan=rescan, known_unused_dependencies=known_unused
    )
    diff = applied.diff(tree.prefix)
    summary = selection_summary(findings, applied, selections, diff)
    if validate:
        validation = validate_cleanup(tree.files, applied.files, typecheck=typecheck, deadline=deadline)
    else:
        from dch.result import ValidationReport

        validation = ValidationReport(notes=["validation not requested"])
    return CleanupResult(
        base_commit_sha=tree.commit_sha,
        selections=selections,
        diff=diff,
        patch=build_patch(diff, summary, tree.commit_sha),
        report_md=build_report(findings, selections, applied, summary, validation, tree.commit_sha),
        summary=summary,
        validation=validation,
    )


# ---- per-finding suggestions (precomputed during the scan) ---------------------------------


def static_check(old_files: dict[str, str], applied: Applied) -> tuple[str, list[str]]:
    """ruff F401/F811/F821 on the files a single suggestion changes, versus the original."""
    notes: list[str] = []
    try:
        for path in applied.changed:
            if not path.endswith(".py") or path not in applied.files:
                continue
            before = ruff_issues(path, old_files[path]) if path in old_files else Counter()
            fresh = ruff_issues(path, applied.files[path]) - before
            notes += [format_issue(i) for i in fresh.elements()]
    except (RuntimeError, OSError, UnicodeError, subprocess.SubprocessError) as exc:
        logger.warning("Static check unavailable: %s", exc)
        return "skipped", []
    return ("fail" if notes else "pass"), notes


def note_referrers(finding: Finding, suggestion: Suggestion) -> None:
    """Warn about code outside the removed range that still refers to the finding."""
    if finding.type in ("unused_import", "unused_dependency", "unreachable_code"):
        return
    for ref in finding.references:
        if ref.direction != "incoming" or ref.kind in ("contains", "overrides"):
            continue
        if any(
            loc.file == finding.file and finding.line <= loc.line <= finding.end_line for loc in ref.locations
        ):
            continue
        name = ref.node_id.partition(":")[2]
        if ref.liveness == "test_only":
            suggestion.static_notes.append(f"still referenced from tests: {name}")
            suggestion.static_check = "fail"
        elif ref.liveness == "dead":
            suggestion.static_notes.append(f"still referenced by dead code: {name} (remove it too)")


def compute_suggestions(
    tree: SourceTree, result: ScanResult, *, static_checks: bool = True, deadline: float | None = None
) -> list[str]:  # fmt: skip
    """Fill ``Finding.suggestion`` / ``impact_lines``; returns warnings."""
    findings = index_findings(result)
    warnings: list[str] = []
    skipped_checks = 0
    for finding in result.findings:
        applied = apply_selections(tree.files, findings, [Selection(finding_id=finding.id, action="remove")])
        contains = [o.id for o in result.findings if covers(finding, o)]
        suggestion = Suggestion(contains_ids=contains, cascades=applied.cascades)
        if finding.id in applied.manual:
            suggestion.manual = True
            suggestion.actions = ["mark_alive"]
        else:
            suggestion.diff = applied.diff(tree.prefix)
            _, removed = count_changes(suggestion.diff)
            if removed:
                finding.impact_lines = removed
            if finding.type == "unused_module":
                importers = [
                    r for r in finding.references if r.direction == "incoming" and r.kind == "imports"
                ]
                suggestion.static_check = "fail" if importers else "pass"
                suggestion.static_notes = [f"still imported by {r.node_id}" for r in importers]
            elif static_checks and (deadline is None or time.monotonic() < deadline):
                suggestion.static_check, suggestion.static_notes = static_check(tree.files, applied)
            elif static_checks:
                skipped_checks += 1
        note_referrers(finding, suggestion)
        finding.suggestion = suggestion
    if skipped_checks:
        warnings.append(f"Static checks skipped for {skipped_checks} suggestions (time budget)")
    return warnings
