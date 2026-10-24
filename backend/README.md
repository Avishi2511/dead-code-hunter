# dch — Dead Code Hunter analyzer

Static analyzer for Python / FastAPI projects. It builds a code graph, finds likely dead code
(functions, classes, methods, variables, imports, modules, dependencies, routes, unreachable code),
explains the evidence for each finding and produces cleanup patches. It never imports, installs or
runs the analyzed project, and it never modifies a repository: cleanups are emitted as a `.patch`.

This package is the analyzer from `docs/implementation-plan.md` (milestones M0–M4). The FastAPI
service and the React frontend (M5) are not part of it yet.

## Setup

```bash
uv sync --extra basedpyright --extra api   # drop basedpyright to use the pure-Python Jedi verifier only
```

Python 3.12+. `basedpyright` brings its own Node runtime; without it the Jedi fallback is used.

## Usage

```bash
# Scan a local project (or --github owner/repo [--ref main] [--subdir backend])
uv run dch scan ../fixtures/haunted-fastapi -o scan.json

# Build a patch + Markdown report for the High-confidence findings (the repo is not touched)
uv run dch cleanup ../fixtures/haunted-fastapi --min-level high --out-dir out/
git apply out/dead-code-cleanup.patch      # run in the target repository

# Mark findings as alive instead (records an [[ignore]] rule in .deadcodehunter.toml)
uv run dch cleanup <dir> --select <id>:mark_alive
```

| Option / env | Meaning |
|---|---|
| `--verifier auto\|basedpyright\|jedi\|none` / `VERIFIER` | Type checker used to double-check candidates |
| `--time-budget SECONDS` / `SCAN_TIME_BUDGET_S` | Optional stages (verification, static checks) are skipped with a warning once exceeded |
| `GITHUB_TOKEN` | Used for `--github` (public repositories; raises the GitHub rate limit) |

Validation after a cleanup is static and informational: `compileall`, `ruff` (F401/F811/F821) and
`basedpyright` diagnostics, each diffed against the original tree. The project's tests are not run.

## API

```bash
uv run uvicorn dch_api.main:app_factory --factory --reload      # http://127.0.0.1:8000/docs
DATABASE_URL=postgresql://... uv run alembic upgrade head       # Postgres schema (SQLite dev DBs are created automatically)
```

Configuration is environment-only (`../.env.example`): `DATABASE_URL`, `GITHUB_TOKEN`, `JOB_RUNNER`
(`inline` runs a job inside its `POST .../run` request, `background` on a worker thread),
`VERIFIER`, `SCAN_TIME_BUDGET_S`, `MAX_PY_FILES`, `MAX_TARBALL_MB`, `MAINTENANCE_TOKEN`, `SERVE_STATIC`.
Clients always call `run` and then poll `GET` status, so the same frontend works with both runners.
`/api/maintenance/purge` (POST or GET, `Authorization: Bearer $MAINTENANCE_TOKEN`) deletes old scans;
on Vercel set `CRON_SECRET` to the same value so the cron entry in `vercel.json` can authenticate.

## Layout

```text
src/dch/
  source/      local directory + GitHub tarball providers, safe extraction, limits
  python/      libcst collection, import/expression resolution, references, unreachable code
  graph/       node/edge model and reachability
  frameworks/  entry points, FastAPI (routes, includes, mounts), Pydantic/SQLAlchemy/Celery hooks
  deps/        manifests, import-name map, implicit-usage rules (data/*.toml)
  verify/      basedpyright (LSP) and Jedi reference verification
  engine/      liveness, detectors, scoring + evidence
  cleanup/     transforms, overlaps, cascades, diffs, patch + report
  validate/    compileall / ruff / type-check validation
src/dch_api/
  routes/ services/ jobs/ db/   FastAPI endpoints, scan/cleanup execution, JobRunner, SQLAlchemy models
migrations/                     Alembic
```

## Tests

```bash
uv run pytest        # unit, golden (fixtures/haunted-fastapi) and API tests (SQLite)
uv run ruff check src tests
```

The golden tests scan `fixtures/haunted-fastapi` (planted dead code plus traps that must not be
flagged, listed in `expected.json`), enforce the plan's precision/recall targets, and apply the
generated patch with `git apply`.
