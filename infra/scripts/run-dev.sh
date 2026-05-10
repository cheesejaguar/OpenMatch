#!/usr/bin/env bash
set -euo pipefail

# One-command local bootstrap.
# 1. Brings up docker-compose services.
# 2. Installs deps if needed.
# 3. Migrates and seeds the database.
# 4. Starts the API.

cd "$(dirname "$0")/../.."

docker compose up -d
echo "Waiting for Postgres…"
until docker compose exec -T postgres pg_isready -U openmatch -d openmatch >/dev/null 2>&1; do
  sleep 1
done

if [ ! -d node_modules ]; then
  npm install
fi

npm run build -w @openmatch/matching
( cd backend && npx prisma migrate deploy )
( cd backend && npm run seed )

npm run dev -w @openmatch/backend
