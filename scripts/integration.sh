#!/bin/sh
# Runs the *.itest.ts suites against a throwaway Kuma 2.x and Postgres, then removes them.
set -eu
cd "$(dirname "$0")/.."

compose() {
  docker compose -f compose.integration.yml "$@"
}

trap 'compose down --volumes >/dev/null 2>&1' EXIT
compose up --detach --wait --quiet-pull

KUMA_IT_URL="http://$(compose port kuma 3001)"
PG_IT_URL="postgres://dokploy:integration@$(compose port postgres 5432)/dokploy"
export KUMA_IT_URL PG_IT_URL

# One suite at a time: they share the same Kuma and database.
node --import tsx --test --test-concurrency=1 "src/**/*.itest.ts"
