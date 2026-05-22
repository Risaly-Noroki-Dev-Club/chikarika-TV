#!/usr/bin/env bash
set -euo pipefail

ROOTFS="${ROOTFS:-/opt/watchroom-rootfs}"
APP_DIR="${APP_DIR:-/srv/watchroom}"
RURI_BIN="${RURI_BIN:-ruri}"
COMMAND="${COMMAND:-pnpm start:server}"

if ! command -v "${RURI_BIN}" >/dev/null 2>&1; then
  echo "ruri not found. Install it from https://github.com/RuriOSS/ruri/releases or run: . <(curl -sL https://get.ruri.zip/ruri)"
  exit 1
fi

if [ ! -d "${ROOTFS}" ]; then
  echo "Rootfs not found: ${ROOTFS}"
  echo "Create one with rurima, debootstrap, or your preferred rootfs tool."
  exit 1
fi

if [ ! -d "${APP_DIR}" ]; then
  echo "App dir not found: ${APP_DIR}"
  exit 1
fi

sudo "${RURI_BIN}" \
  -u \
  -n \
  -m "${APP_DIR}" /srv/watchroom \
  -W /srv/watchroom \
  "${ROOTFS}" \
  /bin/sh -lc "${COMMAND}"
