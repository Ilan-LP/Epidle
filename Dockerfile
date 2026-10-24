# syntax=docker/dockerfile:1
# Base images are pinned by digest (the tag is for humans); Dependabot proposes updates.
# Two images from one build: `server` (Node, the game API) and `web` (Caddy: static web client,
# HTTPS, reverse proxy to the server). docker-compose.yml builds and runs both.

FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
# No compiler needed: better-sqlite3 ships prebuilt binaries for x64 and arm64.
RUN corepack enable
WORKDIR /repo
# Manifests first: the dependency layer is reused until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/sim/package.json packages/sim/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui-theme/package.json packages/ui-theme/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @epidle/server build && pnpm --filter @epidle/web build
# Production dependencies of the server only (fastify, better-sqlite3, jose).
RUN pnpm --filter @epidle/server deploy --prod --legacy /out \
  && cp -r apps/server/dist apps/server/modifiers.json /out/

FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS server
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  TRUST_PROXY=1 \
  DATABASE_PATH=/data/epidle.db \
  BACKUP_DIR=/backups \
  MODIFIERS_PATH=/app/modifiers.json
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Created here so new named volumes are owned by the node user.
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME ["/data", "/backups"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]

FROM caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
