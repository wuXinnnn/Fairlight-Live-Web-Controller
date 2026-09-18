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

# A .env beside this script, if there is one, is where HOST, PORT and the FLWC_* paths can be
# kept. Node reads it itself; see .env.example. A variable already set in the environment still
# wins over the file, so `PORT=3100 ./start.sh` overrides it for one run.
#
# Deliberately unquoted below: the value never contains a space, and an empty one has to expand
# to no argument at all rather than to an empty one.
env_arg=''
if [ -f .env ]; then
  env_arg='--env-file=.env'
fi

# Ask node what it will really see. The default further down must not shadow the file, and the
# address printed has to be the one it will actually listen on.
# shellcheck disable=SC2086
if ! probe="$(node $env_arg -e "const e=process.env,v=k=>e[k]?e[k]:'-';console.log('HOST='+v('HOST'));console.log('PORT='+v('PORT'))" 2>&1)"; then
  echo "Could not read .env: $probe" >&2
  exit 1
fi
eff_host="${probe#HOST=}"
eff_host="${eff_host%%$'\n'*}"
eff_port="${probe##*PORT=}"

# Every interface, so a tablet on the same network can reach it, unless something already said
# otherwise.
if [ "$eff_host" = '-' ]; then
  export HOST='0.0.0.0'
fi
if [ "$eff_port" = '-' ]; then
  eff_port='3000'
fi

echo "Fairlight Live Web Controller - http://localhost:${eff_port}  (Ctrl+C to stop)"
# shellcheck disable=SC2086
exec node $env_arg apps/server/dist/main.js
