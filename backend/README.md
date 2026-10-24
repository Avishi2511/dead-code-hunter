# dch — Dead Code Hunter analyzer

Static analyzer for Python / FastAPI projects. Builds a code graph, finds likely dead code,
explains the evidence and produces cleanup patches. It never imports, installs or runs the
analyzed project.

```bash
uv sync
uv run dch scan ../fixtures/haunted-fastapi -o scan.json
uv run dch cleanup ../fixtures/haunted-fastapi --min-level high --out-dir out/
uv run pytest
```
