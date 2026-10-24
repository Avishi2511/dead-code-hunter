from __future__ import annotations

import io
import tarfile

import httpx
import pytest

from dch.source.base import GitHubTarballSource, Limits, LocalDirSource, SourceError, safe_extract


def build_tar(path, members: dict[str, bytes]):
    with tarfile.open(path, "w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


def test_safe_extract_rejects_path_traversal(tmp_path):
    archive = tmp_path / "evil.tar.gz"
    build_tar(archive, {"../escape.py": b"x = 1"})
    with pytest.raises(SourceError):
        safe_extract(archive, tmp_path / "out")


def test_local_source_skips_vendor_dirs_and_detects_root(tmp_path):
    (tmp_path / "backend" / "app").mkdir(parents=True)
    (tmp_path / "backend" / "pyproject.toml").write_text("[project]\nname='x'\n")
    (tmp_path / "backend" / "app" / "a.py").write_text("x = 1\n")
    (tmp_path / "backend" / ".venv").mkdir()
    (tmp_path / "backend" / ".venv" / "v.py").write_text("y = 2\n")
    tree = LocalDirSource(tmp_path).load()
    assert tree.py_files == ["app/a.py"]


def test_local_source_enforces_file_limit(tmp_path):
    for i in range(3):
        (tmp_path / f"m{i}.py").write_text("x = 1\n")
    with pytest.raises(SourceError, match="more than 2"):
        LocalDirSource(tmp_path, limits=Limits(max_py_files=2)).load()


def test_github_source_downloads_tarball_at_resolved_sha(tmp_path):
    archive = tmp_path / "repo.tar.gz"
    build_tar(
        archive,
        {
            "owner-repo-abc123/pyproject.toml": b"[project]\nname='x'\n",
            "owner-repo-abc123/app.py": b"x = 1\n",
        },
    )
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.path.endswith("/commits/main"):
            return httpx.Response(200, json={"sha": "abc123"})
        return httpx.Response(200, content=archive.read_bytes())

    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    tree = GitHubTarballSource("owner", "repo", ref="main", client=client).load()
    assert tree.commit_sha == "abc123"
    assert tree.repo == "owner/repo"
    assert tree.py_files == ["app.py"]
    assert seen[-1].endswith("/tarball/abc123")


def test_github_source_reports_missing_repo():
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    with pytest.raises(SourceError, match="not found"):
        GitHubTarballSource("o", "r", client=client).load()


def test_github_source_enforces_tarball_size(tmp_path):
    archive = tmp_path / "repo.tar.gz"
    build_tar(archive, {"o-r-1/big.py": b"x = 1\n" * 400_000})

    def handler(request: httpx.Request) -> httpx.Response:
        if "/commits/" in request.url.path:
            return httpx.Response(200, json={"sha": "1"})
        return httpx.Response(200, content=archive.read_bytes())

    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    source = GitHubTarballSource("o", "r", limits=Limits(max_tarball_mb=0), client=client)
    with pytest.raises(SourceError, match="exceeds"):
        source.load()
