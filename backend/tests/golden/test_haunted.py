"""Golden test: scan the seeded fixture and measure precision / recall against expected.json."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dch.result import ScanResult
from dch.scan import scan_tree
from dch.source.base import LocalDirSource

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "haunted-fastapi"


@pytest.fixture(scope="module", params=["none", "jedi"])
def result(request) -> ScanResult:
    return scan_tree(LocalDirSource(FIXTURE).load(), verifier=request.param)


@pytest.fixture(scope="module")
def expected() -> dict:
    return json.loads((FIXTURE / "expected.json").read_text())


def key(item) -> tuple[str, str, str]:
    if isinstance(item, dict):
        return (item["type"], item["file"], item["name"])
    return (item.type, item.file, item.name)


def evaluate(result: ScanResult, expected: dict) -> dict:
    dead = {key(d): d for d in expected["dead"]}
    found = {key(f): f for f in result.findings}
    matched = [k for k in dead if k in found and dead[k].get("level", found[k].level) == found[k].level]
    high = [f for f in result.findings if f.level == "high"]
    high_ok = [f for f in high if key(f) in dead]
    return {
        "recall": len(matched) / len(dead),
        "precision_high": len(high_ok) / len(high) if high else 1.0,
        "missing": sorted(set(dead) - set(matched)),
        "false_high": sorted(key(f) for f in high if key(f) not in dead),
    }


def test_precision_and_recall_meet_targets(result, expected):
    metrics = evaluate(result, expected)
    targets = expected["targets"]
    assert metrics["precision_high"] >= targets["precision_high"], metrics["false_high"]
    assert metrics["recall"] >= targets["recall"], metrics["missing"]


def test_every_planted_item_is_found(result, expected):
    assert evaluate(result, expected)["missing"] == []


def test_traps_are_not_flagged(result, expected):
    for trap in expected["must_not_flag"]:
        hits = [
            f
            for f in result.findings
            if f.file == trap["file"] and f.name == trap["name"] and f.line != trap.get("line_not")
        ]
        assert not hits, f"trap flagged: {trap} -> {[(h.type, h.line) for h in hits]}"


def test_dynamic_traps_never_reach_high(result, expected):
    for trap in expected["must_not_be_high"]:
        for f in result.findings:
            if f.file == trap["file"] and f.name == trap["name"]:
                assert f.level != "high", trap


def test_no_unexpected_findings(result, expected):
    dead = {key(d) for d in expected["dead"]}
    unexpected = [key(f) for f in result.findings if key(f) not in dead]
    allowed = {(t["file"], t["name"]) for t in expected["must_not_be_high"]}
    assert [k for k in unexpected if (k[1], k[2]) not in allowed] == []
