#!/usr/bin/env bash
# Start a service of the online demo.
#   web:    apply migrations, seed the demo data once (empty database), serve.
#   worker: wait until the web service has migrated, then run the jobs.
# Both refuse to start on an invalid configuration (packages/integrations/src/env-check.ts).
set -euo pipefail
cd "$(dirname "$0")/.."
role="${1:-web}"
: "${DATABASE_URL:?DATABASE_URL is required}"

node packages/integrations/src/env-check.ts

case "$role" in
  web)
    bash scripts/migrate.sh
    seeded="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM users" 2>/dev/null || echo 0)"
    if [[ "$seeded" == "0" ]]; then
      if [[ "${APP_MODE:-}" != "demo" ]]; then
        echo "Lege database buiten demo-modus: er wordt niets geseed." >&2
      else
        echo "Lege database: demogegevens laden."
        node packages/demo/src/seed-sql.ts | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q
      fi
    fi
    cd apps/web
    exec ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
    ;;
  worker)
    expected="$(ls packages/db/migrations/*.sql | wc -l)"
    for i in $(seq 1 60); do
      applied="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo 0)"
      [[ "$applied" -ge "$expected" ]] && break
      echo "Wachten op migraties ($applied/$expected)..."
      sleep 5
    done
    exec node apps/worker/src/main.ts
    ;;
  *)
    echo "Onbekende rol: $role (web of worker)" >&2
    exit 2
    ;;
esac
