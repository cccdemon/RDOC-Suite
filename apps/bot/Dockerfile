# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the @dccc/bot service. Built from the repo root:
#   docker build -f apps/bot/Dockerfile -t dccc-bot .
# or via docker-compose.prod.yml (build.context: .).
#
# Mirrors apps/bridge/Dockerfile — same workspace plumbing, no HTTP port,
# no Prisma migrate (the bridge owns migrations; the bot only reads/writes
# via the generated client).

# ─── builder ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Prisma engines need glibc compatibility on Alpine.
RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Non-interactive pnpm — required for `pnpm install --prod` to purge dev deps
# without prompting (otherwise: ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY).
ENV CI=true

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY prisma ./prisma
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/bot/package.json apps/bot/

RUN pnpm install --no-frozen-lockfile --filter @dccc/bot...

COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/bot apps/bot

RUN pnpm exec prisma generate

RUN pnpm --filter @dccc/shared build \
 && pnpm --filter @dccc/db build \
 && pnpm --filter @dccc/bot build

RUN pnpm install --no-frozen-lockfile --filter @dccc/bot... --prod

# ─── runtime ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN apk add --no-cache libc6-compat openssl tini

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json packages/shared/package.json
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=builder /app/packages/db/package.json packages/db/package.json
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/db/node_modules packages/db/node_modules
COPY --from=builder /app/packages/db/generated packages/db/generated
COPY --from=builder /app/apps/bot/package.json apps/bot/package.json
COPY --from=builder /app/apps/bot/node_modules apps/bot/node_modules
COPY --from=builder /app/apps/bot/dist apps/bot/dist
COPY --from=builder /app/prisma ./prisma

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/bot/dist/index.js"]
