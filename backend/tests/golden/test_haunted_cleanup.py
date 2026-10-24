"""Golden cleanup: apply real patches to a copy of the seeded fixture and re-check the result."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from dch.cleanup.engine import run_cleanup
from dch.result import CleanupResult, Selection
from dch.scan import scan_tree
from dch.source.base import LocalDirSource, SourceTree

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "haunted-fastapi"
HAS_GIT = shutil.which("git") is not None


@pytest.fixture(scope="module")
def tree() -> SourceTree:
    return LocalDirSource(FIXTURE).load()


@pytest.fixture(scope="module")
def scan(tree):
    return scan_tree(tree)


@pytest.fixture(scope="module")
def high_cleanup(tree, scan) -> CleanupResult:
    selections = [Selection(finding_id=f.id) for f in scan.findings if f.level == "high"]
    return run_cleanup(tree, scan, selections)


def test_high_confidence_cleanup_passes_static_validation(high_cleanup):
    v = high_cleanup.validation
    assert v.compileall == "pass"
    assert v.ruff == "pass", v.ruff_new_issues
    assert v.typecheck in ("pass", "skipped"), v.typecheck_new_errors


def test_report_and_patch_describe_the_cleanup(high_cleanup):
    assert high_cleanup.summary.findings == 17
    assert high_cleanup.patch.startswith("From ")
    assert "Subject: [PATCH] Remove dead code" in high_cleanup.patch
    assert "# Dead Code Cleanup Report" in high_cleanup.report_md
    assert "git apply dead-code-cleanup.patch" in high_cleanup.report_md
    assert "Static checks only" in high_cleanup.report_md


@pytest.mark.skipif(not HAS_GIT, reason="git is not installed")
def test_generated_patch_applies_with_git_and_removes_the_findings(tmp_path, tree, scan, high_cleanup):
    for path, text in tree.files.items():
        target = tmp_path / path
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
    patch = tmp_path / "cleanup.patch"
    patch.write_text(high_cleanup.patch, encoding="utf-8", newline="")
    for args in (["--check"], []):
        done = subprocess.run(
            ["git", "apply", *args, "cleanup.patch"], cwd=tmp_path, capture_output=True, text=True
        )
        assert done.returncode == 0, done.stderr
    patch.unlink()

    after = scan_tree(LocalDirSource(tmp_path).load(), suggestions=False)
    before_high = {(f.type, f.file, f.name) for f in scan.findings if f.level == "high"}
    remaining = {(f.type, f.file, f.name) for f in after.findings}
    assert not before_high & remaining
    assert not [f for f in after.findings if f.level == "high"]


def test_selecting_every_finding_still_yields_valid_python(tree, scan):
    selections = [
        Selection(finding_id=f.id) for f in scan.findings if not (f.suggestion and f.suggestion.manual)
    ]
    result = run_cleanup(tree, scan, selections, typecheck="none")
    assert result.validation.compileall == "pass"
    assert result.summary.findings > 0


def test_mark_alive_selection_is_recorded_and_honoured(tree, scan):
    target = next(f for f in scan.findings if f.name == "handle_created")
    result = run_cleanup(tree, scan, [Selection(finding_id=target.id, action="mark_alive")], validate=False)
    assert "+++ b/.deadcodehunter.toml" in result.diff
    assert 'target = "app/dispatch.py#handle_created"' in result.diff
