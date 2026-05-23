#!/usr/bin/env bash
set -euo pipefail

COMMAND="./scripts/start-all.sh" exec "$(dirname "$0")/run-ruri.sh"
