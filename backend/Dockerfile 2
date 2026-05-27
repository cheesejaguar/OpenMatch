# syntax=docker/dockerfile:1.7

# Backend production image for OpenMatch.
#
# Multi-stage:
#   1. deps    — install workspace deps (matching + backend) once.
#   2. build   — compile @openmatch/matching and @openmatch/backend.
#   3. runtime — slim node:24-alpine with only the artifacts needed to
#                serve traffic.
#
# Build context is the repo root (NOT backend/). The compose file sets
# `context: .` so workspaces resolve correctly.

# ---- 1. deps ---------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app

# OpenSSL is required by Prisma's query engine.
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json tsconfig.base.json ./
COPY matching/package.json ./matching/
COPY backend/package.json ./backend/
COPY backend/prisma ./backend/prisma

# Install with --ignore-scripts first so `prisma generate` (which runs
# from backend's postinstall) doesn't fire until we have the schema in
# place. Then run a focused generate.
RUN npm ci --ignore-scripts --workspaces --include-workspace-root
RUN cd backend && npx prisma generate

# ---- 2. build --------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/matching/node_modules ./matching/node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules

COPY package.json package-lock.json tsconfig.base.json ./
COPY matching ./matching
COPY backend ./backend

# Build @openmatch/matching first — backend depends on its compiled
# output via the workspace symlink.
RUN npm run build -w @openmatch/matching
RUN npm run build -w @openmatch/backend

# ---- 3. runtime ------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat tini \
    && addgroup -S openmatch && adduser -S openmatch -G openmatch

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# Copy production node_modules + compiled output. The workspace symlink
# from backend/node_modules/@openmatch/matching → matching/ is preserved.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/matching/dist ./matching/dist
COPY --from=build /app/matching/package.json ./matching/package.json
COPY --from=build /app/matching/algorithm_config.json ./matching/algorithm_config.json
COPY --from=build /app/matching/node_modules ./matching/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/package.json ./package.json

USER openmatch

EXPOSE 8080

# tini reaps zombies and forwards signals so SIGTERM from
# `docker stop` reaches the Node process and triggers a clean
# shutdown.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/dist/src/server.js"]
