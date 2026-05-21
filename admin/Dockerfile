# syntax=docker/dockerfile:1.7

# Admin dashboard production image for OpenMatch.
#
# Uses Next.js's `output: "standalone"` (see admin/next.config.ts) so
# we ship only the .next/standalone server + the static asset bundle.
# Build context is the repo root.

# ---- 1. deps ---------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json tsconfig.base.json ./
COPY matching/package.json ./matching/
COPY backend/package.json ./backend/
COPY admin/package.json ./admin/

# Skip backend/postinstall (prisma generate) — admin doesn't need it.
RUN npm ci --ignore-scripts --workspaces --include-workspace-root

# ---- 2. build --------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/admin/node_modules ./admin/node_modules

COPY package.json package-lock.json tsconfig.base.json ./
COPY admin ./admin

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @openmatch/admin

# ---- 3. runtime ------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache libc6-compat tini \
    && addgroup -S openmatch && adduser -S openmatch -G openmatch

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# .next/standalone contains a server.js entry point with its own
# minimal node_modules tree. static/ + public/ have to be copied in
# alongside it.
COPY --from=build /app/admin/.next/standalone ./
COPY --from=build /app/admin/.next/static ./admin/.next/static
COPY --from=build /app/admin/public ./admin/public

USER openmatch
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "admin/server.js"]
