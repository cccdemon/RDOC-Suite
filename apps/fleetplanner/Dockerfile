# syntax=docker/dockerfile:1.7
#
# Multi-stage build for @rdoc-suite/fleetplanner.
# Build from repo root: docker build -f apps/fleetplanner/Dockerfile -t rdoc-suite-fleetplanner .
# Or via docker-compose.prod.yml (build.context: .).

# ─── builder ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

ENV CI=true

WORKDIR /app

# Manifests first — maximises layer cache for install step.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/fleetplanner/package.json apps/fleetplanner/
COPY packages/fleetplanner-contracts/package.json packages/fleetplanner-contracts/

# `...` pulls workspace dependencies (the shared contracts package).
# Frozen lockfile: prod builds must be reproducible — fail loudly if pnpm-lock.yaml
# is out of sync with the manifests instead of silently resolving new versions.
RUN pnpm install --frozen-lockfile --filter @rdoc-suite/fleetplanner...

COPY apps/fleetplanner apps/fleetplanner
COPY packages/fleetplanner-contracts packages/fleetplanner-contracts

# Generate Prisma client
RUN pnpm --filter @rdoc-suite/fleetplanner exec prisma generate

# Build the shared contracts package first, then the app.
RUN pnpm --filter @rdoc-suite/fleetplanner-contracts run build \
 && pnpm --filter @rdoc-suite/fleetplanner run build

# Drop devDeps
RUN pnpm install --frozen-lockfile --filter @rdoc-suite/fleetplanner... --prod

# ─── runtime ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN apk add --no-cache libc6-compat openssl tini

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/fleetplanner/package.json apps/fleetplanner/package.json
COPY --from=builder /app/apps/fleetplanner/node_modules apps/fleetplanner/node_modules
COPY --from=builder /app/apps/fleetplanner/dist apps/fleetplanner/dist
COPY --from=builder /app/apps/fleetplanner/public apps/fleetplanner/public
COPY --from=builder /app/apps/fleetplanner/prisma apps/fleetplanner/prisma
# Workspace contracts package is symlinked into node_modules; ship its dist
# AND its node_modules (its own zod 4 lives there, resolved at runtime).
COPY --from=builder /app/packages/fleetplanner-contracts/package.json packages/fleetplanner-contracts/package.json
COPY --from=builder /app/packages/fleetplanner-contracts/dist packages/fleetplanner-contracts/dist
COPY --from=builder /app/packages/fleetplanner-contracts/node_modules packages/fleetplanner-contracts/node_modules

# Data volume mount point — keep it outside prisma/ to avoid shadowing migrations.
RUN mkdir -p /app/data

COPY apps/fleetplanner/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run as the unprivileged `node` user the base image ships (uid 1000), not root.
# The data dir is the only writable path the app touches; app code/node_modules
# stay root-owned and world-readable. The entrypoint only runs prisma migrate +
# node (no root ops) and binds port 3200 (>1024), so no privileges are needed.
RUN chown -R node:node /app/data
USER node

EXPOSE 3200
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/fleetplanner/dist/index.js"]
