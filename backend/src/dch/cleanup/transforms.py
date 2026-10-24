"""libcst transforms that remove dead code from a Python module while preserving formatting."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider


@dataclass(frozen=True)
class PyEdit:
    kind: str  # remove_lines | remove_import | unreachable
    key: str  # finding id, reported back in ``applied``
    start: int = 0
    end: int = 0
    name: str = ""  # import: local name bound by the alias
    block_kind: str = ""  # unreachable: after_terminator | if_false | else_of_if_true
    anchor: int = 0  # unreachable: line of the controlling statement


def alias_local(alias: cst.ImportAlias, from_import: bool) -> str:
    if alias.asname and isinstance(alias.asname.name, cst.Name):
        return alias.asname.name.value
    text = cst.Module([]).code_for_node(alias.name)
    return text if from_import else text.split(".")[0]


def suite_statements(suite: cst.BaseSuite) -> list[cst.BaseStatement]:
    if isinstance(suite, cst.IndentedBlock):
        return list(suite.body)
    return [cst.SimpleStatementLine(body=list(suite.body))]


class Editor(cst.CSTTransformer):
    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, edits: Sequence[PyEdit]) -> None:
        super().__init__()
        self.remove = {(e.start, e.end): e for e in edits if e.kind == "remove_lines"}
        self.imports = {(e.start, e.name): e for e in edits if e.kind == "remove_import"}
        unreachable = [e for e in edits if e.kind == "unreachable"]
        self.after = [e for e in unreachable if e.block_kind == "after_terminator"]
        self.branch = {e.anchor: e for e in unreachable if e.block_kind != "after_terminator"}
        self.applied: set[str] = set()
        self.elifs: set[cst.If] = set()
        self.removed_starts: set[int] = set()

    # ---- helpers ---------------------------------------------------------------------------

    def span(self, node: cst.CSTNode) -> tuple[int, int]:
        pos = self.get_metadata(PositionProvider, node)
        start = pos.start.line
        for decorator in getattr(node, "decorators", ()):
            start = min(start, self.get_metadata(PositionProvider, decorator).start.line)
        return start, pos.end.line

    def should_remove(self, original: cst.BaseStatement) -> bool:
        start, end = self.span(original)
        edit = self.remove.get((start, end))
        if edit is not None:
            if isinstance(original, cst.SimpleStatementLine) and len(original.body) != 1:
                return False  # several statements on one line: leave for manual cleanup
            self.applied.add(edit.key)
            self.removed_starts.add(start)
            return True
        for block in self.after:
            if block.start <= start and end <= block.end:
                self.applied.add(block.key)
                return True
        return False

    def on_leave(self, original_node, updated_node):
        result = super().on_leave(original_node, updated_node)
        if not isinstance(result, cst.CSTNode):
            return result
        if isinstance(result, cst.SimpleStatementLine) and not result.body:
            self.removed_starts.add(self.span(original_node)[0])
            return cst.RemoveFromParent()
        if isinstance(original_node, cst.BaseStatement) and self.should_remove(original_node):
            return cst.RemoveFromParent()
        return result

    # ---- imports ---------------------------------------------------------------------------

    def drop_aliases(self, original, updated, from_import: bool):
        names = updated.names
        if isinstance(names, cst.ImportStar):
            return updated
        kept = []
        for alias, original_alias in zip(names, original.names, strict=True):
            line = self.get_metadata(PositionProvider, original_alias).start.line
            edit = self.imports.get((line, alias_local(original_alias, from_import)))
            if edit is None:
                kept.append(alias)
            else:
                self.applied.add(edit.key)
        if len(kept) == len(names):
            return updated
        if not kept:
            return cst.RemoveFromParent()
        if kept[-1] is not names[-1]:
            # the removed alias was last: end the list the way the original did (trailing comma or not)
            kept[-1] = kept[-1].with_changes(comma=names[-1].comma)
        return updated.with_changes(names=kept)

    def leave_ImportFrom(self, original_node, updated_node):
        return self.drop_aliases(original_node, updated_node, True)

    def leave_Import(self, original_node, updated_node):
        return self.drop_aliases(original_node, updated_node, False)

    # ---- unreachable branches --------------------------------------------------------------

    def visit_If(self, node: cst.If) -> bool:
        if isinstance(node.orelse, cst.If):
            self.elifs.add(node.orelse)
        return True

    def leave_If(self, original_node: cst.If, updated_node: cst.If):
        updated_node = self.fix_nested_branch(original_node, updated_node)
        if original_node in self.elifs:
            return updated_node  # an `elif` is rewritten by its parent
        edit = self.branch.get(self.span(original_node)[0])
        if edit is None:
            return updated_node
        self.applied.add(edit.key)
        return self.replace_branch(edit, updated_node)

    def fix_nested_branch(self, original: cst.If, updated: cst.If) -> cst.If:
        nested_original = original.orelse
        if not isinstance(nested_original, cst.If):
            return updated
        edit = self.branch.get(self.span(nested_original)[0])
        nested = updated.orelse
        if edit is None or not isinstance(nested, cst.If):
            return updated
        self.applied.add(edit.key)
        if edit.block_kind == "if_false":
            return updated.with_changes(orelse=nested.orelse)
        return updated.with_changes(orelse=cst.Else(body=nested.body))

    def replace_branch(self, edit: PyEdit, node: cst.If):
        if edit.block_kind == "if_false":
            orelse = node.orelse
            if orelse is None:
                return cst.RemoveFromParent()
            if isinstance(orelse, cst.If):
                return orelse.with_changes(leading_lines=node.leading_lines)
            statements = suite_statements(orelse.body)
        else:
            statements = suite_statements(node.body)
        if not statements:
            return cst.RemoveFromParent()
        first = statements[0]
        statements[0] = first.with_changes(leading_lines=[*node.leading_lines, *first.leading_lines])
        return cst.FlattenSentinel(statements)

    def leave_Module(self, original_node: cst.Module, updated_node: cst.Module) -> cst.Module:
        """Do not leave blank lines at the top of a file whose first statement was removed."""
        if not original_node.body:
            return updated_node
        if not updated_node.body:
            return updated_node.with_changes(header=[], footer=[], has_trailing_newline=False)
        if self.span(original_node.body[0])[0] not in self.removed_starts:
            return updated_node
        first = updated_node.body[0]
        lines = list(first.leading_lines)
        while lines and not lines[0].comment:
            lines.pop(0)
        return updated_node.with_changes(
            body=[first.with_changes(leading_lines=lines), *updated_node.body[1:]]
        )

    # ---- keep blocks valid -----------------------------------------------------------------

    def leave_IndentedBlock(self, original_node, updated_node):
        if updated_node.body:
            return updated_node
        return updated_node.with_changes(body=[cst.SimpleStatementLine(body=[cst.Pass()])])


def apply_py_edits(source: str, edits: Sequence[PyEdit]) -> tuple[str, set[str]]:
    """Apply edits to ``source``; returns the new source and the keys of edits that matched."""
    wrapper = MetadataWrapper(cst.parse_module(source))
    editor = Editor(edits)
    code = wrapper.visit(editor).code
    cst.parse_module(code)  # never hand back source that does not parse
    return code, editor.applied
