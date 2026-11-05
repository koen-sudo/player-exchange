#!/usr/bin/env bash
# Applies SQL migrations in order to $DATABASE_URL, recording applied files.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for f in "$HERE"/packages/db/migrations/*.sql; do
  name="$(basename "$f")"
  applied="$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name'")"
  if [[ "$applied" == "1" ]]; then
    echo "skip  $name"
    continue
  fi
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO schema_migrations(filename) VALUES ('$name')"
  echo "apply $name"
done
