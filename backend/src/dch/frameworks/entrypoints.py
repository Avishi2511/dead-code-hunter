"""Entry points: modules and symbols the outside world starts the application from."""

from __future__ import annotations

import logging
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from dch.config import Config
from dch.python.model import ProjectIndex

logger = logging.getLogger(__name__)

SERVER_RE = re.compile(r"\b(?:uvicorn|gunicorn|hypercorn|daphne)\b")
TARGET_RE = re.compile(r"(?<![\w./-])([A-Za-z_][\w.]*):([A-Za-z_][\w.]*)")
CELERY_RE = re.compile(r"\bcelery\b.*?(?:-A|--app)[= ]\s*([A-Za-z_][\w.]*)")
PYTHON_M_RE = re.compile(r"\bpython[\d.]*\s+-m\s+([A-Za-z_][\w.]*)")
PYTHON_FILE_RE = re.compile(r"\bpython[\d.]*\s+([\w./-]+\.py)\b")
SCRIPT_FILES = ("Dockerfile", "Procfile", "Makefile")


@dataclass
class EntryPoints:
    modules: dict[str, str] = field(default_factory=dict)  # module name -> reason
    symbols: list[tuple[str, str, str]] = field(default_factory=list)  # (module, attr, reason)


def is_script_file(path: str) -> bool:
    name = PurePosixPath(path).name
    return (
        name in SCRIPT_FILES
        or name.startswith("docker-compose")
        or name.endswith((".sh", ".yml", ".yaml"))
        or path.startswith(".github/workflows/")
    )


def scan_text_commands(path: str, text: str, project: ProjectIndex, out: EntryPoints) -> None:
    for line in text.splitlines():
        if SERVER_RE.search(line):
            for mod, attr in TARGET_RE.findall(line):
                if mod in project.modules:
                    out.modules[mod] = f"served by an ASGI server ({path})"
                    out.symbols.append((mod, attr, f"ASGI app in {path}"))
        for match in CELERY_RE.findall(line):
            if match in project.modules:
                out.modules[match] = f"Celery app in {path}"
        for match in PYTHON_M_RE.findall(line):
            if match in project.modules:
                out.modules[match] = f"run with `python -m` in {path}"
        for match in PYTHON_FILE_RE.findall(line):
            module = project.by_path.get(match.lstrip("./"))
            if module:
                out.modules[module.name] = f"run as a script in {path}"


def scan_pyproject(text: str, project: ProjectIndex, out: EntryPoints) -> None:
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return
    tables = [
        data.get("project", {}).get("scripts", {}),
        data.get("project", {}).get("gui-scripts", {}),
        data.get("tool", {}).get("poetry", {}).get("scripts", {}),
    ]
    for table in tables:
        for value in table.values():
            if isinstance(value, str) and ":" in value:
                mod, attr = value.split(":", 1)
                if mod in project.modules:
                    out.modules[mod] = "declared in project scripts"
                    out.symbols.append((mod, attr, "declared in project scripts"))


def find_entrypoints(project: ProjectIndex, files: dict[str, str], config: Config) -> EntryPoints:
    out = EntryPoints()
    for mod in project.modules.values():
        if mod.is_test:
            continue
        parts = PurePosixPath(mod.path).parts
        if mod.has_main_guard:
            out.modules[mod.name] = 'has an `if __name__ == "__main__"` block'
        elif mod.path.endswith("__main__.py"):
            out.modules[mod.name] = "package `__main__` module"
        elif "alembic" in parts or "migrations" in parts:
            if parts[-1] == "env.py" or "versions" in parts:
                out.modules[mod.name] = "database migration"
    for path, text in files.items():
        if is_script_file(path):
            scan_text_commands(path, text, project, out)
        elif path.endswith("pyproject.toml"):
            scan_pyproject(text, project, out)
    for name in config.root_modules:
        module = project.by_path.get(name) or project.modules.get(name)
        if module:
            out.modules[module.name] = "declared in .deadcodehunter.toml"
    return out
