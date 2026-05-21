# Self-hosting OpenMatch

OpenMatch is designed to be self-hosted. The repo ships a Docker
Compose topology and a `Makefile` that bring up the entire stack —
Postgres + PostGIS, Redis, MailHog, the Fastify backend, and the
Next.js admin dashboard — with a single command.

This document covers:

1. [Prerequisites](#prerequisites)
2. [Quickstart](#quickstart)
3. [Topology](#topology)
4. [Environment variables](#environment-variables)
5. [Pointing the iOS simulator at your backend](#pointing-the-ios-simulator-at-your-backend)
6. [Going to production](#going-to-production)
7. [Upgrading](#upgrading)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

- **Docker** with Compose v2 (`docker compose version` should report ≥ 2.20).
- **GNU make** (preinstalled on macOS, `apt install make` on Debian/Ubuntu).
- **8 GB RAM** free for the full stack (Postgres + Redis + two Node services + MailHog).
- (Optional) **Node 20+** if you also want to run the JS workspaces without Docker for development.

## Quickstart

```bash
git clone https://github.com/cheesejaguar/openmatch.git
cd openmatch
make up
```

That's it. `make up` builds the backend and admin images, brings up
the data services and waits for the backend health-check, then runs
`prisma migrate deploy` and seeds the database. When it finishes:

- **Backend API:** http://localhost:8080 (interactive docs at `/docs`)
- **Admin dashboard:** http://localhost:3000
- **MailHog UI:** http://localhost:8025 (captures outbound magic-link email)
- **Postgres:** `postgresql://openmatch:openmatch@localhost:5432/openmatch`
- **Redis:** `redis://localhost:6379`

Tear it all down (including the volume) with `make down`.

## Topology

```
                              ┌──────────────┐
                              │  iOS / web   │
                              │    client    │
                              └───────┬──────┘
                                      │  HTTPS
                          ┌───────────┴────────────┐
                          │       backend          │
                          │  Fastify on :8080      │
                          └──┬──────┬───────┬──────┘
                             │      │       │
                ┌────────────┘      │       └────────────┐
                ▼                   ▼                    ▼
        ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
        │   postgres     │  │     redis      │  │    mailhog     │
        │  + PostGIS     │  │  rate limits   │  │  dev SMTP UI   │
        └────────────────┘  └────────────────┘  └────────────────┘

                              ┌──────────────┐
                              │   admin      │
                              │  Next.js     │
                              │  on :3000    │
                              └───────┬──────┘
                                      │  ADMIN_API_BASE_URL
                                      ▼
                                  backend:8080
```

The compose file declares two profiles:

- **default** — `postgres`, `redis`, `mailhog`. Always started. Useful if you want to run the Node services from your terminal (`npm run dev -w @openmatch/backend`).
- **`full`** — adds the `backend` and `admin` containers. Used by `make up`.

If you'd rather run Node locally and Docker only for the data layer:

```bash
make up-services    # postgres + redis + mailhog only
make dev            # backend + admin concurrently on the host
```

## Environment variables

`docker-compose.yml` provides sane dev defaults for every required
variable. Override them by exporting before `make up`, or — better —
by creating a `.env` at the repo root (Compose picks it up
automatically):

```bash
cp backend/.env.example .env  # use as a starting point
```

The full schema lives in [`backend/src/env.ts`](../backend/src/env.ts)
(Zod). The variables an operator must change before exposing the
backend to the public internet:

| Variable | Why it matters |
|---|---|
| `JWT_SECRET` | Signs consumer access tokens. ≥32 bytes. Generate with `openssl rand -hex 32`. |
| `ADMIN_JWT_SECRET` | Signs admin BFF sessions. ≥32 bytes. **Must differ** from `JWT_SECRET`. |
| `INTERNAL_WORKER_TOKEN` | Bearer for internal cron / worker routes (`/api/v1/internal/*`). |
| `ADMIN_SESSION_SECRET` | Encrypts admin cookies. ≥32 bytes. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` | Real SMTP for magic-link delivery (Resend, Postmark, Mailgun, ...). |
| `DATABASE_URL` | Production Postgres. PostGIS extension is required. |
| `REDIS_URL` or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Rate-limit + cache store. Without these, the limiter falls back to in-memory (process-local). |
| `APP_BASE_URL` | Used to build the magic-link URL in outbound email. |
| `CORS_ORIGIN` | Comma-separated origins allowed to call the API. |
| `APPLE_TEAM_ID`, `APPLE_CLIENT_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Only if you enable Sign-in with Apple. |
| `ABLY_API_KEY` | Realtime chat. Without it, the publish step becomes a no-op. |
| `BLOB_READ_WRITE_TOKEN` | Photo storage on Vercel Blob. Without it, photos fall back to local filesystem (dev only). |
| `ALLOW_DEV_LOGIN` | **Must be `false` in production.** Backdoor test login otherwise. |

> **Secret length.** The Zod schema in `backend/src/env.ts` rejects
> any `*_SECRET` / `*_TOKEN` / `*_KEK` shorter than 32 bytes. The dev
> defaults in `docker-compose.yml` satisfy that minimum but are
> public — rotate them before exposing the service.

After editing `.env`, restart the affected services:

```bash
docker compose restart backend admin
```

## Pointing the iOS simulator at your backend

The iOS app reads its API base URL from `OMAPIBaseURL` in
[`ios/OpenMatch/Resources/Info.plist`](../ios/OpenMatch/Resources/Info.plist).
For local self-host:

```xml
<key>OMAPIBaseURL</key>
<string>http://localhost:8080</string>
```

On a real device on the same Wi-Fi, replace `localhost` with your
host machine's LAN IP (e.g. `http://192.168.1.42:8080`). Then:

```bash
cd ios && make generate && open OpenMatch.xcodeproj
```

> Apple Transport Security blocks plaintext HTTP on real devices by
> default. The repo's `Info.plist` already opts `localhost` and
> `*.local` out of ATS for dev convenience; LAN IPs require a manual
> exception. See [`ios/OpenMatch/Resources/Info.plist`](../ios/OpenMatch/Resources/Info.plist).

## Going to production

The compose topology is a great fit for small forks, but for a
production deployment you should:

1. **Move Postgres off the compose volume.** Run a managed Postgres (Neon, Supabase, RDS) with backups + point-in-time-recovery. Enable PostGIS: `CREATE EXTENSION postgis;`.
2. **Use a managed Redis** (Upstash REST is what upstream Vercel deploys use). The compose-bundled Redis loses state on `make down -v`.
3. **Replace MailHog with a real provider** (Resend, Postmark, Mailgun). Update `SMTP_*`.
4. **Terminate TLS at a reverse proxy** (Caddy, nginx, Traefik). Never expose the backend port directly.
5. **Set every secret to a 32-byte random value** and store them outside the repo (Docker secrets, Vault, AWS Secrets Manager, ...).
6. **Disable dev login** — `ALLOW_DEV_LOGIN=false`.
7. **Pin image digests** rather than `latest` if you bake your own images.
8. **Run migrations once per release**, not on every container start:
   ```bash
   docker compose exec -T backend npx prisma migrate deploy
   ```
   Or use a one-shot job in your orchestrator.

If you'd rather use Vercel (the upstream production path), see
[`README.md`](../README.md#deploying-to-vercel).

## Upgrading

```bash
git pull
make down            # drops volumes — back up first if you care about data
make up
```

For a non-destructive upgrade that keeps your data:

```bash
git pull
docker compose --profile full pull       # if you publish your own images
docker compose --profile full build      # otherwise rebuild
docker compose --profile full up -d
docker compose exec -T backend npx prisma migrate deploy
```

Check [`backend/prisma/migrations`](../backend/prisma/migrations) for
schema changes between releases. Algorithm-config bumps follow
[`docs/algorithm/versioning.md`](algorithm/versioning.md) and are
backwards-compatible by policy.

## Troubleshooting

**Backend won't start; logs say "Invalid environment".**
The Zod schema rejected your config. The log line names the failing
field. Most commonly: a `*_SECRET` shorter than 32 bytes, or
`DATABASE_URL` pointing at a host the backend can't reach (use the
Compose hostname `postgres`, not `localhost`, when running inside
the container).

**Migrations fail with `extension "postgis" is not available`.**
You're not on the PostGIS image. Use `postgis/postgis:16-3.4`
(the compose default) or run `CREATE EXTENSION postgis;` against your
managed Postgres.

**Magic-link email never arrives.**
In the default dev topology it's captured by MailHog at
http://localhost:8025. If you've pointed `SMTP_*` at a real provider,
check its dashboard — the most common cause is an unverified sender
domain.

**iOS simulator can't reach `http://localhost:8080`.**
The iOS simulator shares the host's loopback, so `localhost` should
work. If you're on a physical device, use the host's LAN IP and grant
an ATS exception in `Info.plist`.

**`make seed` says "Cannot find module @openmatch/backend".**
The `backend` container hasn't finished its first build yet. Wait for
`make up` to report "backend: healthy", or run
`docker compose logs backend` to inspect progress.

**Realtime chat doesn't deliver.**
`ABLY_API_KEY` isn't set. Without it, the publish step is a no-op
(messages are still persisted to Postgres, just not pushed). Get a
free dev key from https://ably.com if you want the live path.
