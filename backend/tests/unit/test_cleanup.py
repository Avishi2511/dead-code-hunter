from __future__ import annotations

import tomllib

import pytest

from conftest import make_tree
from dch.cleanup.apply import apply_selections, resolve_overlaps
from dch.cleanup.engine import index_findings, run_cleanup
from dch.cleanup.files import add_ignore, remove_from_pyproject, remove_from_requirements, unified_diff
from dch.result import Selection
from dch.scan import scan_tree

MAIN = "if __name__ == '__main__': main()"


def scanned(files: dict[str, str]):
    tree = make_tree(files)
    return tree, scan_tree(tree)


def pick(result, type_: str, name: str):
    (finding,) = [f for f in result.findings if f.type == type_ and f.name == name]
    return finding


def remove(tree, result, *findings):
    selections = [Selection(finding_id=f.id) for f in findings]
    return run_cleanup(tree, result, selections, validate=False)


def test_suggestions_hold_a_diff_cascades_and_a_static_check():
    tree, result = scanned(
        {
            "app.py": f"""
                import json
                import os

                def helper():
                    return json.dumps({{}})

                def main():
                    return os.getcwd()

                {MAIN}
            """
        }
    )
    finding = pick(result, "unused_function", "helper")
    suggestion = finding.suggestion
    assert suggestion is not None
    assert suggestion.static_check == "pass"
    assert any("json" in c for c in suggestion.cascades)
    assert "-import json" in suggestion.diff and "-def helper" in suggestion.diff
    assert finding.impact_lines == 4


def test_cascade_removes_only_imports_made_unused_by_the_cleanup():
    tree, result = scanned(
        {
            "app.py": f"""
                import json
                import os
                import sys

                def helper():
                    return json.dumps({{}})

                def main():
                    return os.getcwd()

                {MAIN}
            """
        }
    )
    cleaned = remove(tree, result, pick(result, "unused_function", "helper"))
    applied = apply_selections(
        tree.files,
        index_findings(result),
        [Selection(finding_id=pick(result, "unused_function", "helper").id)],
    )
    assert "import json" not in applied.files["app.py"]
    assert "import sys" in applied.files["app.py"]  # already unused, but not part of this cleanup
    assert cleaned.summary.findings == 1


def test_module_deletion_covers_findings_inside_and_emits_a_deleted_file_diff():
    tree, result = scanned(
        {
            "app.py": f"def main(): pass\n{MAIN}\n",
            "orphan.py": "import os\n\ndef f():\n    return 1\n    print('x')\n",
        }
    )
    module = pick(result, "unused_module", "orphan.py")
    cleaned = remove(tree, result, module)
    assert "deleted file mode 100644" in cleaned.diff
    assert "+++ /dev/null" in cleaned.diff
    assert cleaned.summary.files_changed == 1


def test_overlapping_selections_are_resolved_to_the_outer_finding():
    tree, result = scanned(
        {
            "app.py": f"""
                import os
                def dead():
                    return 1
                    print('after')

                def main(): pass
                {MAIN}
            """
        }
    )
    dead = pick(result, "unused_function", "dead")
    unreachable = [f for f in result.findings if f.type == "unreachable_code"]
    assert unreachable == []  # already hidden by the scan; build the overlap by hand
    inner = dead.model_copy(update={"id": "inner", "type": "unreachable_code", "line": 3, "end_line": 3})
    kept, covered = resolve_overlaps([inner, dead])
    assert [f.id for f in kept] == [dead.id]
    assert covered == {"inner": dead.id}


def test_unused_route_cleanup_also_removes_the_unmounted_router_variable():
    files = {
        "main.py": """
            from fastapi import FastAPI
            import extra

            app = FastAPI()
        """,
        "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
        "extra.py": """
            from fastapi import APIRouter

            router = APIRouter(prefix="/e")


            @router.get("/a")
            def a():
                return 1


            @router.get("/b")
            def b():
                return 2
        """,
    }
    tree, result = scanned(files)
    routes = [f for f in result.findings if f.type == "unused_route"]
    assert len(routes) == 2
    applied = apply_selections(
        tree.files, index_findings(result), [Selection(finding_id=r.id) for r in routes]
    )
    assert applied.files["extra.py"] == ""

    only_one = apply_selections(tree.files, index_findings(result), [Selection(finding_id=routes[0].id)])
    assert "router = APIRouter" in only_one.files["extra.py"]


def test_dependency_removal_in_requirements_and_pyproject_keeps_formatting():
    assert remove_from_requirements("a==1\nrequests>=2  # http\nb\n", "requests") == "a==1\nb\n"
    text = '[project]\nname = "x"\ndependencies = [\n    "fastapi",\n    "requests>=2",  # http\n    "arrow",\n]\n'
    updated = remove_from_pyproject(text, "requests")
    assert tomllib.loads(updated)["project"]["dependencies"] == ["fastapi", "arrow"]
    assert 'name = "x"' in updated
    poetry = '[tool.poetry.dependencies]\npython = "^3.12"\nRequests = "*"\n'
    assert "Requests" not in remove_from_pyproject(poetry, "requests")
    assert "python" in remove_from_pyproject(poetry, "requests")


def test_removing_the_last_importer_cascades_to_the_dependency():
    files = {
        "pyproject.toml": '[project]\ndependencies = ["requests", "arrow"]\n',
        "app.py": f"""
            import requests

            def helper():
                return requests.get('x')

            def main(): pass

            {MAIN}
        """,
    }
    tree, result = scanned(files)
    names = {f.name for f in result.findings if f.type == "unused_dependency"}
    assert names == {"arrow"}
    cleaned = remove(tree, result, pick(result, "unused_function", "helper"))
    assert "diff --git a/pyproject.toml b/pyproject.toml" in cleaned.diff
    assert '-dependencies = ["requests", "arrow"]' in cleaned.diff
    assert '+dependencies = ["arrow"]' in cleaned.diff


def test_mark_as_alive_writes_an_ignore_rule_that_a_rescan_honours():
    tree, result = scanned({"app.py": f"def keep(): pass\ndef main(): pass\n{MAIN}\n"})
    finding = pick(result, "unused_function", "keep")
    applied = apply_selections(
        tree.files, index_findings(result), [Selection(finding_id=finding.id, action="mark_alive")]
    )
    config = tomllib.loads(applied.files[".deadcodehunter.toml"])
    assert config["ignore"][0]["target"] == "app.py#keep"
    assert "new file mode" in applied.diff()
    rescanned = scan_tree(make_tree(applied.files), suggestions=False)
    assert [f for f in rescanned.findings if f.name == "keep"] == []


def test_add_ignore_is_idempotent_and_preserves_existing_content():
    first = add_ignore('[roots]\nmodules = ["a.py"]\n', "x.py#f", "why")
    assert add_ignore(first, "x.py#f", "why") == first
    parsed = tomllib.loads(first)
    assert parsed["roots"]["modules"] == ["a.py"]
    assert parsed["ignore"][0]["reason"] == "why"


def test_unified_diff_marks_missing_trailing_newline():
    diff = unified_diff("a.py", "x = 1\ny = 2", "x = 1\n")
    assert "\\ No newline at end of file" in diff
    assert diff.startswith("diff --git a/a.py b/a.py\n")


def test_unknown_finding_id_is_rejected():
    tree, result = scanned({"app.py": f"def main(): pass\n{MAIN}\n"})
    with pytest.raises(KeyError):
        run_cleanup(tree, result, [Selection(finding_id="nope")])


def test_references_from_tests_make_the_suggestion_fail():
    tree, result = scanned(
        {
            "app.py": f"def helper(): return 1\ndef main(): pass\n{MAIN}\n",
            "tests/test_app.py": "from app import helper\n\ndef test_it():\n    assert helper() == 1\n",
        }
    )
    suggestion = pick(result, "unused_function", "helper").suggestion
    assert suggestion is not None
    assert suggestion.static_check == "fail"
    assert any("tests" in n for n in suggestion.static_notes)
