"""Dependency pass: which declared distributions does the project actually use?"""

from __future__ import annotations

import ast
import logging
import re
import tomllib
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from dch.config import Config
from dch.deps.manifests import Dependency, is_manifest, normalize, read_dependencies
from dch.engine.detectors import Candidate
from dch.engine.index import is_config_file
from dch.frameworks.entrypoints import is_script_file
from dch.graph.model import Node
from dch.python.model import ProjectIndex
from dch.result import Location

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
STUB_PREFIX = "types-"
INI_SECTION = re.compile(r"^\[(?:tool:)?([\w\-.]+)", re.MULTILINE)


@dataclass
class Usage:
    imports: list[str] = field(default_factory=list)  # importing module names
    cli: list[Location] = field(default_factory=list)
    tool_config: list[Location] = field(default_factory=list)
    implicit: list[str] = field(default_factory=list)
    weak: list[Location] = field(default_factory=list)

    @property
    def used(self) -> bool:
        return bool(self.imports or self.cli or self.tool_config or self.implicit)

    def reasons(self) -> list[str]:
        out = []
        if self.imports:
            out.append("import")
        if self.cli:
            out.append("cli")
        if self.tool_config:
            out.append("config")
        if self.implicit:
            out.append("implicit-rule")
        return out


def load_data(name: str) -> dict:
    return tomllib.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def import_names(dep: Dependency, curated: dict[str, list[str]]) -> tuple[list[str], bool]:
    """Top-level import names for a distribution and whether they are only a guess."""
    if dep.norm in curated:
        return curated[dep.norm], False
    base = dep.norm
    stripped = re.sub(r"^(python|py)-|-(python|py)$", "", base)
    names = {base.replace("-", "_"), stripped.replace("-", "_")}
    return sorted(names), base != base.replace("-", "_") or stripped != base


def external_imports(project: ProjectIndex) -> dict[str, set[str]]:
    """dotted import target -> modules importing it (repo-internal imports excluded)."""
    found: dict[str, set[str]] = defaultdict(set)
    for mod in project.modules.values():
        try:
            tree = ast.parse(mod.source)
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                targets = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                targets = [node.module, *(f"{node.module}.{a.name}" for a in node.names)]
            else:
                continue
            for target in targets:
                if target.split(".")[0] in project.internal_prefixes:
                    continue
                found[target].add(mod.name)
    return found


def tool_names(files: dict[str, str]) -> dict[str, Location]:
    """Tools configured in pyproject ``[tool.x]`` tables and ``x.ini`` / ``setup.cfg`` sections."""
    found: dict[str, Location] = {}
    for path, text in files.items():
        name = PurePosixPath(path).name
        if name == "pyproject.toml":
            try:
                tools = tomllib.loads(text).get("tool", {})
            except tomllib.TOMLDecodeError:
                continue
            for tool in tools:
                found.setdefault(normalize(tool), Location(file=path, line=1))
        elif name.endswith((".ini", ".cfg")):
            stem = PurePosixPath(path).stem
            found.setdefault(normalize(stem), Location(file=path, line=1))
            for section in INI_SECTION.findall(text):
                found.setdefault(normalize(section.split(".")[0]), Location(file=path, line=1))
    return found


def word_pattern(names: list[str]) -> re.Pattern[str]:
    variants = {v for n in names for v in (n, n.replace("-", "_"), n.replace("_", "-")) if len(n) >= 2}
    return re.compile(r"(?<![\w-])(" + "|".join(re.escape(v) for v in sorted(variants)) + r")(?![\w-])", re.I)


def scan_text_usage(files: dict[str, str], dep_names: dict[str, list[str]], usage: dict[str, Usage]) -> None:
    patterns = {norm: word_pattern(names) for norm, names in dep_names.items()}
    for path, text in files.items():
        if path.endswith(".py") or is_manifest(path) or not (is_script_file(path) or is_config_file(path)):
            continue
        strong = is_script_file(path)
        for number, line in enumerate(text.splitlines(), start=1):
            if line.lstrip().startswith("#"):
                continue
            for norm, pattern in patterns.items():
                if pattern.search(line):
                    location = Location(file=path, line=number)
                    (usage[norm].cli if strong else usage[norm].weak).append(location)


def apply_implicit_rules(
    project: ProjectIndex, files: dict[str, str], deps: list[Dependency], usage: dict[str, Usage],
    imports: dict[str, set[str]], curated: dict[str, list[str]],
) -> None:  # fmt: skip
    rules = load_data("implicit_usage.toml").get("rule", [])
    strings = [lit.value for lit in project.string_literals]
    config_text = [t for p, t in files.items() if not p.endswith(".py") and not is_manifest(p)]

    def text_present(needle: str) -> bool:
        return any(needle in s for s in strings) or any(needle in t for t in config_text)

    def imported(prefix: str) -> bool:
        return any(t == prefix or t.startswith(prefix + ".") for t in imports)

    def rule_matches(rule: dict, dep: Dependency) -> str | None:
        if "dist" in rule and normalize(rule["dist"]) != dep.norm:
            return None
        if "dist_prefix" in rule and not dep.norm.startswith(rule["dist_prefix"]):
            return None
        if any(imported(p) for p in rule.get("when_imported", [])):
            return "imports " + ", ".join(rule["when_imported"][:2])
        for needle in rule.get("when_text", []):
            if text_present(needle):
                return f"mentions {needle!r}"
        if any(f in files or any(p.startswith(f) for p in files) for f in rule.get("when_files", [])):
            return "project files present"
        return None

    def base_used(norm: str) -> bool:
        if norm in usage and usage[norm].used:
            return True
        names, _ = import_names(Dependency(norm, norm), curated)
        return any(imported(n) for n in names)

    for dep in deps:
        for rule in rules:
            if rule.get("requires_stub_base"):
                if dep.norm.startswith(STUB_PREFIX) and base_used(dep.norm.removeprefix(STUB_PREFIX)):
                    usage[dep.norm].implicit.append("type stubs for a used package")
            elif "requires_dist" in rule:
                if dep.norm.startswith(rule["dist_prefix"]) and base_used(normalize(rule["requires_dist"])):
                    usage[dep.norm].implicit.append(f"plugin for {rule['requires_dist']}")
            elif reason := rule_matches(rule, dep):
                usage[dep.norm].implicit.append(reason)


def analyze_dependencies(
    project: ProjectIndex, files: dict[str, str], config: Config
) -> tuple[list[Candidate], dict[str, str]]:
    """Add distribution nodes + edges; return unused-dependency candidates and extra roots."""
    deps = read_dependencies(files)
    if not deps:
        return [], {}
    curated = {normalize(k): v for k, v in load_data("import_map.toml")["map"].items()}
    imports = external_imports(project)
    names: dict[str, list[str]] = {}
    uncertain: dict[str, bool] = {}
    usage: dict[str, Usage] = {d.norm: Usage() for d in deps}
    for dep in deps:
        dep_import_names, guessed = import_names(dep, curated)
        names[dep.norm], uncertain[dep.norm] = dep_import_names, guessed
        wanted = {n.lower() for n in dep_import_names}
        for target, modules in imports.items():
            if any(target.lower() == n or target.lower().startswith(n + ".") for n in wanted):
                usage[dep.norm].imports.extend(sorted(modules))
    tools = tool_names(files)
    cli_names = {d.norm: [d.norm, *names[d.norm]] for d in deps}
    scan_text_usage(files, cli_names, usage)
    for dep in deps:
        if dep.norm in tools:
            usage[dep.norm].tool_config.append(tools[dep.norm])
    apply_implicit_rules(project, files, deps, usage, imports, curated)

    graph = project.graph
    roots: dict[str, str] = {}
    candidates: list[Candidate] = []
    for dep in deps:
        first = dep.declarations[0]
        node_id = f"{project.repo}:dist#{dep.norm}"
        node = graph.add_node(
            Node(
                node_id,
                "distribution",
                dep.name,
                first.file,
                first.line,
                first.line,
                attrs={
                    "declarations": [d.__dict__ for d in dep.declarations],
                    "usage": usage[dep.norm].reasons(),
                    "import_names": names[dep.norm],
                },
            )  # fmt: skip
        )
        for module_name in usage[dep.norm].imports:
            graph.add_edge(project.modules[module_name].node_id, node_id, "uses_distribution", via="import")
        for reason in ("cli", "config", "implicit-rule"):
            if reason in usage[dep.norm].reasons():
                roots[node_id] = f"used via {reason}"
        if usage[dep.norm].used or config.is_ignored(first.file, dep.norm):
            continue
        candidates.append(
            Candidate(
                "unused_dependency",
                node.id,
                dep.name,
                first.file,
                first.line,
                first.line,
                extra={
                    "names": names[dep.norm],
                    "guessed": uncertain[dep.norm],
                    "weak": usage[dep.norm].weak,
                    "declarations": dep.declarations,
                },
            )  # fmt: skip
        )
    return candidates, roots
