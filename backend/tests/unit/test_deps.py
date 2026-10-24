from __future__ import annotations

from dch.deps.manifests import normalize, read_dependencies

MAIN = "if __name__ == '__main__': main()"


def declared(files: dict[str, str]) -> dict[str, list[str]]:
    return {d.norm: [f"{x.file}:{x.line}" for x in d.declarations] for d in read_dependencies(files)}


def test_requirements_follow_includes_and_ignore_options_and_comments():
    deps = declared(
        {
            "requirements.txt": "-r base/common.txt\n# comment\n--index-url https://x\nflask>=2 ; python_version>'3'\n",
            "base/common.txt": "Requests[socks]==2.0  # pinned\ngit+https://github.com/o/r.git#egg=Custom_Pkg\n",
        }
    )
    assert set(deps) == {"flask", "requests", "custom-pkg"}
    assert deps["requests"] == ["base/common.txt:1"]


def test_pyproject_pep621_groups_and_poetry():
    deps = declared(
        {
            "pyproject.toml": """
[project]
dependencies = ["fastapi>=0.100", "uvicorn[standard]"]
[project.optional-dependencies]
dev = ["pytest"]
[dependency-groups]
lint = ["ruff", {include-group = "dev"}]
[tool.poetry.dependencies]
python = "^3.12"
sqlalchemy = "^2"
[tool.poetry.group.test.dependencies]
httpx = "*"
"""
        }
    )
    assert set(deps) == {"fastapi", "uvicorn", "pytest", "ruff", "sqlalchemy", "httpx"}
    assert deps["fastapi"] == ["pyproject.toml:3"]


def test_normalize_follows_pep_503():
    assert normalize("Typing_Extensions.Foo") == "typing-extensions-foo"


def dep_names(scan, files):
    return {f.name: f for f in scan(files).find("unused_dependency")}


def test_imports_cli_and_tool_config_count_as_usage(scan):
    found = dep_names(
        scan,
        {
            "pyproject.toml": """
[project]
dependencies = ["Pillow", "gunicorn", "black", "requests", "rich"]
[tool.black]
line-length = 100
""",
            "app.py": f"from PIL import Image\ndef main(): return Image\n{MAIN}\n",
            "Procfile": "web: gunicorn app:main\n",
        },
    )
    assert set(found) == {"requests", "rich"}
    assert all(f.level == "high" for f in found.values())


def test_implicit_rules_keep_runtime_only_dependencies(scan):
    found = dep_names(
        scan,
        {
            "pyproject.toml": """
[project]
dependencies = ["fastapi", "python-multipart", "email-validator", "psycopg2-binary", "pytest-asyncio", "types-requests", "requests", "unused-thing"]
""",
            "app.py": f"""
from fastapi import FastAPI, UploadFile
from pydantic import EmailStr
import requests
URL = 'postgresql://u@h/db'
app = FastAPI()
def main(f: UploadFile, e: EmailStr): return requests
{MAIN}
""",
            "tests/test_a.py": "import pytest\n",
        },
    )
    assert set(found) == {"unused-thing"}


def test_guessed_import_name_lowers_confidence(scan):
    found = dep_names(
        scan,
        {
            "pyproject.toml": '[project]\ndependencies = ["python-frobnicate", "exact"]\n',
            "app.py": f"def main(): pass\n{MAIN}\n",
        },
    )
    assert found["python-frobnicate"].confidence == 72
    assert found["exact"].confidence == 92
    assert "heuristic_mapping" in {e.code for e in found["python-frobnicate"].evidence}


def test_mention_in_config_files_weakens_but_does_not_clear(scan):
    found = dep_names(
        scan,
        {
            "pyproject.toml": '[project]\ndependencies = ["orphan"]\n',
            "setup.cfg": "[metadata]\nnotes = orphan\n",
            "app.py": f"def main(): pass\n{MAIN}\n",
        },
    )
    assert found["orphan"].confidence == 77
