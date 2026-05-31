# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the @rdoc-suite/bridge service. Built from the repo root:
#   docker build -f apps/bridge/Dockerfile -t dccc-bridge .
# or via docker-compose.prod.yml (build.context: .).
#
# The build runs entirely in the container — the host needs nothing but Docker.

# ─── builder ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Prisma engines need glibc compatibility on Alpine.
RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Tells pnpm it's a non-interactive environment so it will purge dev deps
# during `pnpm install --prod` without prompting for confirmation.
ENV CI=true

WORKDIR /app

# Manifests first — maximises Docker layer cache hits for installs.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY prisma ./prisma
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/bridge/package.json apps/bridge/

RUN pnpm install --no-frozen-lockfile --filter @rdoc-suite/bridge...

# Now the actual sources.
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/bridge apps/bridge

# Prisma client into packages/db/generated/client (see schema.prisma output).
RUN pnpm exec prisma generate

# Build workspace dependencies in dependency order.
RUN pnpm --filter @rdoc-suite/shared build \
 && pnpm --filter @rdoc-suite/db build \
 && pnpm --filter @rdoc-suite/bridge build

# Drop devDependencies for the runtime stage.
RUN pnpm install --no-frozen-lockfile --filter @rdoc-suite/bridge... --prod

# ─── runtime ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN apk add --no-cache libc6-compat openssl tini

ENV NODE_ENV=production
WORKDIR /app

# Pnpm symlinks workspace packages into ./node_modules/@rdoc-suite/*; the symlink
# targets are the actual packages/ dirs, so we need both the node_modules
# tree AND the packages/ + apps/bridge sources (compiled output) preserved.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json packages/shared/package.json
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=builder /app/packages/db/package.json packages/db/package.json
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/db/node_modules packages/db/node_modules
COPY --from=builder /app/packages/db/generated packages/db/generated
COPY --from=builder /app/apps/bridge/package.json apps/bridge/package.json
COPY --from=builder /app/apps/bridge/node_modules apps/bridge/node_modules
COPY --from=builder /app/apps/bridge/dist apps/bridge/dist
COPY --from=builder /app/prisma ./prisma

COPY apps/bridge/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/bridge/dist/index.js"]
