"""Static validation of a cleanup: compileall, ruff and type-checker diagnostics vs a baseline.

Nothing here imports or runs the analyzed project, and its test suite is never executed.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

from dch.result import ValidationReport
from dch.verify.run import materialise

logger = logging.getLogger(__name__)

RUFF_RULES = "F401,F811,F821"
SUBPROCESS_TIMEOUT_S = 120
# Explicit encoding: Windows would otherwise use cp1252 and fail on non-ASCII source text.
TEXT_RUN = {"capture_output": True, "text": True, "encoding": "utf-8", "errors": "replace"}


def ruff_issues(path: str, source: str) -> Counter[tuple[str, str, str]]:
    """Counter of (file, rule, message) for the selected pyflakes rules."""
    proc = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--isolated", "--select", RUFF_RULES,
         "--output-format", "json", "--stdin-filename", path, "-"],  # fmt: skip
        input=source, **TEXT_RUN, timeout=SUBPROCESS_TIMEOUT_S, check=False,
    )  # fmt: skip
    if proc.returncode not in (0, 1):
        raise RuntimeError(f"ruff failed: {proc.stderr.strip()[:200]}")
    return Counter((path, d["code"], d["message"]) for d in json.loads(proc.stdout or "[]"))


def find_basedpyright() -> str | None:
    scripts = Path(sys.executable).parent
    for name in ("basedpyright.exe", "basedpyright"):
        if (scripts / name).exists():
            return str(scripts / name)
    return None


def scrub_root(message: str, root: Path) -> str:
    """Remove the temporary directory from a diagnostic so runs on different trees compare equal."""
    for variant in {str(root), root.as_posix(), str(root).replace("\\", "/")}:
        message = re.sub(re.escape(variant), "", message, flags=re.IGNORECASE)
    return message.strip()


def typecheck_errors(files: dict[str, str]) -> Counter[tuple[str, str, str]] | None:
    executable = find_basedpyright()
    if executable is None:
        return None
    errors: Counter[tuple[str, str, str]] = Counter()
    with tempfile.TemporaryDirectory(prefix="dch-typecheck-") as tmp:
        root = Path(tmp).resolve()
        materialise(files, root)
        proc = subprocess.run(
            [executable, "--outputjson", str(root)],
            **TEXT_RUN, timeout=SUBPROCESS_TIMEOUT_S, cwd=root, check=False,
        )  # fmt: skip
        try:
            report = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError("basedpyright produced no JSON report") from exc
        for diag in report.get("generalDiagnostics", []):
            if diag.get("severity") != "error":
                continue
            try:
                rel = Path(diag["file"]).resolve().relative_to(root).as_posix()
            except ValueError:
                rel = diag["file"]
            errors[(rel, diag.get("rule", ""), scrub_root(diag["message"], root))] += 1
    return errors


def format_issue(issue: tuple[str, str, str]) -> str:
    file, code, message = issue
    return f"{file}: {code} {message}".strip()


def validate_cleanup(
    old_files: dict[str, str], new_files: dict[str, str], *, typecheck: str = "auto",
    deadline: float | None = None,
) -> ValidationReport:  # fmt: skip
    """Compare the cleaned tree with the original. Failures are reported, never raised."""
    report = ValidationReport()
    changed_py = [p for p in new_files if p.endswith(".py") and old_files.get(p) != new_files[p]]

    if changed_py:
        with tempfile.TemporaryDirectory(prefix="dch-compile-") as tmp:
            materialise({p: new_files[p] for p in changed_py}, Path(tmp))
            proc = subprocess.run(
                [sys.executable, "-m", "compileall", "-q", "-f", *changed_py],
                **TEXT_RUN, cwd=tmp, timeout=SUBPROCESS_TIMEOUT_S, check=False,
            )  # fmt: skip
        report.compileall = "pass" if proc.returncode == 0 else "fail"
        if proc.returncode != 0:
            report.notes.append(f"compileall: {(proc.stdout + proc.stderr).strip()[:300]}")
    else:
        report.compileall = "pass"

    try:
        new_issues: Counter = Counter()
        for path in changed_py:
            before = ruff_issues(path, old_files[path]) if path in old_files else Counter()
            new_issues += ruff_issues(path, new_files[path]) - before
        report.ruff_new_issues = [format_issue(i) for i in sorted(new_issues.elements())]
        report.ruff = "fail" if new_issues else "pass"
    except (RuntimeError, OSError, UnicodeError, subprocess.SubprocessError) as exc:
        report.ruff = "skipped"
        report.notes.append(f"ruff skipped: {exc}")

    if typecheck == "none" or (deadline is not None and time.monotonic() > deadline):
        report.typecheck = "skipped"
        report.notes.append("type check skipped")
        return report
    try:
        after = typecheck_errors(new_files)
        if after is None:
            report.typecheck = "skipped"
            report.notes.append("type check skipped: basedpyright is not installed")
            return report
        before = typecheck_errors(old_files) or Counter()
        fresh = after - before
        report.typecheck_new_errors = [format_issue(i) for i in sorted(fresh.elements())]
        report.typecheck = "fail" if fresh else "pass"
    except (RuntimeError, OSError, UnicodeError, subprocess.SubprocessError) as exc:
        report.typecheck = "skipped"
        report.notes.append(f"type check skipped: {exc}")
    return report
