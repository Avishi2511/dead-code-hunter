"""Source providers: turn a local directory or a GitHub tarball into an in-memory file tree."""

from __future__ import annotations

import logging
import tarfile
import tempfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

import httpx

logger = logging.getLogger(__name__)

SKIP_DIRS = {
    ".venv",
    "venv",
    "env",
    "node_modules",
    "build",
    "dist",
    ".git",
    "__pycache__",
    ".tox",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    "site-packages",
    ".idea",
    ".vscode",
}
TEXT_SUFFIXES = {
    ".py",
    ".toml",
    ".ini",
    ".cfg",
    ".yaml",
    ".yml",
    ".txt",
    ".sh",
    ".json",
    ".md",
    ".env",
    ".in",
    ".conf",
}
TEXT_NAMES = {"Dockerfile", "Procfile", "Makefile", "docker-compose.yml", "docker-compose.yaml"}
MAX_TEXT_FILE_BYTES = 1_000_000
PROJECT_MARKERS = ("pyproject.toml", "requirements.txt", "setup.py")


class SourceError(Exception):
    """Raised when the repository cannot be fetched or exceeds configured limits."""


@dataclass(frozen=True)
class Limits:
    max_py_files: int = 1000
    max_tarball_mb: int = 30


@dataclass
class SourceTree:
    """Text files of a project, keyed by posix path relative to the project root."""

    repo: str
    files: dict[str, str]
    commit_sha: str | None = None
    warnings: list[str] = field(default_factory=list)
    prefix: str = ""  # project root relative to the repository root, for patch paths

    @property
    def py_files(self) -> list[str]:
        return sorted(p for p in self.files if p.endswith(".py"))


def is_text_candidate(rel: str) -> bool:
    path = PurePosixPath(rel)
    return (
        path.suffix in TEXT_SUFFIXES
        or path.name in TEXT_NAMES
        or path.name.startswith("requirements")
        or rel.startswith(".github/workflows/")
    )


def detect_project_root(root: Path, max_depth: int = 3) -> Path:
    """Nearest directory (breadth first) holding a Python project manifest."""
    level = [root]
    for _ in range(max_depth + 1):
        for directory in level:
            if any((directory / marker).exists() for marker in PROJECT_MARKERS):
                return directory
        level = sorted(
            child
            for directory in level
            for child in directory.iterdir()
            if child.is_dir() and child.name not in SKIP_DIRS and not child.name.startswith(".")
        )
    return root


def read_tree(
    root: Path, repo: str, limits: Limits, commit_sha: str | None = None, prefix: str = ""
) -> SourceTree:
    files: dict[str, str] = {}
    warnings: list[str] = []
    py_count = 0
    for path in sorted(root.rglob("*")):
        rel_parts = path.relative_to(root).parts
        if any(part in SKIP_DIRS or part.endswith(".egg-info") for part in rel_parts[:-1]):
            continue
        if not path.is_file() or path.is_symlink():
            continue
        rel = "/".join(rel_parts)
        if not is_text_candidate(rel) or path.stat().st_size > MAX_TEXT_FILE_BYTES:
            continue
        if rel.endswith(".py"):
            py_count += 1
            if py_count > limits.max_py_files:
                raise SourceError(f"Repository has more than {limits.max_py_files} Python files")
        try:
            # newline="" keeps CRLF intact so generated patches apply to the original bytes.
            with open(path, encoding="utf-8", newline="") as handle:
                files[rel] = handle.read()
        except UnicodeDecodeError:
            warnings.append(f"Skipped non-UTF-8 file: {rel}")
    return SourceTree(repo=repo, files=files, commit_sha=commit_sha, warnings=warnings, prefix=prefix)


class LocalDirSource:
    def __init__(
        self, path: Path, subdir: str | None = None, repo: str | None = None, limits: Limits | None = None
    ) -> None:
        self.path = Path(path).resolve()
        self.subdir = subdir
        self.repo = repo or f"local/{self.path.name}"
        self.limits = limits or Limits()

    def load(self) -> SourceTree:
        if not self.path.is_dir():
            raise SourceError(f"Not a directory: {self.path}")
        root = self.path / self.subdir if self.subdir else detect_project_root(self.path)
        if not root.is_dir():
            raise SourceError(f"Subdirectory not found: {self.subdir}")
        logger.info("Reading project at %s", root)
        prefix = root.relative_to(self.path).as_posix()
        return read_tree(root, self.repo, self.limits, prefix="" if prefix == "." else prefix)


def safe_extract(archive: Path, dest: Path) -> Path:
    """Extract a tarball without absolute paths, ``..`` or links escaping ``dest``."""
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        for member in members:
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts:
                raise SourceError(f"Unsafe path in archive: {member.name}")
        tar.extractall(dest, filter="data")
    tops = [p for p in dest.iterdir() if p.is_dir()]
    return tops[0] if len(tops) == 1 else dest


class GitHubTarballSource:
    API = "https://api.github.com"

    def __init__(
        self,
        owner: str,
        repo: str,
        ref: str | None = None,
        subdir: str | None = None,
        token: str | None = None,
        limits: Limits | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.owner, self.name, self.ref, self.subdir = owner, repo, ref, subdir
        self.limits = limits or Limits()
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "dead-code-hunter"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.client = client or httpx.Client(headers=headers, follow_redirects=True, timeout=60)

    def resolve_sha(self) -> str:
        ref = self.ref or "HEAD"
        response = self.client.get(f"{self.API}/repos/{self.owner}/{self.name}/commits/{ref}")
        if response.status_code == 404:
            raise SourceError(f"Repository or ref not found: {self.owner}/{self.name}@{ref}")
        if response.status_code in (401, 403):
            raise SourceError("GitHub refused the request (rate limit or private repository)")
        response.raise_for_status()
        return response.json()["sha"]

    def load(self) -> SourceTree:
        sha = self.resolve_sha()
        limit = self.limits.max_tarball_mb * 1024 * 1024
        url = f"{self.API}/repos/{self.owner}/{self.name}/tarball/{sha}"
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "repo.tar.gz"
            logger.info("Downloading %s/%s@%s", self.owner, self.name, sha[:8])
            size = 0
            with self.client.stream("GET", url) as response, open(archive, "wb") as out:
                response.raise_for_status()
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > limit:
                        raise SourceError(f"Tarball exceeds {self.limits.max_tarball_mb} MB")
                    out.write(chunk)
            extracted = Path(tmp) / "src"
            extracted.mkdir()
            top = safe_extract(archive, extracted)
            root = top / self.subdir if self.subdir else detect_project_root(top)
            if not root.is_dir():
                raise SourceError(f"Subdirectory not found: {self.subdir}")
            prefix = root.relative_to(top).as_posix()
            return read_tree(
                root,
                f"{self.owner}/{self.name}",
                self.limits,
                commit_sha=sha,
                prefix="" if prefix == "." else prefix,
            )
