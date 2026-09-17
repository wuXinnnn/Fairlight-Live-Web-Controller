#!/usr/bin/env bash
#
# Starts the Fairlight Live Web Controller in the foreground.
#
# It only starts: it does not install, build or configure anything. If something is missing it
# says which command to run and stops. The Windows counterpart is start.cmd; keep the two in step.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required, and node was not found on PATH." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo "Node.js 22 or newer is required, found $(node --version)." >&2
  exit 1
fi

if [ ! -f apps/server/dist/main.js ] || [ ! -f apps/web/dist/index.html ]; then
  echo 'Run "pnpm install" and "pnpm build" first.' >&2
  exit 1
fi

# Every interface, so a tablet on the same network can reach it. Both stay overridable.
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"

echo "Fairlight Live Web Controller - http://localhost:${PORT}  (Ctrl+C to stop)"
exec node apps/server/dist/main.js
