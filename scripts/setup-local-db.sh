#!/usr/bin/env bash
set -euo pipefail

DB_USER="${DB_USER:-watchroom}"
DB_PASSWORD="${DB_PASSWORD:-watchroom}"
DB_NAME="${DB_NAME:-watchroom}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install PostgreSQL first: sudo apt-get install postgresql postgresql-client"
  exit 1
fi

sudo systemctl enable --now postgresql
sudo systemctl enable --now redis-server

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

echo "Local PostgreSQL/Redis ready."
echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
echo "REDIS_URL=redis://localhost:6379"
