"""Lookup tables used for dynamic-reference evidence."""

from __future__ import annotations

import re
from collections import defaultdict

from dch.python.model import ProjectIndex
from dch.result import Location

IDENT_STRING = re.compile(r"^[A-Za-z_][\w.:/\-]*$")
TOKEN_SPLIT = re.compile(r"[.:/\-]")
WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


CONFIG_SUFFIXES = (".toml", ".ini", ".cfg", ".conf", ".yaml", ".yml", ".sh", ".env")
CONFIG_NAMES = ("Dockerfile", "Procfile", "Makefile")


def is_config_file(path: str) -> bool:
    name = path.rsplit("/", 1)[-1]
    return name.endswith(CONFIG_SUFFIXES) or name in CONFIG_NAMES or name.startswith("docker-compose")


class StringIndex:
    """Identifier-like string literals (``"pkg.mod:func"``, ``"handle_created"``) by token."""

    def __init__(self, project: ProjectIndex) -> None:
        self.by_token: dict[str, list[Location]] = defaultdict(list)
        self.values: list[tuple[str, Location]] = []
        for lit in project.string_literals:
            if not IDENT_STRING.match(lit.value) or len(lit.value) > 200:
                continue
            location = Location(file=lit.file, line=lit.line)
            self.values.append((lit.value, location))
            for token in set(TOKEN_SPLIT.split(lit.value)):
                if token:
                    self.by_token[token].append(location)

    def find_name(self, name: str) -> list[Location]:
        return self.by_token.get(name, [])

    def find_module(self, dotted: str) -> list[Location]:
        return [
            loc
            for value, loc in self.values
            if value == dotted or value.startswith((f"{dotted}:", f"{dotted}."))
        ]


class TextIndex:
    """Words and raw text of non-Python files (configs, Dockerfiles, CI)."""

    def __init__(self, files: dict[str, str]) -> None:
        self.files = {p: t for p, t in files.items() if is_config_file(p)}
        self.by_word: dict[str, list[Location]] = defaultdict(list)
        for path, text in self.files.items():
            for number, line in enumerate(text.splitlines(), start=1):
                for word in set(WORD.findall(line)):
                    self.by_word[word].append(Location(file=path, line=number))

    def find_word(self, word: str) -> list[Location]:
        return self.by_word.get(word, [])

    def find_text(self, needle: str) -> list[Location]:
        found = []
        for path, text in self.files.items():
            for number, line in enumerate(text.splitlines(), start=1):
                if needle in line:
                    found.append(Location(file=path, line=number))
        return found
