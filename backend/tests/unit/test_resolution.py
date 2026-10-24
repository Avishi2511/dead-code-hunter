from __future__ import annotations

MAIN = "if __name__ == '__main__': main()"


def test_relative_imports_and_reexports_through_init(scan):
    s = scan(
        {
            "app/__init__.py": "",
            "app/main.py": f"""
            from app.services import make

            def main():
                return make()

            {MAIN}
        """,
            "app/services/__init__.py": "from .impl import make, never_used\n",
            "app/services/impl.py": """
            def make(): return 1
            def never_used(): return 2
        """,
        }
    )
    assert s.names("unused_function") == {"never_used"}


def test_module_attribute_access_and_aliases(scan):
    s = scan(
        {
            "main.py": f"""
            import pkg.util as u
            import pkg.other

            def main():
                u.used()
                pkg.other.also_used()

            {MAIN}
        """,
            "pkg/__init__.py": "",
            "pkg/util.py": "def used(): pass\ndef unused(): pass\n",
            "pkg/other.py": "def also_used(): pass\n",
        }
    )
    assert s.names("unused_function") == {"unused"}


def test_string_annotations_count_as_use(scan):
    s = scan(
        {
            "main.py": f"""
            from typing import TYPE_CHECKING, Optional

            if TYPE_CHECKING:
                from models import User

            def main(user: "Optional[User]") -> "User":
                return user

            {MAIN}
        """,
            "models.py": "class User: pass\n",
        }
    )
    assert s.find("unused_import") == []


def test_function_local_import_keeps_target_alive(scan):
    s = scan(
        {
            "main.py": f"""
            def main():
                from helpers import work
                return work()

            {MAIN}
        """,
            "helpers.py": "def work(): pass\ndef idle(): pass\n",
        }
    )
    assert s.names("unused_function") == {"idle"}


def test_instance_attribute_types_resolve_methods(scan):
    s = scan(
        {
            "main.py": f"""
            class Repo:
                def find(self): return 1
                def stale(self): return 2

            class Service:
                def __init__(self):
                    self.repo = Repo()

                def go(self):
                    return self.repo.find()

            def main():
                Service().go()

            {MAIN}
        """,
        }
    )
    assert s.names("unused_method") == {"Repo.stale"}


def test_unparsable_file_becomes_warning(scan):
    s = scan(
        {
            "main.py": f"def main(): pass\n{MAIN}",
            "broken.py": "def (:\n",
        }
    )
    assert any("broken.py" in w for w in s.result.warnings)
