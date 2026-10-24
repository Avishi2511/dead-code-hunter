from __future__ import annotations

import textwrap

import pytest

from dch.result import Finding, ScanResult
from dch.scan import scan_tree
from dch.source.base import SourceTree


def make_tree(files: dict[str, str], repo: str = "t/repo") -> SourceTree:
    return SourceTree(repo=repo, files={p: textwrap.dedent(t).lstrip("\n") for p, t in files.items()})


class Scan:
    def __init__(self, result: ScanResult) -> None:
        self.result = result

    def find(
        self, type_: str | None = None, name: str | None = None, file: str | None = None
    ) -> list[Finding]:
        return [
            f
            for f in self.result.findings
            if (type_ is None or f.type == type_)
            and (name is None or f.name == name)
            and (file is None or f.file == file)
        ]

    def names(self, type_: str) -> set[str]:
        return {f.name for f in self.result.findings if f.type == type_}


@pytest.fixture
def scan():
    def run(files: dict[str, str]) -> Scan:
        return Scan(scan_tree(make_tree(files), suggestions=False))

    return run
