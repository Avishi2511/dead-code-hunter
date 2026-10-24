"""Turn selected findings into file changes (transforms, overlaps, cascades)."""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import libcst as cst

from dch.cleanup.files import add_ignore, remove_dependency, unified_diff
from dch.cleanup.imports import find_unused_imports
from dch.cleanup.transforms import PyEdit, apply_py_edits
from dch.config import CONFIG_FILE
from dch.deps.manifests import normalize
from dch.result import Finding, Selection

logger = logging.getLogger(__name__)

RANGE_TYPES = {
    "unused_function", "unused_class", "unused_method", "unused_variable", "unused_route",
    "unreachable_code",
}  # fmt: skip


@dataclass
class Applied:
    files: dict[str, str]  # file contents after the change (deleted files removed)
    old_files: dict[str, str]
    changed: list[str] = field(default_factory=list)
    deleted: set[str] = field(default_factory=set)
    covered: dict[str, str] = field(default_factory=dict)  # finding id -> covering finding id
    manual: dict[str, str] = field(default_factory=dict)  # finding id -> reason
    applied: list[str] = field(default_factory=list)  # finding ids that changed something
    cascades: list[str] = field(default_factory=list)

    def diff(self, prefix: str = "") -> str:
        parts = []
        for path in self.changed:
            shown = f"{prefix}/{path}" if prefix else path
            parts.append(unified_diff(shown, self.old_files.get(path), self.files.get(path)))
        return "".join(parts)


def covers(outer: Finding, inner: Finding) -> bool:
    if outer.file != inner.file or outer.id == inner.id:
        return False
    if outer.type == "unused_module":
        return inner.type != "unused_module"
    if outer.type not in RANGE_TYPES or inner.type == "unused_dependency":
        return False
    return outer.line <= inner.line and inner.end_line <= outer.end_line


def resolve_overlaps(selected: Sequence[Finding]) -> tuple[list[Finding], dict[str, str]]:
    """Drop findings whose range lies inside another selected finding."""
    ordered = sorted(selected, key=lambda f: (f.type != "unused_module", f.file, f.line, -f.end_line, f.id))
    kept: list[Finding] = []
    covered: dict[str, str] = {}
    for finding in ordered:
        owner = next((k for k in kept if covers(k, finding)), None)
        if owner is None:
            kept.append(finding)
        else:
            covered[finding.id] = owner.id
    return kept, covered


def python_edits(finding: Finding) -> list[PyEdit]:
    kind = finding.type
    if kind in ("unused_function", "unused_class", "unused_method", "unused_variable", "unused_route"):
        return [PyEdit("remove_lines", finding.id, finding.line, finding.end_line)]
    if kind == "unused_import":
        return [PyEdit("remove_import", finding.id, finding.line, name=finding.name)]
    if kind == "unreachable_code":
        details = finding.details
        return [
            PyEdit(
                "unreachable",
                finding.id,
                finding.line,
                finding.end_line,
                block_kind=details["kind"],
                anchor=details["anchor"],
            )  # fmt: skip
        ]
    return []


def router_edits(kept: Sequence[Finding], deleted: set[str]) -> list[tuple[str, PyEdit]]:
    """Remove a router variable once every route registered on it is being removed."""
    by_router: dict[str, list[Finding]] = defaultdict(list)
    for finding in kept:
        if finding.type == "unused_route":
            by_router[finding.details["router_id"]].append(finding)
    edits = []
    for router_id, routes in by_router.items():
        details = routes[0].details
        file = details["router_file"]
        complete = len({r.id for r in routes}) >= details["router_route_count"]
        if complete and not details["router_included"] and file not in deleted:
            edit = PyEdit(
                "remove_lines", f"router:{router_id}", details["router_line"], details["router_end_line"]
            )
            edits.append((file, edit))
    return edits


def cascade_imports(
    old: dict[str, str], new: dict[str, str], touched: Sequence[str]
) -> tuple[dict[str, str], list[str]]:
    """Remove imports that were used only by the code just removed (touched files only)."""
    notes: list[str] = []
    updated = dict(new)
    for path in touched:
        if not path.endswith(".py") or path not in new or path not in old:
            continue
        before = {u.key for u in find_unused_imports(old[path], path)}
        fresh = [u for u in find_unused_imports(new[path], path) if u.key not in before]
        if not fresh:
            continue
        edits = [PyEdit("remove_import", f"cascade:{path}:{u.key}", u.line, name=u.local) for u in fresh]
        updated[path], _ = apply_py_edits(new[path], edits)
        notes += [f"{path}: import `{u.local}` was only used by the removed code" for u in fresh]
    return updated, notes


def apply_selections(
    files: dict[str, str],
    findings: dict[str, Finding],
    selections: Sequence[Selection],
    *,
    rescan: Callable[[dict[str, str]], set[str]] | None = None,
    known_unused_dependencies: set[str] | None = None,
) -> Applied:
    """Apply ``selections`` to ``files``.

    ``rescan`` (combined cleanups) re-analyses the new tree and returns the names of unused
    dependencies; ones that were not already unused become cascaded removals.
    """
    unknown = [s.finding_id for s in selections if s.finding_id not in findings]
    if unknown:
        raise KeyError(f"Unknown finding ids: {', '.join(unknown)}")
    removals = [findings[s.finding_id] for s in selections if s.action == "remove"]
    alive = [findings[s.finding_id] for s in selections if s.action == "mark_alive"]
    kept, covered = resolve_overlaps(removals)
    result = Applied(files=dict(files), old_files=files, covered=covered)

    deleted = {f.file for f in kept if f.type == "unused_module"}
    result.deleted = deleted
    for path in deleted:
        result.files.pop(path, None)
    result.applied += [f.id for f in kept if f.type == "unused_module"]

    edits_by_file: dict[str, list[PyEdit]] = defaultdict(list)
    for finding in kept:
        if finding.file in deleted:
            continue
        for edit in python_edits(finding):
            edits_by_file[finding.file].append(edit)
    for file, edit in router_edits(kept, deleted):
        edits_by_file[file].append(edit)

    touched: list[str] = []
    for path, edits in edits_by_file.items():
        try:
            new_source, matched = apply_py_edits(files[path], edits)
        except (cst.ParserSyntaxError, KeyError) as exc:
            for edit in edits:
                result.manual[edit.key] = f"Could not transform {path}: {exc}"
            continue
        result.files[path] = new_source
        touched.append(path)
        for edit in edits:
            if edit.key in matched:
                if not edit.key.startswith("router:"):
                    result.applied.append(edit.key)
            elif not edit.key.startswith("router:"):
                result.manual[edit.key] = "Statement shape not supported for automatic removal"

    for finding in kept:
        if finding.type == "unused_dependency":
            changed = remove_dependency(
                result.files, finding.details["declarations"], normalize(finding.name)
            )
            if changed:
                result.files.update(changed)
                result.applied.append(finding.id)

    result.files, result.cascades = cascade_imports(files, result.files, touched)

    if rescan is not None and (kept or deleted):
        now_unused = rescan(result.files)
        for name in sorted(now_unused - (known_unused_dependencies or set())):
            declarations = _declarations_for(files, name)
            changed = remove_dependency(result.files, declarations, normalize(name))
            if changed:
                result.files.update(changed)
                result.cascades.append(f"dependency `{name}` is no longer used after this cleanup")

    for finding in alive:
        target = _ignore_target(finding)
        result.files[CONFIG_FILE] = add_ignore(
            result.files.get(CONFIG_FILE), target, "Marked as alive in Dead Code Hunter"
        )
        result.applied.append(finding.id)

    result.changed = sorted(p for p in set(files) | set(result.files) if files.get(p) != result.files.get(p))
    return result


def _ignore_target(finding: Finding) -> str:
    if finding.type == "unused_module":
        return finding.file
    if finding.type == "unused_route":
        handler = finding.node_ids[-1].partition("#")[2]
        return f"{finding.file}#{handler}"
    return f"{finding.file}#{finding.name}"


def _declarations_for(files: dict[str, str], name: str) -> list[dict]:
    from dch.deps.manifests import read_dependencies

    for dep in read_dependencies(files):
        if dep.norm == normalize(name):
            return [d.__dict__ for d in dep.declarations]
    return []
