"""File-local unused-import detection, used to compute cascades after code is removed."""

from __future__ import annotations

from dataclasses import dataclass

import libcst as cst
from libcst.metadata import GlobalScope, ImportAssignment, MetadataWrapper, PositionProvider, ScopeProvider

from dch.cleanup.transforms import alias_local
from dch.engine.detectors import noqa_suppresses


@dataclass(frozen=True)
class UnusedImport:
    key: str  # stable across edits: "<module>|<alias source>"
    local: str
    line: int


def exported_names(module: cst.Module) -> set[str]:
    names: set[str] = set()
    for stmt in module.body:
        if not isinstance(stmt, cst.SimpleStatementLine):
            continue
        for small in stmt.body:
            target = value = None
            if isinstance(small, cst.Assign) and len(small.targets) == 1:
                target, value = small.targets[0].target, small.value
            elif isinstance(small, cst.AugAssign):
                target, value = small.target, small.value
            if isinstance(target, cst.Name) and target.value == "__all__":
                if isinstance(value, cst.List | cst.Tuple):
                    names |= {
                        el.value.evaluated_value
                        for el in value.elements
                        if isinstance(el.value, cst.SimpleString)
                        and isinstance(el.value.evaluated_value, str)
                    }
    return names


def find_unused_imports(source: str, path: str) -> list[UnusedImport]:
    if path.endswith("__init__.py"):
        return []
    wrapper = MetadataWrapper(cst.parse_module(source))
    scopes = wrapper.resolve(ScopeProvider)
    positions = wrapper.resolve(PositionProvider)
    global_scope = next((s for s in set(scopes.values()) if isinstance(s, GlobalScope)), None)
    if global_scope is None:
        return []
    exported = exported_names(wrapper.module)
    lines = source.splitlines()
    code = cst.Module([]).code_for_node
    found: list[UnusedImport] = []
    for assignment in global_scope.assignments:
        node = assignment.node
        if not isinstance(assignment, ImportAssignment) or assignment.references:
            continue
        if isinstance(node, cst.ImportFrom):
            if isinstance(node.names, cst.ImportStar) or (
                isinstance(node.module, cst.Name) and node.module.value == "__future__"
            ):
                continue
            module_text = "." * len(node.relative) + (code(node.module) if node.module else "")
            aliases, from_import = node.names, True
        elif isinstance(node, cst.Import):
            module_text, aliases, from_import = "", node.names, False
        else:
            continue
        for alias in aliases:
            local = alias_local(alias, from_import)
            if local != assignment.name or local in exported:
                continue
            line = positions[alias].start.line
            if noqa_suppresses(lines[line - 1] if line <= len(lines) else ""):
                continue
            found.append(UnusedImport(f"{module_text}|{code(alias).strip()}", local, line))
    return found
