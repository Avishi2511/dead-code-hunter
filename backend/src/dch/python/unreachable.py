"""Unreachable-code detection on statement suites (intra-procedural, purely syntactic)."""

from __future__ import annotations

from collections.abc import Sequence

import libcst as cst

from dch.python.collect import dotted
from dch.python.model import ModuleInfo, ProjectIndex, UnreachableBlock

EXIT_CALLS = {"sys.exit", "os._exit", "exit", "quit"}


def literal_truth(expr: cst.BaseExpression) -> bool | None:
    if isinstance(expr, cst.Name):
        if expr.value == "True":
            return True
        if expr.value in ("False", "None"):
            return False
    if isinstance(expr, cst.Integer):
        return int(expr.value, 0) != 0
    return None


def contains_break(body: Sequence[cst.CSTNode]) -> bool:
    class Finder(cst.CSTVisitor):
        found = False

        def visit_Break(self, node: cst.Break) -> None:
            self.found = True

        def visit_For(self, node: cst.For) -> bool:
            return False

        def visit_While(self, node: cst.While) -> bool:
            return False

        def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
            return False

    finder = Finder()
    for stmt in body:
        stmt.visit(finder)
    return finder.found


class UnreachableFinder:
    def __init__(self, project: ProjectIndex, mod: ModuleInfo) -> None:
        self.p = project
        self.m = mod
        self.scope: list[str] = []

    def line(self, node: cst.CSTNode, end: bool = False) -> int:
        pos = self.m.positions[node]
        return pos.end.line if end else pos.start.line

    def report(self, stmts: Sequence[cst.CSTNode], reason: str, kind: str, anchor: int) -> None:
        if not stmts:
            return
        if kind == "after_terminator" and self.only_yield(stmts):
            return
        self.p.unreachable.append(
            UnreachableBlock(
                self.m.path,
                ".".join(self.scope) or "<module>",
                self.line(stmts[0]),
                self.line(stmts[-1], end=True),
                reason,
                kind,
                anchor,
            )
        )

    @staticmethod
    def only_yield(stmts: Sequence[cst.CSTNode]) -> bool:
        return all(
            isinstance(s, cst.SimpleStatementLine)
            and all(isinstance(x, cst.Expr) and isinstance(x.value, cst.Yield) for x in s.body)
            for s in stmts
        )

    def terminates_small(self, small: cst.BaseSmallStatement) -> bool:
        if isinstance(small, cst.Return | cst.Raise | cst.Continue | cst.Break):
            return True
        if isinstance(small, cst.Expr) and isinstance(small.value, cst.Call):
            return dotted(small.value.func) in EXIT_CALLS
        return False

    def terminates(self, stmt: cst.CSTNode) -> bool:
        if isinstance(stmt, cst.SimpleStatementLine):
            return any(self.terminates_small(s) for s in stmt.body)
        if isinstance(stmt, cst.If):
            truth = literal_truth(stmt.test)
            body_ends = self.block_terminates(stmt.body.body)
            orelse = stmt.orelse
            if orelse is None:
                else_ends = False
            elif isinstance(orelse, cst.If):
                else_ends = self.terminates(orelse)
            else:
                else_ends = self.block_terminates(orelse.body.body)
            if truth is True:
                return body_ends
            if truth is False:
                return else_ends
            return body_ends and else_ends
        if isinstance(stmt, cst.While):
            return literal_truth(stmt.test) is True and not contains_break(stmt.body.body)
        return False

    def block_terminates(self, body: Sequence[cst.CSTNode]) -> bool:
        return any(self.terminates(s) for s in body)

    def check_block(self, body: Sequence[cst.CSTNode]) -> None:
        for index, stmt in enumerate(body):
            self.check_statement(stmt)
            if self.terminates(stmt):
                self.report(
                    body[index + 1 :], f"follows `{self.describe(stmt)}`", "after_terminator", self.line(stmt)
                )
                return

    def describe(self, stmt: cst.CSTNode) -> str:
        if isinstance(stmt, cst.SimpleStatementLine):
            for small in stmt.body:
                if isinstance(small, cst.Expr) and isinstance(small.value, cst.Call):
                    return f"{dotted(small.value.func)}()"
                if self.terminates_small(small):
                    return type(small).__name__.lower()
        if isinstance(stmt, cst.While):
            return "while True"
        return "if/else where every branch exits"

    def check_statement(self, stmt: cst.CSTNode) -> None:
        if isinstance(stmt, cst.FunctionDef | cst.ClassDef):
            self.scope.append(stmt.name.value)
            self.check_block(stmt.body.body)
            self.scope.pop()
        elif isinstance(stmt, cst.If):
            self.check_if(stmt)
        elif isinstance(stmt, cst.Try | cst.TryStar):
            self.check_block(stmt.body.body)
            for handler in stmt.handlers:
                self.check_block(handler.body.body)
            for tail in (stmt.orelse, stmt.finalbody):
                if tail:
                    self.check_block(tail.body.body)
        elif isinstance(stmt, cst.With | cst.For | cst.While):
            self.check_block(stmt.body.body)
            if getattr(stmt, "orelse", None):
                self.check_block(stmt.orelse.body.body)

    def check_if(self, stmt: cst.If) -> None:
        if dotted(stmt.test) in ("TYPE_CHECKING", "typing.TYPE_CHECKING"):
            return
        truth = literal_truth(stmt.test)
        anchor = self.line(stmt)
        orelse = stmt.orelse
        if truth is False:
            self.report(stmt.body.body, "condition is always false", "if_false", anchor)
        else:
            self.check_block(stmt.body.body)
        if isinstance(orelse, cst.If):
            if truth is True:
                self.report([orelse], "`else` of an always-true condition", "else_of_if_true", anchor)
            else:
                self.check_if(orelse)
        elif orelse is not None:
            if truth is True:
                self.report(orelse.body.body, "`else` of an always-true condition", "else_of_if_true", anchor)
            else:
                self.check_block(orelse.body.body)


def find_unreachable(project: ProjectIndex) -> None:
    for mod in project.modules.values():
        if mod.tree is not None:
            UnreachableFinder(project, mod).check_block(mod.tree.body)
