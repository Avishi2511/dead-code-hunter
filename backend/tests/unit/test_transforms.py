from __future__ import annotations

import textwrap

import libcst as cst

from dch.cleanup.transforms import PyEdit, apply_py_edits


def code(text: str) -> str:
    return textwrap.dedent(text).lstrip("\n")


def apply(source: str, *edits: PyEdit) -> tuple[str, set[str]]:
    result, applied = apply_py_edits(code(source), edits)
    cst.parse_module(result)
    return result, applied


def test_remove_function_with_decorators_and_attached_comments():
    result, applied = apply(
        """
        import functools

        # keep me? no: this comment belongs to the function
        @functools.cache
        @staticmethod
        def old():
            return 1


        def keep():
            return 2
        """,
        PyEdit("remove_lines", "f", 4, 7),
    )
    assert applied == {"f"}
    assert result == code(
        """
        import functools


        def keep():
            return 2
        """
    )


def test_empty_class_body_gets_pass():
    result, _ = apply(
        """
        class Box:
            def only(self):
                return 1
        """,
        PyEdit("remove_lines", "m", 2, 3),
    )
    assert result == "class Box:\n    pass\n"


def test_remove_single_target_variable_but_not_multi_statement_line():
    result, applied = apply(
        """
        A = 1
        B = 2; C = 3
        D = 4
        """,
        PyEdit("remove_lines", "a", 1, 1),
        PyEdit("remove_lines", "b", 2, 2),
    )
    assert applied == {"a"}  # `B = 2; C = 3` is left for a human
    assert result == "B = 2; C = 3\nD = 4\n"


def test_import_alias_removal_variants():
    source = """
        import os, sys
        from a import b, c
        from d import (
            e,
            f,
        )
        import x.y as z
        from m import only
        """
    result, applied = apply(
        source,
        PyEdit("remove_import", "1", 1, name="os"),
        PyEdit("remove_import", "2", 2, name="b"),
        PyEdit("remove_import", "3", 4, name="e"),
        PyEdit("remove_import", "4", 7, name="z"),
        PyEdit("remove_import", "5", 8, name="only"),
    )
    assert applied == {"1", "2", "3", "4", "5"}
    assert result == code(
        """
        import sys
        from a import c
        from d import (
            f,
        )
        """
    )


def test_unreachable_after_terminator_is_removed():
    result, _ = apply(
        """
        def f():
            return 1
            print('a')
            print('b')

        def g():
            pass
        """,
        PyEdit("unreachable", "u", 3, 4, block_kind="after_terminator", anchor=2),
    )
    assert result == code(
        """
        def f():
            return 1

        def g():
            pass
        """
    )


def test_if_false_is_dropped_or_replaced_by_else_body():
    plain, _ = apply(
        """
        def f():
            if False:
                a()
            return 1
        """,
        PyEdit("unreachable", "u", 3, 3, block_kind="if_false", anchor=2),
    )
    assert plain == "def f():\n    return 1\n"
    with_else, _ = apply(
        """
        def f():
            if 0:
                a()
            else:
                b()
                c()
            return 1
        """,
        PyEdit("unreachable", "u", 3, 3, block_kind="if_false", anchor=2),
    )
    assert with_else == "def f():\n    b()\n    c()\n    return 1\n"


def test_if_false_with_elif_promotes_the_elif():
    result, _ = apply(
        """
        if False:
            a()
        elif cond:
            b()
        else:
            c()
        """,
        PyEdit("unreachable", "u", 2, 2, block_kind="if_false", anchor=1),
    )
    assert result == "if cond:\n    b()\nelse:\n    c()\n"


def test_else_of_if_true_flattens_the_body_and_handles_nested_elif():
    result, _ = apply(
        """
        if True:
            a()
            b()
        else:
            c()
        """,
        PyEdit("unreachable", "u", 5, 5, block_kind="else_of_if_true", anchor=1),
    )
    assert result == "a()\nb()\n"
    nested, _ = apply(
        """
        if x:
            a()
        elif True:
            b()
        else:
            c()
        """,
        PyEdit("unreachable", "u", 6, 6, block_kind="else_of_if_true", anchor=3),
    )
    assert nested == "if x:\n    a()\nelse:\n    b()\n"


def test_nested_elif_if_false_is_dropped_from_the_chain():
    result, _ = apply(
        """
        if x:
            a()
        elif False:
            b()
        else:
            c()
        """,
        PyEdit("unreachable", "u", 4, 4, block_kind="if_false", anchor=3),
    )
    assert result == "if x:\n    a()\nelse:\n    c()\n"


def test_removing_everything_leaves_an_empty_file_and_no_leading_blank_line():
    emptied, _ = apply("import os\n", PyEdit("remove_import", "i", 1, name="os"))
    assert emptied == ""
    top, _ = apply(
        """
        import os

        import sys
        print(sys)
        """,
        PyEdit("remove_import", "i", 1, name="os"),
    )
    assert top == "import sys\nprint(sys)\n"


def test_crlf_line_endings_are_preserved():
    source = "import os\r\nimport sys\r\n\r\nprint(sys)\r\n"
    result, _ = apply_py_edits(source, [PyEdit("remove_import", "i", 1, name="os")])
    assert result == "import sys\r\n\r\nprint(sys)\r\n"
