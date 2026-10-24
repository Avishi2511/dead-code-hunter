from __future__ import annotations

import pytest

from conftest import make_tree
from dch.scan import scan_tree
from dch.verify.lsp import find_langserver

MAIN = "if __name__ == '__main__': main()"
SOURCE = {
    "app.py": f"""
        class Repo:
            def find(self):
                return 1

            def stale(self):
                return 2

        def make():
            return Repo()

        def main():
            repo = make()
            return repo.find()

        {MAIN}
    """
}
VERIFIERS = [
    "jedi",
    pytest.param(
        "basedpyright",
        marks=pytest.mark.skipif(find_langserver() is None, reason="basedpyright is not installed"),
    ),
]


def names(result, type_):
    return {f.name for f in result.findings if f.type == type_}


def test_without_verifier_the_untyped_call_is_a_false_positive():
    result = scan_tree(make_tree(SOURCE), verifier="none")
    assert names(result, "unused_method") == {"Repo.find", "Repo.stale"}


@pytest.mark.parametrize("verifier", VERIFIERS)
def test_verifier_drops_candidates_with_live_references(verifier):
    result = scan_tree(make_tree(SOURCE), verifier=verifier)
    assert names(result, "unused_method") == {"Repo.stale"}


@pytest.mark.parametrize("verifier", VERIFIERS)
def test_verifier_with_no_references_adds_supporting_evidence(verifier):
    baseline = scan_tree(make_tree(SOURCE), verifier="none")
    checked = scan_tree(make_tree(SOURCE), verifier=verifier)
    before = next(f for f in baseline.findings if f.name == "Repo.stale")
    after = next(f for f in checked.findings if f.name == "Repo.stale")
    assert "verifier_no_refs" in {e.code for e in after.evidence}
    assert after.confidence == before.confidence + 4


def test_expired_time_budget_skips_verification_with_a_warning():
    result = scan_tree(make_tree(SOURCE), verifier="jedi", time_budget_s=1e-9)
    assert any("verification skipped" in w.lower() for w in result.warnings)
    assert names(result, "unused_method") == {"Repo.find", "Repo.stale"}
