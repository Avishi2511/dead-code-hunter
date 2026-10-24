from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
REF = re.compile(r"^[A-Za-z0-9_./@+-]{1,200}$")


class InvalidRepo(ValueError):
    pass


@dataclass(frozen=True)
class RepoSpec:
    owner: str
    name: str
    ref: str | None
    subdir: str | None

    @property
    def url(self) -> str:
        return f"https://github.com/{self.owner}/{self.name}"


def parse_repo(text: str, ref: str | None = None, subdir: str | None = None) -> RepoSpec:
    """Accept ``https://github.com/o/r[/tree/<ref>/<subdir>]`` or ``o/r``; public github.com only."""
    text = text.strip()
    if "://" in text or text.startswith("github.com/"):
        parsed = urlparse(text if "://" in text else f"https://{text}")
        if parsed.scheme not in ("http", "https") or (parsed.hostname or "").lower() not in (
            "github.com",
            "www.github.com",
        ):
            raise InvalidRepo("Only github.com repositories are supported")
        parts = [p for p in parsed.path.split("/") if p]
    else:
        parts = [p for p in text.split("/") if p]
    if len(parts) < 2:
        raise InvalidRepo("Expected a repository like https://github.com/owner/repo")
    owner, name = parts[0], parts[1].removesuffix(".git")
    if not NAME.match(owner) or not NAME.match(name):
        raise InvalidRepo("Invalid repository name")
    if len(parts) >= 4 and parts[2] == "tree":
        ref = ref or parts[3]
        subdir = subdir or ("/".join(parts[4:]) or None)
    ref = (ref or "").strip() or None
    subdir = (subdir or "").strip().strip("/") or None
    if ref and (not REF.match(ref) or ".." in ref):
        raise InvalidRepo("Invalid ref")
    if subdir and (".." in subdir.split("/") or subdir.startswith(("/", "\\")) or "\\" in subdir):
        raise InvalidRepo("Invalid subdirectory")
    return RepoSpec(owner, name, ref, subdir)
