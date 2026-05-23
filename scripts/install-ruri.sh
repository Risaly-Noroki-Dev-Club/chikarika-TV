#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Risaly-Noroki-Dev-Club/chikarika-TV.git}"
APP_DIR="${APP_DIR:-/srv/watchroom}"
ROOTFS="${ROOTFS:-/opt/watchroom-rootfs}"
BRANCH="${BRANCH:-main}"
DB_USER="${DB_USER:-watchroom}"
DB_PASSWORD="${DB_PASSWORD:-watchroom}"
DB_NAME="${DB_NAME:-watchroom}"

if [ "${EUID}" -ne 0 ]; then
  echo "Run as root, for example: curl -fsSL <url> | sudo bash"
  exit 1
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    return 1
  fi
}

apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y "$@"
}

node_major() {
  if command -v node >/dev/null 2>&1; then
    node -v | sed -E 's/^v([0-9]+).*/\1/'
  else
    echo 0
  fi
}

install_node_22() {
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt_install nodejs
}

if need_cmd apt-get; then
  apt_install git curl ca-certificates openssl sudo postgresql postgresql-client redis-server nodejs npm
else
  echo "This installer currently supports apt-based systems. Install dependencies manually and use scripts/run-ruri-app.sh."
  exit 1
fi

if [ "$(node_major)" -lt 20 ]; then
  install_node_22
fi

if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm
fi

if ! command -v ruri >/dev/null 2>&1; then
  sh -c "$(curl -fsSL https://get.ruri.zip/ruri)"
fi

systemctl enable --now postgresql redis-server

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

if [ ! -d "${APP_DIR}/.git" ]; then
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
fi

cd "${APP_DIR}"

if [ ! -f .env ]; then
  cp .env.example .env
fi

if grep -q '^SESSION_SECRET=change-me-in-production-use-random-64-chars$' .env; then
  session_secret="$(openssl rand -hex 32)"
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${session_secret}/" .env
fi

if grep -q '^ENCRYPTION_KEY=change-me-in-production-use-random-32-bytes-hex$' .env; then
  encryption_key="$(openssl rand -hex 32)"
  sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${encryption_key}/" .env
fi

if ! grep -q '^DATABASE_URL=' .env; then
  printf '\nDATABASE_URL=postgresql://%s:%s@localhost:5432/%s\n' "${DB_USER}" "${DB_PASSWORD}" "${DB_NAME}" >> .env
fi

if ! grep -q '^REDIS_URL=' .env; then
  printf 'REDIS_URL=redis://localhost:6379\n' >> .env
fi

pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build

if [ ! -d "${ROOTFS}" ]; then
  mkdir -p "${ROOTFS}"
  if command -v debootstrap >/dev/null 2>&1; then
    debootstrap --variant=minbase stable "${ROOTFS}" http://deb.debian.org/debian
  else
    apt_install debootstrap
    debootstrap --variant=minbase stable "${ROOTFS}" http://deb.debian.org/debian
  fi
fi

cp /etc/resolv.conf "${ROOTFS}/etc/resolv.conf"
chroot "${ROOTFS}" /bin/sh -lc "apt-get update && apt-get install -y curl ca-certificates nodejs npm"
if [ "$(chroot "${ROOTFS}" /bin/sh -lc "node -v | sed -E 's/^v([0-9]+).*/\\1/'" 2>/dev/null || echo 0)" -lt 20 ]; then
  chroot "${ROOTFS}" /bin/sh -lc "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
fi
chroot "${ROOTFS}" /bin/sh -lc "npm install -g pnpm"

cp deploy/ruri/watchroom-ruri.service /etc/systemd/system/watchroom-ruri.service
systemctl daemon-reload
systemctl enable --now watchroom-ruri.service

echo "chikarika-TV installed."
echo "Web: http://localhost:2262"
echo "API: http://localhost:2261/api/health"
