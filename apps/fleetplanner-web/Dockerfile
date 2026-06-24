# FR-P2 Phase 3 — fleetplanner-web: Vite build → nginx static assets.
# Same self-bootstrapping pattern as the other suite services.
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@9
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/fleetplanner-web/package.json apps/fleetplanner-web/
COPY packages/fleetplanner-contracts/package.json packages/fleetplanner-contracts/
# `...` pulls the shared contracts package (type-only dep — for the tsc check).
# Frozen lockfile so prod image builds are reproducible (fail on lockfile drift).
RUN pnpm install --frozen-lockfile --filter @rdoc-suite/fleetplanner-web...
COPY apps/fleetplanner-web apps/fleetplanner-web
COPY packages/fleetplanner-contracts packages/fleetplanner-contracts
# Phase 4 serves the SPA under the shadow path; assets must resolve there.
ARG BASE_PATH=/fleetplanner-next/
ENV BASE_PATH=${BASE_PATH}
RUN pnpm --filter @rdoc-suite/fleetplanner-contracts run build \
 && pnpm --filter @rdoc-suite/fleetplanner-web run build

FROM nginx:1.27-alpine
COPY apps/fleetplanner-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/fleetplanner-web/dist /usr/share/nginx/html
EXPOSE 80
