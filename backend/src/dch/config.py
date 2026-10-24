""".deadcodehunter.toml: ignore rules and extra roots."""

from __future__ import annotations

import fnmatch
import logging
import tomllib
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

CONFIG_FILE = ".deadcodehunter.toml"


@dataclass
class IgnoreRule:
    target: str
    reason: str = ""


@dataclass
class Config:
    ignores: list[IgnoreRule] = field(default_factory=list)
    root_modules: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def is_ignored(self, file: str, qualname: str | None = None) -> bool:
        """Match ``path/to/file.py`` or ``path/to/file.py#qualname`` (globs allowed)."""
        full = f"{file}#{qualname}" if qualname else file
        for rule in self.ignores:
            if fnmatch.fnmatchcase(full, rule.target) or fnmatch.fnmatchcase(file, rule.target):
                return True
        return False


def load_config(files: dict[str, str]) -> Config:
    text = files.get(CONFIG_FILE)
    config = Config()
    if text is None:
        return config
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        config.warnings.append(f"Ignoring invalid {CONFIG_FILE}: {exc}")
        return config
    for entry in data.get("ignore", []):
        if isinstance(entry, dict) and isinstance(entry.get("target"), str):
            config.ignores.append(IgnoreRule(entry["target"], str(entry.get("reason", ""))))
    config.root_modules = [m for m in data.get("roots", {}).get("modules", []) if isinstance(m, str)]
    logger.info("Loaded %d ignore rule(s) from %s", len(config.ignores), CONFIG_FILE)
    return config
