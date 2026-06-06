# syntax=docker/dockerfile:1.7
#
# Multi-stage build for @rdoc-suite/mission-cover.
# Build from repo root: docker build -f apps/mission-cover/Dockerfile -t rdoc-suite-mission-cover .
# Or via docker-compose.prod.yml (build.context: .).
#
# Single base = the official Playwright image: it ships Node 20 + a matching
# Chromium at /ms-playwright, so the render service runs without a separate
# browser download and without glibc/musl native-module mismatch. Keep the npm
# `playwright` dependency pinned to the SAME version as this image tag.

# ─── engine build (MissionCover SPA → single-file dist/index.html) ────────────
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS engine
WORKDIR /engine
COPY apps/mission-cover/engine/package.json apps/mission-cover/engine/package-lock.json ./
RUN npm ci
COPY apps/mission-cover/engine ./
RUN npm run build   # vite build + postbuild.js → /engine/dist/index.html

# ─── service build (TypeScript → dist) ───────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS builder
ENV CI=true
# Browsers already in the base image — don't let `playwright` re-download them.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Install pnpm directly: the Playwright image's bundled corepack fails signature
# verification for pnpm ("Cannot find matching keyid") on its Node 22.12 build.
RUN npm install -g pnpm@10.33.0
WORKDIR /app

# Manifests first for layer cache.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/mission-cover/package.json apps/mission-cover/
RUN pnpm install --no-frozen-lockfile --filter @rdoc-suite/mission-cover

# Service source (engine/ excluded by tsconfig; its built dist is copied in runtime).
COPY apps/mission-cover/tsconfig.json apps/mission-cover/
COPY apps/mission-cover/src apps/mission-cover/src
RUN pnpm --filter @rdoc-suite/mission-cover run build

# Drop devDeps.
RUN pnpm install --no-frozen-lockfile --filter @rdoc-suite/mission-cover --prod

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS runtime
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/mission-cover/package.json apps/mission-cover/package.json
COPY --from=builder /app/apps/mission-cover/node_modules apps/mission-cover/node_modules
COPY --from=builder /app/apps/mission-cover/dist apps/mission-cover/dist
COPY --from=engine  /engine/dist apps/mission-cover/engine/dist

# Artifact volume mount point.
RUN mkdir -p /app/data/covers && chown -R pwuser:pwuser /app/data

# Run as the non-root user the Playwright image provides.
USER pwuser

EXPOSE 3300
CMD ["node", "apps/mission-cover/dist/index.js"]
