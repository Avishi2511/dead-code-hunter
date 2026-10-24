#!/usr/bin/env sh
# Vercel's Python runtime installs ./requirements.txt; keep it in sync with backend/uv.lock.
set -eu
cd "$(dirname "$0")/../backend"
uv export --no-dev --extra api --no-emit-project --no-hashes --frozen -o ../requirements.txt
