"""Jedi-based fallback verifier (pure Python, no Node runtime needed)."""

from __future__ import annotations

from pathlib import Path

import jedi

from dch.verify.base import RefLocation


class JediVerifier:
    name = "jedi"

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.project = jedi.Project(path=str(self.root), smart_sys_path=False)

    def references(self, file: str, source: str, line: int, column: int) -> list[RefLocation] | None:
        script = jedi.Script(code=source, path=str(self.root / file), project=self.project)
        found = []
        for ref in script.get_references(line, column, include_builtins=False):
            if ref.module_path is None or ref.line is None:
                continue
            try:
                rel = Path(ref.module_path).resolve().relative_to(self.root).as_posix()
            except ValueError:
                continue
            if not ref.is_definition():
                found.append(RefLocation(rel, ref.line))
        return found

    def close(self) -> None:
        return None
