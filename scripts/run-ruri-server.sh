#!/usr/bin/env bash
set -euo pipefail

COMMAND="pnpm start:server" exec "$(dirname "$0")/run-ruri.sh"
