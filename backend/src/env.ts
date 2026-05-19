import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),

  // Upstash Redis (REST). Optional in local dev; rate-limit and cache fall
  // back to in-memory when both are absent.
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  // Admin dashboard. Distinct signing key so a leaked consumer JWT_SECRET
  // cannot mint admin tokens. Defaults are dev-friendly but production
  // MUST set ADMIN_JWT_SECRET explicitly.
  ADMIN_JWT_SECRET: z.string().min(16).default("dev-admin-secret-please-change"),
  ADMIN_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  ADMIN_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  ADMIN_MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  // CSV of allowlisted admin emails. Until real OIDC ships (Phase 7) this
  // is the gate on who may receive an admin magic-link.
  ADMIN_ALLOWED_EMAILS: z.string().default(""),
  // Lifts the 2FA requirement for all admin routes. Defaults to `false`
  // (2FA enforced). Operators use this in local dev to skip TOTP entry
  // when iterating on dashboards. MUST be `false` in production.
  ADMIN_2FA_OPTIONAL: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Short-lived signed grant TTL for sensitive access (messages, photos
  // outside report context). PRD §16.4 references this.
  ADMIN_ACCESS_GRANT_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  // Origin allowlist for the admin dashboard. Comma-separated. The admin
  // BFF in admin/ calls this backend from a different origin.
  ADMIN_CORS_ORIGIN: z.string().default("http://localhost:3000"),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().email().default("noreply@openmatch.local"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : v === "true")),
  MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  APPLE_TEAM_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  // Ably realtime fan-out for chat. Required in production for live message
  // delivery; if absent, POST /messages still works but no push is emitted.
  ABLY_API_KEY: z.string().optional(),

  // Vercel Blob token. Required to mint client upload tokens; if absent,
  // photo uploads fall back to a local filesystem path (dev only).
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // Public base URL the API answers on. Used to build absolute links in
  // outgoing email (magic links, etc.). In production set this to the
  // Vercel/Custom domain, e.g. https://api.openmatch.app.
  APP_BASE_URL: z.string().url().default("http://localhost:8080"),
  ALLOW_DEV_LOGIN: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // When dev login is enabled, this flag controls whether dev sign-ins
  // bypass the invite-required gate. Default true so the screenshot
  // scripts and integration suite keep working with `invite_required`
  // on.
  DEV_LOGIN_BYPASSES_INVITE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  // Bearer token gating the /api/v1/internal/* endpoints (deletion
  // purge, DSA SLA check, future cron-style workers). MUST be set in
  // production. Vercel cron requests include `Authorization: Bearer
  // <CRON_SECRET>` so the cron secret value can be reused here, but
  // we keep a distinct env var so the cron secret can be rotated
  // independently and so non-Vercel invocations (manual ops cron, k8s
  // CronJob, etc.) work with the same scheme.
  INTERNAL_WORKER_TOKEN: z
    .string()
    .min(32)
    .default("dev-internal-worker-token-please-change-32-chars"),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
