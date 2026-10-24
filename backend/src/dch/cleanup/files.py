"""Non-Python edits (manifests, ignore file) and unified-diff generation."""

from __future__ import annotations

import difflib

import tomlkit
from tomlkit.items import AoT, Array, Table

from dch.deps.manifests import normalize, parse_requirement

NO_NEWLINE = "\\ No newline at end of file\n"


def remove_from_requirements(text: str, dist: str) -> str:
    kept = []
    for line in text.splitlines(keepends=True):
        stripped = line.split(" #", 1)[0].strip()
        name = parse_requirement(stripped) if stripped and not stripped.startswith(("#", "-")) else None
        if name is None or normalize(name) != dist:
            kept.append(line)
    return "".join(kept)


def _drop_from_array(array: Array, dist: str) -> bool:
    changed = False
    for index in reversed(range(len(array))):
        item = array[index]
        if isinstance(item, str):
            name = parse_requirement(item)
            if name and normalize(name) == dist:
                del array[index]
                changed = True
    return changed


def _drop_from_table(table: Table, dist: str) -> bool:
    changed = False
    for key in list(table.keys()):
        if normalize(str(key)) == dist and key != "python":
            del table[key]
            changed = True
    return changed


def remove_from_pyproject(text: str, dist: str) -> str:
    doc = tomlkit.parse(text)
    changed = False
    project = doc.get("project", {})
    if isinstance(project.get("dependencies"), Array):
        changed |= _drop_from_array(project["dependencies"], dist)
    for group in project.get("optional-dependencies", {}).values():
        changed |= _drop_from_array(group, dist)
    for group in doc.get("dependency-groups", {}).values():
        changed |= _drop_from_array(group, dist)
    poetry = doc.get("tool", {}).get("poetry", {})
    for table in (poetry.get("dependencies"), poetry.get("dev-dependencies")):
        if isinstance(table, Table):
            changed |= _drop_from_table(table, dist)
    for group in poetry.get("group", {}).values():
        if isinstance(group.get("dependencies"), Table):
            changed |= _drop_from_table(group["dependencies"], dist)
    return tomlkit.dumps(doc) if changed else text


def remove_dependency(files: dict[str, str], declarations: list[dict], dist: str) -> dict[str, str]:
    """New text for every manifest that declares ``dist``."""
    updated: dict[str, str] = {}
    for decl in declarations:
        path = decl["file"]
        text = updated.get(path, files.get(path))
        if text is None:
            continue
        if path.endswith("pyproject.toml"):
            updated[path] = remove_from_pyproject(text, dist)
        else:
            updated[path] = remove_from_requirements(text, dist)
    return {p: t for p, t in updated.items() if t != files.get(p)}


def add_ignore(existing: str | None, target: str, reason: str) -> str:
    doc = tomlkit.parse(existing or "")
    entries = doc.get("ignore")
    if entries is None:
        entries = tomlkit.aot()
        doc["ignore"] = entries
    if any(isinstance(e, Table) and e.get("target") == target for e in entries):
        return tomlkit.dumps(doc)
    table = tomlkit.table()
    table["target"] = target
    table["reason"] = reason
    assert isinstance(entries, AoT)
    entries.append(table)
    return tomlkit.dumps(doc)


def unified_diff(path: str, old: str | None, new: str | None) -> str:
    """Git-style unified diff for one file. ``None`` means the file does not exist."""
    if old == new:
        return ""
    header = [f"diff --git a/{path} b/{path}\n"]
    old_lines = old.splitlines(keepends=True) if old is not None else []
    new_lines = new.splitlines(keepends=True) if new is not None else []
    if old is None:
        header.append("new file mode 100644\n")
    elif new is None:
        header.append("deleted file mode 100644\n")
    from_name = f"a/{path}" if old is not None else "/dev/null"
    to_name = f"b/{path}" if new is not None else "/dev/null"
    body = list(difflib.unified_diff(old_lines, new_lines, from_name, to_name, n=3))
    out: list[str] = []
    for line in body:
        out.append(line)
        if not line.endswith("\n"):
            out.append("\n" + NO_NEWLINE)
    return "".join(header) + "".join(out)


def count_changes(diff: str) -> tuple[int, int]:
    """(lines added, lines removed) in a unified diff."""
    added = removed = 0
    for line in diff.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1
    return added, removed
