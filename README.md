# Dead Code Hunter

Finds dead code in public Python / FastAPI repositories with static analysis: unused functions, classes,
methods, variables, imports, modules, routes, dependencies and unreachable code. Every finding comes with
evidence and a confidence level, and a cleanup produces a reviewable `git apply` patch. The analyzed
project is never imported, installed or executed. See `docs/implementation-plan.md`.

```text
backend/    analyzer (dch) + FastAPI service (dch_api) — see backend/README.md
frontend/   React + TypeScript + Vite UI
fixtures/   haunted-fastapi: seeded demo app with planted dead code and traps
api/, vercel.json   the only Vercel-specific files
```

## Run it locally

Needs Python 3.12 + [uv](https://docs.astral.sh/uv/) and Node 18+. No Docker, no external database
(local runs use SQLite).

```bash
# 1. API on :8000
cd backend && uv sync --extra basedpyright --extra api
uv run uvicorn dch_api.main:app_factory --factory --reload

# 2. UI on :5173 (proxies /api to :8000)
cd frontend && npm install && npm run dev
```

Scanning GitHub repositories uses the public API; set `GITHUB_TOKEN` to raise the rate limit.
Analyzer only, no web: `uv run dch scan <dir>` (see `backend/README.md`).

## Tests

```bash
cd backend && uv run pytest && uv run ruff check src tests
cd frontend && npm test && npm run build
sh scripts/gen-api-types.sh --check      # fails when frontend/src/api/schema.d.ts is stale
```

## Deploying

Vercel Hobby: `vercel.json` builds the Vite app and serves `api/index.py`. Set `DATABASE_URL` (Neon or any
Postgres, run `alembic upgrade head` once), `JOB_RUNNER=inline`, `MAINTENANCE_TOKEN` and `CRON_SECRET`
(same value). `scripts/export-requirements.sh` regenerates the root `requirements.txt` from `uv.lock`.
Any other host: run `uvicorn dch_api.main:app_factory --factory` with `JOB_RUNNER=background` and
`SERVE_STATIC=true` after `npm run build`.
