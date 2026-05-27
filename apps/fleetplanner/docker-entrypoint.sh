#!/bin/sh
set -e

cd /app

# Apply pending Prisma migrations (no-op when DB is current).
echo "[entrypoint] Running prisma migrate deploy..."
node apps/fleetplanner/node_modules/prisma/build/index.js migrate deploy \
  --schema apps/fleetplanner/prisma/schema.prisma

echo "[entrypoint] Starting fleetplanner..."
exec "$@"
