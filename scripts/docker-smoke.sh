#!/usr/bin/env bash
#
# Starts the image twice against one volume and checks what a user would notice: health answers,
# the seed reaches data/config.json on a first start, a change made through the API survives a
# restart under different environment variables, deep links reach the SPA shell, the process
# stops promptly, and the image carries neither root nor devDependencies.
#
# Runs on a CI runner and in Git Bash on Windows.
#
#   scripts/docker-smoke.sh <image>
set -euo pipefail

# Git Bash rewrites arguments that look like absolute POSIX paths into Windows paths before
# handing them to docker.exe, so `-v vol:/app/data` would arrive as `-v vol:C:/Program Files/...`.
# MSYS2 reads the first variable, the older Git for Windows runtime the second. Both are harmless
# no-ops on Linux. As a second line of defence every in-container path below is relative to the
# image's WORKDIR, so it is not a candidate for rewriting at all.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  echo "usage: scripts/docker-smoke.sh <image>" >&2
  exit 1
fi

# RFC 5737 documentation addresses. Nothing answers on them, which is the point: the server has to
# come up and serve the UI with Fairlight Live unreachable.
SEED_HOST='203.0.113.9'
SEED_PORT='9001'
PUT_HOST='203.0.113.10'
PUT_PORT='9002'
SECOND_HOST='203.0.113.11'
SECOND_PORT='9003'

HEALTH_TIMEOUT_S=30
HEALTH_POLL_S=0.5
# The shutdown handlers give `docker stop` no reason to reach its ten second grace period.
STOP_BUDGET_MS=5000

VOLUME="flwc-smoke-$$"
CID=''
BASE=''

cleanup() {
  if [ -n "$CID" ]; then
    docker rm -f "$CID" >/dev/null 2>&1 || true
  fi
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "smoke: FAIL: $*" >&2
  if [ -n "$CID" ]; then
    echo 'smoke: container logs:' >&2
    docker logs "$CID" 2>&1 | sed 's/^/smoke:   /' >&2 || true
  fi
  exit 1
}

# `date +%s` is one second wide, too coarse for a five second budget, and `date +%N` differs
# between GNU and BSD. EPOCHREALTIME is a bash 5 builtin present in Git Bash and on the runners;
# the decimal separator is the locale's, hence the character class.
now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local micros="${EPOCHREALTIME/[.,]/}"
    echo $((micros / 1000))
  else
    echo $(($(date +%s) * 1000))
  fi
}

# A random loopback port: it cannot collide with a development server on 3000, it is not on the
# network, and it raises no Windows firewall prompt.
run_container() {
  CID="$(docker run -d \
    -e "EMBER_HOST=$1" -e "EMBER_PORT=$2" \
    -p 127.0.0.1::3000 \
    -v "$VOLUME:/app/data" \
    "$IMAGE")"
  local mapped
  mapped="$(docker port "$CID" 3000/tcp | head -n 1)"
  BASE="http://127.0.0.1:${mapped##*:}"
}

# Polled from the host rather than through `docker inspect .State.Health`: it proves the published
# port a user actually reaches, and it does not have to wait out the healthcheck's interval.
wait_for_health() {
  local deadline
  deadline=$(($(now_ms) + HEALTH_TIMEOUT_S * 1000))
  while [ "$(now_ms)" -lt "$deadline" ]; do
    if curl -fsS "$BASE/api/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$HEALTH_POLL_S"
  done
  fail "no answer from $BASE/api/v1/health within ${HEALTH_TIMEOUT_S}s"
}

# jq is not in Git Bash, so these are substring matches against Fastify's space-free JSON output.
expect_body() {
  local body
  body="$(curl -fsS "$1")" || fail "GET $1 failed"
  printf '%s' "$body" | grep -Fq -- "$2" || fail "GET $1: expected '$2', got: $body"
}

echo "smoke: image $IMAGE"
docker volume create "$VOLUME" >/dev/null

echo "smoke: first start, seeded with $SEED_HOST:$SEED_PORT"
run_container "$SEED_HOST" "$SEED_PORT"
wait_for_health
expect_body "$BASE/api/v1/connection" "\"host\":\"$SEED_HOST\""
expect_body "$BASE/api/v1/connection" "\"port\":$SEED_PORT"

echo 'smoke: the SPA shell answers at / and at a deep link'
expect_body "$BASE/" '<div id="root">'
expect_body "$BASE/views" '<div id="root">'

echo 'smoke: not root, and no devDependencies'
uid="$(docker exec "$CID" id -u)"
[ "$uid" != '0' ] || fail 'the container runs as root'
# `grep -c` prints its 0 and then exits 1, which `set -e` would take for an error; the `|| true`
# sits outside the `sh -c` string so the count is already on stdout by then. The anchor matters:
# .pnpm directory names are name@version, so a bare `typescript` would also match
# typescript-eslint@8... and make a clean image look dirty.
dev_count="$(docker exec "$CID" sh -c 'ls node_modules/.pnpm | grep -c "^typescript@"' || true)"
[ "$dev_count" = '0' ] || fail "devDependencies in the image: $dev_count typescript entries"

echo "smoke: moving the endpoint to $PUT_HOST:$PUT_PORT the way the CONNECTION panel does"
curl -fsS -X PUT -H 'content-type: application/json' \
  -d "{\"host\":\"$PUT_HOST\",\"port\":$PUT_PORT}" \
  "$BASE/api/v1/connection" >/dev/null || fail 'PUT /api/v1/connection failed'
expect_body "$BASE/api/v1/connection" "\"host\":\"$PUT_HOST\""

echo 'smoke: stopping'
started="$(now_ms)"
docker stop -t 10 "$CID" >/dev/null
elapsed=$(($(now_ms) - started))
echo "smoke: docker stop took ${elapsed}ms"
[ "$elapsed" -le "$STOP_BUDGET_MS" ] ||
  fail "docker stop took ${elapsed}ms, over the ${STOP_BUDGET_MS}ms budget"
docker rm -f "$CID" >/dev/null
CID=''

echo "smoke: second start on the same volume, seeded with $SECOND_HOST:$SECOND_PORT"
run_container "$SECOND_HOST" "$SECOND_PORT"
wait_for_health
# The file was written on the first start, so the new seed has nothing to say.
expect_body "$BASE/api/v1/connection" "\"host\":\"$PUT_HOST\""
expect_body "$BASE/api/v1/connection" "\"port\":$PUT_PORT"

echo 'smoke: PASS'
