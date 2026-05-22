#!/usr/bin/env bash
set -euo pipefail

COMMAND="PORT=${PORT:-2262} pnpm start:web" exec "$(dirname "$0")/run-ruri.sh"
