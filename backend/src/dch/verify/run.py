"""Choose a verifier, materialise the project on disk and run the verification stage."""

from __future__ import annotations

import logging
import tempfile
import time
from pathlib import Path

from dch.engine.detectors import Candidate
from dch.python.model import ProjectIndex
from dch.verify.base import VerificationOutcome, Verifier, verify_candidates

logger = logging.getLogger(__name__)

VERIFIER_CHOICES = ("auto", "basedpyright", "jedi", "none")


def materialise(files: dict[str, str], root: Path) -> None:
    for rel, text in files.items():
        if rel.endswith(".py"):
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "w", encoding="utf-8", newline="") as handle:
                handle.write(text)


def make_verifier(choice: str, root: Path) -> Verifier | None:
    if choice == "none":
        return None
    if choice in ("auto", "basedpyright"):
        from dch.verify.lsp import BasedPyrightVerifier, LspError, find_langserver

        executable = find_langserver()
        if executable:
            try:
                return BasedPyrightVerifier(root, executable)
            except (LspError, OSError) as exc:
                logger.warning("basedpyright unavailable (%s)", exc)
        elif choice == "basedpyright":
            logger.warning("basedpyright-langserver not found; falling back to Jedi")
    from dch.verify.jedi_verifier import JediVerifier

    return JediVerifier(root)


def run_verification(
    project: ProjectIndex, files: dict[str, str], candidates: list[Candidate], choice: str,
    deadline: float | None,
) -> tuple[VerificationOutcome | None, list[str]]:  # fmt: skip
    """Returns the outcome (or ``None`` when skipped) and warnings to surface."""
    if choice == "none":
        return None, []
    if deadline is not None and time.monotonic() > deadline:
        return None, ["Reference verification skipped: scan time budget exhausted"]
    with tempfile.TemporaryDirectory(prefix="dch-verify-") as tmp:
        root = Path(tmp)
        materialise(files, root)
        verifier = make_verifier(choice, root)
        if verifier is None:
            return None, []
        try:
            outcome = verify_candidates(project, candidates, verifier, deadline)
        finally:
            verifier.close()
    warnings = []
    if outcome.skipped:
        warnings.append(f"Reference verification skipped for {outcome.skipped} candidates (time budget)")
    logger.info(
        "Verified with %s: %d checked, %d dropped", verifier.name, outcome.checked, len(outcome.dropped)
    )
    return outcome, warnings
