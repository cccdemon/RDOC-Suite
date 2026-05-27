#!/bin/sh
set -e

# Apply pending Prisma migrations before the bridge starts. Safe to run on
# every container start: `migrate deploy` is a no-op when the DB is current.
cd /app
node apps/bridge/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma

exec "$@"
