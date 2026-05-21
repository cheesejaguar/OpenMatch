import { z } from "zod";

// Hard-coded sentinels that must NEVER be the live value in any deployed
// environment. They exist only as test/dev fallbacks (we inject them in
// the test bootstrap, see backend/test/helpers/db.ts). Boot fails loudly
// if any of them slips into a non-test env.
const FORBIDDEN_ADMIN_JWT_SECRET = "dev-admin-secret-please-change";
const FORBIDDEN_INTERNAL_WORKER_TOKEN = "dev-internal-worker-token-please-change-32-chars";

function refuseDefaultInProduction(forbidden: string, label: string) {
  return (value: string) => {
    if (value === forbidden && process.env.NODE_ENV !== "test") {
      throw new Error(
        `${label} is using the documented placeholder value. ` +
          `Generate a real secret (>=32 bytes of random data) and set ${label} in your environment.`,
      );
    }
    return true;
  };
}

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

  // Min length 32 forces ≥256 bits of entropy. Symmetric HS256 secrets at
  // this size are well above any practical brute-force threshold.
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  // PERF-TELEMETRY: queries running longer than this threshold are
  // logged at WARN via Pino with the parameterised SQL (values redacted).
  // Default 200ms — Neon round-trip is typically 5-30ms.
  SLOW_QUERY_LOG_THRESHOLD_MS: z.coerce.number().int().positive().default(200),

  // Admin dashboard. Distinct signing key so a leaked consumer JWT_SECRET
  // cannot mint admin tokens. Required in all non-test environments —
  // we deliberately removed the dev fallback because preview deploys
  // running on Vercel with NODE_ENV=preview would otherwise mint admin
  // tokens with a publicly-known string. The `test` bootstrap explicitly
  // sets a long random value.
  ADMIN_JWT_SECRET: z
    .string()
    .min(32)
    .refine((v) => v !== FORBIDDEN_ADMIN_JWT_SECRET, {
      message: "ADMIN_JWT_SECRET must not be the documented placeholder value",
    })
    .superRefine((v, ctx) => {
      try {
        refuseDefaultInProduction(FORBIDDEN_ADMIN_JWT_SECRET, "ADMIN_JWT_SECRET")(v);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
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
  // SEV-M5: when `true`, /api/v1/auth/start with method=apple REQUIRES a
  // per-request unhashed nonce in the request body and rejects identity
  // tokens whose `nonce` claim does not equal SHA-256(nonce). Defaults to
  // false for one release cycle so the iOS-side change can ship first;
  // flip to true once the iOS coordinator generating the nonce is rolled
  // out to all clients.
  APPLE_NONCE_REQUIRED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

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
    .refine((v) => v !== FORBIDDEN_INTERNAL_WORKER_TOKEN, {
      message: "INTERNAL_WORKER_TOKEN must not be the documented placeholder value",
    })
    .superRefine((v, ctx) => {
      try {
        refuseDefaultInProduction(FORBIDDEN_INTERNAL_WORKER_TOKEN, "INTERNAL_WORKER_TOKEN")(v);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),

  // TOTP envelope-encryption KEK. 32-byte symmetric key (hex or base64)
  // used by `lib/crypto/totp-encryption.ts` to AES-256-GCM the stored
  // `AdminUser.totpSecret` plaintext. Optional in dev/test to keep the
  // local loop simple; when absent we store plaintext (legacy behaviour)
  // and surface a startup warning. Production MUST set this.
  ADMIN_TOTP_KEK: z.string().min(32).optional(),
  // Salt for identity-hash HMAC. When set, `hashIdentity` uses
  // HMAC-SHA256(salt, value) instead of plain SHA-256 so a leaked
  // emailHash can no longer be confirmed against a candidate email
  // without also knowing the salt.
  IDENTITY_HASH_SECRET: z.string().min(32).optional(),

  // APNs delivery (OPS-1). When APNS_TEAM_ID is empty the push worker
  // logs a warning at startup but is otherwise a no-op (dev / CI safe).
  // When all four are present, real APNs is wired via @parse/node-apn.
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  // Base64-encoded contents of the .p8 private key file from App Store
  // Connect. We base64-encode in env so newlines round-trip cleanly.
  APNS_PRIVATE_KEY: z.string().optional(),
  // Bundle id of the iOS app, e.g. "app.openmatch.ios".
  APNS_TOPIC: z.string().optional(),
  APNS_PRODUCTION: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Sentry (OPS-3). When SENTRY_DSN is absent, Sentry is not initialised.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),

  // On-call alerter (MON-2). Posts a JSON `{ text }` payload to the
  // configured Slack incoming webhook when an alert condition fires.
  SLACK_WEBHOOK_URL: z.string().url().optional(),

  // PLATFORM-PLUGIN — extension-point selectors.
  //
  // Each variable picks which implementation of a platform-plugin
  // interface the backend uses at boot. The defaults preserve the
  // pre-plugin behaviour:
  //   - RANKING_PROVIDER=builtin  → @openmatch/matching's rules engine.
  //   - MODERATION_PROVIDER=noop  → photos / messages enter `clean`,
  //     no automated scan.
  //   - BILLING_PROVIDER=noop     → every receipt is rejected;
  //     everyone is free-tier.
  //
  // Unknown values are tolerated (we fall back to the default rather
  // than crashing boot) so an operator setting an env var ahead of the
  // fork code that registers the provider does not brick the deploy.
  RANKING_PROVIDER: z.string().default("builtin"),
  MODERATION_PROVIDER: z.string().default("noop"),
  BILLING_PROVIDER: z.string().default("noop"),
});

// In `NODE_ENV=test` we inject ephemeral random secrets so the existing
// test suite doesn't need to plumb every secret env var through its
// fixtures. These values are NEVER reachable in development or
// production — the test bootstrap process is single-process and uses
// `process.env.NODE_ENV === "test"`.
//
// When running the test suite outside CI (e.g. a developer pushing to a
// branch worktree) the developer can still override any of these by
// setting the env var explicitly before invoking vitest.
function testEnvDefaults(): NodeJS.ProcessEnv {
  if (process.env.NODE_ENV !== "test") return process.env;
  return {
    ...process.env,
    JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret-32-bytes-min-padding-bytes-here",
    ADMIN_JWT_SECRET:
      process.env.ADMIN_JWT_SECRET ?? "test-admin-jwt-secret-32-bytes-min-padding-bytes-here",
    INTERNAL_WORKER_TOKEN:
      process.env.INTERNAL_WORKER_TOKEN ?? "test-internal-worker-token-32-bytes-min-padding-here",
  };
}

// SEV-N22 / SEV-A8: refuse to accept `ALLOW_DEV_LOGIN=true` when
// running in `NODE_ENV=production`. The dev-login endpoint mints a
// session for any user id without an authentication factor — gated to
// development as a developer-loop convenience. A typo in a production
// env var must fail loud at boot, never silently widen the auth
// surface. The server.ts boot path adds a console.warn when the
// development+ALLOW_DEV_LOGIN combination is active so the bypass is
// audible in deployment logs.
const refinedSchema = schema.superRefine((cfg, ctx) => {
  if (cfg.NODE_ENV === "production" && cfg.ALLOW_DEV_LOGIN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ALLOW_DEV_LOGIN=true is forbidden in NODE_ENV=production",
      path: ["ALLOW_DEV_LOGIN"],
    });
  }
});

export const env = refinedSchema.parse(testEnvDefaults());
export type Env = typeof env;
