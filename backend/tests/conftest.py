from __future__ import annotations

import textwrap
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from dch.result import Finding, ScanResult
from dch.scan import scan_tree
from dch.source.base import LocalDirSource, SourceError, SourceTree
from dch_api.main import create_app
from dch_api.settings import Settings


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


FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "haunted-fastapi"


def fixture_source(spec, settings):  # noqa: ANN001, ANN201
    if spec.name == "missing":
        raise SourceError("Repository or ref not found: acme/missing@HEAD")
    return LocalDirSource(FIXTURE, repo=f"{spec.owner}/{spec.name}").load()


@pytest.fixture
def make_client(tmp_path):
    def build(**overrides) -> TestClient:  # noqa: ANN003
        settings = Settings(
            database_url=f"sqlite:///{tmp_path / 'api.db'}",
            verifier="none",
            maintenance_token="s3cret",
            **overrides,
        )
        return TestClient(create_app(settings, source_factory=fixture_source))

    return build


@pytest.fixture
def client(make_client):
    return make_client()


def wait_for(client: TestClient, url: str, done=("done", "failed"), timeout: float = 60):  # noqa: ANN001, ANN201
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(url).json()
        if body["status"] in done:
            return body
        time.sleep(0.1)
    raise AssertionError(f"{url} did not finish")


def scan_fixture(client: TestClient, repo: str = "https://github.com/acme/haunted") -> str:
    created = client.post("/api/scans", json={"repoUrl": repo})
    assert created.status_code == 201, created.text
    scan_id = created.json()["scanId"]
    assert client.post(f"/api/scans/{scan_id}/run").status_code == 200
    return scan_id
