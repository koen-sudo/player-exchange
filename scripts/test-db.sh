#!/usr/bin/env bash
# Creates a throw-away database, applies all migrations in order and runs the
# constraint tests. Requires psql and a reachable PostgreSQL (docker compose up db).
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PGUSER:=px}" "${PGPASSWORD:=px}"
export PGHOST PGPORT PGUSER PGPASSWORD
DB="px_constraints_$$"

cleanup() { psql -d postgres -qc "DROP DATABASE IF EXISTS ${DB}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -d postgres -qc "CREATE DATABASE ${DB}"
for f in "$HERE"/packages/db/migrations/*.sql; do
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql -d "$DB" -v ON_ERROR_STOP=1 -qtA -f "$HERE/packages/db/test/constraints.sql" 2>&1 | sed -n "s/^.*NOTICE:  //p; /passed/p; /ERROR/p"
