#!/usr/bin/env sh
# OpenAPI -> TypeScript types (plan §11). Pass --check to fail when the committed types are stale.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp)"
( cd "$root/backend" && uv run python -c "import json; from dch_api.main import create_app; from dch_api.settings import Settings; print(json.dumps(create_app(Settings(database_url='sqlite://')).openapi()))" > "$tmp" )
out="$root/frontend/src/api/schema.d.ts"
if [ "${1:-}" = "--check" ]; then
  ( cd "$root/frontend" && npx openapi-typescript "$tmp" -o "$tmp.d.ts" )
  diff -q "$tmp.d.ts" "$out" >/dev/null || { echo "frontend/src/api/schema.d.ts is stale; run scripts/gen-api-types.sh"; exit 1; }
else
  ( cd "$root/frontend" && npx openapi-typescript "$tmp" -o "$out" )
fi
