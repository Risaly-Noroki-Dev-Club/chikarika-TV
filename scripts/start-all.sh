#!/usr/bin/env bash
set -euo pipefail

SERVER_PID=""
WEB_PID=""

shutdown() {
  if [ -n "${SERVER_PID}" ] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
  if [ -n "${WEB_PID}" ] && kill -0 "${WEB_PID}" >/dev/null 2>&1; then
    kill "${WEB_PID}" >/dev/null 2>&1 || true
  fi
  wait >/dev/null 2>&1 || true
}

trap shutdown INT TERM EXIT

pnpm start:server &
SERVER_PID="$!"

PORT="${PORT:-2262}" pnpm start:web &
WEB_PID="$!"

set +e
wait -n "${SERVER_PID}" "${WEB_PID}"
exit_code="$?"
set -e
shutdown
exit "${exit_code}"
