"""Read declared dependencies from requirements files, PEP 621 / PEP 735 and Poetry tables."""

from __future__ import annotations

import logging
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from packaging.requirements import InvalidRequirement, Requirement

logger = logging.getLogger(__name__)

REQUIREMENTS_NAME = re.compile(r"^requirements.*\.txt$")
SKIPPED_POETRY_KEYS = {"python"}


def normalize(name: str) -> str:
    """PEP 503 normalisation."""
    return re.sub(r"[-_.]+", "-", name).lower()


@dataclass
class Declaration:
    file: str
    line: int
    raw: str  # text as written, e.g. "uvicorn[standard]>=0.30"


@dataclass
class Dependency:
    name: str  # as written in the first declaration
    norm: str
    declarations: list[Declaration] = field(default_factory=list)


def is_manifest(path: str) -> bool:
    p = PurePosixPath(path)
    return (
        p.name == "pyproject.toml"
        or bool(REQUIREMENTS_NAME.match(p.name))
        or (p.parent.name == "requirements" and p.suffix == ".txt")
    )


def find_line(text: str, needle: str, start: int = 0) -> int:
    for number, line in enumerate(text.splitlines(), start=1):
        if number > start and needle in line:
            return number
    return max(start, 1)


def parse_requirement(raw: str) -> str | None:
    try:
        return Requirement(raw).name
    except InvalidRequirement:
        match = re.search(r"#egg=([A-Za-z0-9_.\-]+)", raw)
        return match.group(1) if match else None


def read_requirements(path: str, files: dict[str, str], seen: set[str]) -> list[tuple[str, str, int, str]]:
    if path in seen or path not in files:
        return []
    seen.add(path)
    found: list[tuple[str, str, int, str]] = []
    for number, line in enumerate(files[path].splitlines(), start=1):
        text = line.split(" #", 1)[0].strip()
        if not text or text.startswith("#"):
            continue
        if text.startswith(("-r ", "-c ", "--requirement", "--constraint")):
            target = text.split(None, 1)[1].strip()
            nested = (PurePosixPath(path).parent / target).as_posix().lstrip("./")
            found.extend(read_requirements(nested, files, seen))
            continue
        if text.startswith("-"):
            continue
        name = parse_requirement(text)
        if name:
            found.append((path, name, number, text))
    return found


def pyproject_requirements(path: str, text: str) -> list[tuple[str, int, str]]:
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        logger.warning("Cannot parse %s: %s", path, exc)
        return []
    found: list[tuple[str, int, str]] = []

    def add_pep508(items: object) -> None:
        for item in items if isinstance(items, list) else []:
            if isinstance(item, str) and (name := parse_requirement(item)):
                found.append((name, find_line(text, item), item))

    project = data.get("project", {})
    add_pep508(project.get("dependencies"))
    for group in project.get("optional-dependencies", {}).values():
        add_pep508(group)
    for group in data.get("dependency-groups", {}).values():
        add_pep508(group)
    poetry = data.get("tool", {}).get("poetry", {})
    poetry_tables = [poetry.get("dependencies", {}), poetry.get("dev-dependencies", {})]
    poetry_tables += [g.get("dependencies", {}) for g in poetry.get("group", {}).values()]
    for table in poetry_tables:
        for name in table:
            if name not in SKIPPED_POETRY_KEYS:
                found.append((name, find_line(text, name), f"{name} = ..."))
    return found


def read_dependencies(files: dict[str, str]) -> list[Dependency]:
    by_norm: dict[str, Dependency] = {}
    seen_requirements: set[str] = set()
    entries: list[tuple[str, str, int, str]] = []
    for path in sorted(files):
        if not is_manifest(path):
            continue
        if path.endswith("pyproject.toml"):
            entries += [(path, *e) for e in pyproject_requirements(path, files[path])]
        else:
            entries += read_requirements(path, files, seen_requirements)
    for path, name, line, raw in entries:
        dep = by_norm.setdefault(normalize(name), Dependency(name, normalize(name)))
        dep.declarations.append(Declaration(path, line, raw))
    return list(by_norm.values())
