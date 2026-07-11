#!/usr/bin/env bash
set -euo pipefail

if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -ti tcp:3000 || true)"
  if [[ -n "${pids}" ]]; then
    kill -9 ${pids} >/dev/null 2>&1 || true
  fi
fi

rm -rf .next
exec ./node_modules/.bin/next dev --port 3000
