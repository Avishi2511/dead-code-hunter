from __future__ import annotations

MAIN = "if __name__ == '__main__': main()"


def test_unused_import_and_exemptions(scan):
    s = scan(
        {
            "app.py": f"""
            import os
            import sys  # noqa: F401
            from typing import TYPE_CHECKING
            from collections import OrderedDict

            if TYPE_CHECKING:
                from decimal import Decimal

            def main(d: "Decimal") -> None:
                print(sys)

            {MAIN}
        """,
            "pkg/__init__.py": "from pkg.core import thing\n",
            "pkg/core.py": "thing = 1\n",
        }
    )
    assert s.names("unused_import") == {"os", "OrderedDict"}


def test_dead_cluster_is_reported_via_reachability(scan):
    s = scan(
        {
            "app.py": f"""
            def main():
                return live()

            def live():
                return 1

            def dead_a():
                return dead_b()

            def dead_b():
                return dead_a()

            {MAIN}
        """,
        }
    )
    assert s.names("unused_function") == {"dead_a", "dead_b"}
    evidence = {e.code for e in s.find(name="dead_b")[0].evidence}
    assert "only_dead_refs" in evidence


def test_methods_resolved_through_typed_locals_self_and_overrides(scan):
    s = scan(
        {
            "app.py": f"""
            class Base:
                def run(self):
                    return self.helper()

                def helper(self):
                    return 1

                def unused(self):
                    return 2

            class Child(Base):
                def run(self):
                    return 3

            def main():
                b = Base()
                b.run()
                Child()

            {MAIN}
        """,
        }
    )
    assert s.names("unused_method") == {"Base.unused"}


def test_dunder_property_and_abstract_methods_are_live(scan):
    s = scan(
        {
            "app.py": f"""
            from abc import ABC, abstractmethod

            class Thing(ABC):
                def __repr__(self):
                    return 'x'

                @property
                def size(self):
                    return 1

                @abstractmethod
                def impl(self): ...

            def main():
                return Thing

            {MAIN}
        """,
        }
    )
    assert s.names("unused_method") == set()


def test_unused_module_and_imported_module(scan):
    s = scan(
        {
            "app.py": f"""
            import used
            def main(): return used

            {MAIN}
        """,
            "used.py": "X = 1\n",
            "orphan.py": "def f(): return 1\n",
        }
    )
    assert s.names("unused_module") == {"orphan.py"}
    assert s.find("unused_function", "f") == []  # covered by the module finding


def test_test_only_symbols_are_medium(scan):
    s = scan(
        {
            "app.py": f"""
            def helper(): return 1
            def main(): return 0
            {MAIN}
        """,
            "tests/test_app.py": "from app import helper\n\ndef test_it():\n    assert helper() == 1\n",
        }
    )
    (finding,) = s.find("unused_function", "helper")
    assert finding.level == "medium"
    assert "only_test_refs" in {e.code for e in finding.evidence}
    assert s.find(file="tests/test_app.py") == []


def test_unused_variable_is_never_high(scan):
    s = scan(
        {
            "app.py": f"""
            LIMIT = 3
            USED = 4
            def main(): return USED
            {MAIN}
        """,
        }
    )
    (finding,) = s.find("unused_variable")
    assert finding.name == "LIMIT"
    assert finding.level == "medium"


def test_unreachable_after_return_and_constant_conditions(scan):
    s = scan(
        {
            "app.py": f"""
            import sys

            def a():
                return 1
                print('x')

            def b():
                if False:
                    print('y')
                if True:
                    pass
                else:
                    print('z')
                while True:
                    pass
                print('after loop')

            def c(flag):
                if flag:
                    return 1
                else:
                    raise ValueError()
                print('after if')

            def d():
                sys.exit(1)
                print('after exit')

            def e():
                return
                yield

            def main():
                a(); b(); c(1); d(); e()

            {MAIN}
        """,
        }
    )
    blocks = {(f.name, f.line) for f in s.find("unreachable_code")}
    assert blocks == {("a", 5), ("b", 9), ("b", 13), ("b", 16), ("c", 23), ("d", 27)}
    by_line = {f.line: f for f in s.find("unreachable_code")}
    assert by_line[5].confidence == 98
    assert by_line[9].confidence == 94


def test_unreachable_inside_dead_function_is_covered(scan):
    s = scan(
        {
            "app.py": f"""
            def dead():
                return 1
                print('x')

            def main(): pass
            {MAIN}
        """,
        }
    )
    assert s.find("unreachable_code") == []
    assert s.names("unused_function") == {"dead"}


def test_getattr_on_module_weakens_confidence(scan):
    s = scan(
        {
            "app.py": f"""
            import sys

            def handle_a(): pass

            def main():
                return getattr(sys.modules[__name__], 'handle_' + 'a')

            {MAIN}
        """,
        }
    )
    (finding,) = s.find("unused_function", "handle_a")
    assert finding.level != "high"
    assert "dynamic_access" in {e.code for e in finding.evidence}


def test_string_reference_weakens_confidence(scan):
    s = scan(
        {
            "app.py": f"""
            REGISTRY = ['hooks:run_hook']
            def run_hook(): pass
            def main(): return REGISTRY
            {MAIN}
        """,
        }
    )
    (finding,) = s.find("unused_function", "run_hook")
    assert "string_literal_match" in {e.code for e in finding.evidence}


def test_ignore_rules_hide_findings(scan):
    s = scan(
        {
            "app.py": f"""
            def keep_me(): pass
            def main(): pass
            {MAIN}
        """,
            ".deadcodehunter.toml": '[[ignore]]\ntarget = "app.py#keep_me"\nreason = "plugin"\n',
        }
    )
    assert s.find("unused_function", "keep_me") == []
