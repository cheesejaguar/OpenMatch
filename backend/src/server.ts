import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import * as Sentry from "@sentry/node";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import pino from "pino";
import { ZodError } from "zod";
import { env } from "./env.js";
import { ErrorCodes } from "./lib/error-codes.js";
import { HttpError, httpError, zodErrorToHttp } from "./lib/http-error.js";
import { requestContext } from "./lib/request-context.js";
import { initSentry, sentryFastifyErrorHook, sentryUserHook } from "./lib/sentry.js";
import adminAuthPlugin from "./plugins/admin-auth.js";
import adminRbacPlugin from "./plugins/admin-rbac.js";
import authPlugin from "./plugins/auth.js";
import countryGatePlugin from "./plugins/country-gate.js";
import flagsPlugin from "./plugins/flags.js";
import metroGatePlugin from "./plugins/metro-gate.js";
import { openapiPlugin } from "./plugins/openapi.js";
import prismaPlugin from "./plugins/prisma.js";
import ratelimitPlugin from "./plugins/ratelimit.js";
import redisPlugin from "./plugins/redis.js";
import { adminAnalyticsRoutes } from "./routes/admin/analytics.js";
import { adminAuditRoutes } from "./routes/admin/audit.js";
import { adminAuthRoutes } from "./routes/admin/auth.js";
import { adminConversationRoutes } from "./routes/admin/conversations.js";
import { adminDsaRoutes } from "./routes/admin/dsa.js";
import { adminFeedbackRoutes } from "./routes/admin/feedback.js";
import { adminFlagsRoutes } from "./routes/admin/flags.js";
import { adminGeographyRoutes } from "./routes/admin/geography.js";
import { adminInvitesRoutes } from "./routes/admin/invites.js";
import { adminMetricsRoutes, adminSyntheticRoutes } from "./routes/admin/metrics.js";
import { adminMetrosRoutes } from "./routes/admin/metros.js";
import { adminPhotoRoutes } from "./routes/admin/photos.js";
import { adminReportRoutes } from "./routes/admin/reports.js";
import { adminRoleRoutes } from "./routes/admin/roles.js";
import { adminTotpRoutes } from "./routes/admin/totp.js";
import { adminUserRoutes } from "./routes/admin/users.js";
import { adminWaitlistRoutes } from "./routes/admin/waitlist.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { dsaRoutes } from "./routes/dsa.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { healthRoutes } from "./routes/health.js";
import { internalSyntheticRoutes } from "./routes/internal/synthetic.js";
import { internalRoutes } from "./routes/internal.js";
import { invitesRoutes } from "./routes/invites.js";
import { likesRoutes } from "./routes/likes.js";
import { matchesRoutes } from "./routes/matches.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { preferencesRoutes } from "./routes/preferences.js";
import { privacyRoutes } from "./routes/privacy.js";
import { profileRoutes } from "./routes/profile.js";
import { realtimeRoutes } from "./routes/realtime.js";
import { safetyRoutes } from "./routes/safety.js";
import { swipesRoutes } from "./routes/swipes.js";
import { transparencyRoutes } from "./routes/transparency.js";
import { waitlistRoutes } from "./routes/waitlist.js";

// OPS-3 — initialise Sentry at module load (before any route handler can
// throw). When SENTRY_DSN is absent this is a no-op.
initSentry();

// Round D — Pino mixin + redaction shared between the Fastify app logger
// and any standalone log line emitted from a worker entry point. The
// mixin reads from AsyncLocalStorage so every log line carries the
// active request id (or `worker.<label>.<uuid>` when emitted from a
// scheduled task). Redactions cover all the known PII fields we never
// want sprayed into log aggregation.
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.email",
  "req.body.inviteCode",
  "req.body.refreshToken",
  "req.body.token",
  "*.email",
  "*.emailHash",
  "*.refreshToken",
  "*.accessToken",
  "*.bio",
  "*.displayName",
];

function buildLogger() {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    mixin() {
      const ctx = requestContext.get();
      if (!ctx) return {};
      return {
        requestId: ctx.requestId,
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        ...(ctx.adminUserId ? { adminUserId: ctx.adminUserId } : {}),
      };
    },
    transport:
      env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });
}

export async function buildServer() {
  const app = Fastify({
    // We sit behind Vercel's edge in production, which always sets
    // X-Forwarded-For. Trusting it makes `req.ip` and the rate-limit
    // plugin reflect the upstream client IP rather than the proxy IP.
    // The country-gate and IP-hash logic rely on this; without it,
    // every request would appear to come from the load-balancer.
    trustProxy: env.NODE_ENV !== "test",
    loggerInstance: buildLogger(),
  });

  // Round D — wrap every request in an AsyncLocalStorage frame so the
  // Pino mixin / Sentry beforeSend can tag log lines + events with the
  // request id (and downstream the auth + admin-auth plugins call
  // `requestContext.set` to attach userId / adminUserId).
  app.addHook("onRequest", (req, _reply, done) => {
    requestContext.run({ requestId: req.id }, done);
  });

  app.addHook("preHandler", (req, _reply, done) => {
    const u = req as typeof req & { userId?: string; adminUserId?: string };
    if (u.userId) requestContext.set({ userId: u.userId });
    if (u.adminUserId) requestContext.set({ adminUserId: u.adminUserId });
    done();
  });

  // Round A — wire fastify-type-provider-zod compilers globally so any
  // route opting in via `.withTypeProvider<ZodTypeProvider>()` gets
  // Zod-based request validation + response serialisation. Routes that
  // don't opt in keep Fastify's default JSON-schema validators, so this
  // is backwards-compatible.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(cors, {
    origin: [
      ...env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      ...env.ADMIN_CORS_ORIGIN.split(",").map((s) => s.trim()),
    ].filter(Boolean),
    credentials: true,
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      // Slightly above MAX_PHOTO_BYTES so the route-level check can return
      // a clean 413 instead of fastify-multipart throwing.
      fileSize: 5 * 1024 * 1024,
      fields: 4,
    },
  });

  // Round C — OpenAPI spec generation. Registered BEFORE any
  // `app.register(routes, ...)` so the schemas attached to routes feed
  // into the published spec. Internal + admin routes are hidden from the
  // public document via the transform inside the plugin.
  await app.register(openapiPlugin);

  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(authPlugin);
  await app.register(adminAuthPlugin);
  await app.register(adminRbacPlugin);
  await app.register(ratelimitPlugin);
  await app.register(countryGatePlugin);
  // metro-gate depends on `inferCountry` from country-gate and `prisma`.
  // flags depends on `prisma`. Both must load before any route that
  // calls `app.flags.evaluate(...)` or `app.checkMetro(...)`.
  await app.register(flagsPlugin);
  await app.register(metroGatePlugin);

  // OPS-3: tag every authenticated request with its userId for Sentry.
  // Runs after the per-route preHandler that populates req.userId.
  app.addHook("preHandler", sentryUserHook);

  // Round A — Unified error handler. Every API error response in
  // OpenMatch flows through here so the body shape is consistent for
  // iOS + admin. See backend/src/lib/error-codes.ts for the registry
  // and docs/api/ERRORS.md for the generated reference.
  //
  // Registered BEFORE any `app.register(routes, ...)` so it's inherited
  // by every encapsulated child context. (Fastify error handlers are
  // resolved against the encapsulation chain at request time; a handler
  // attached after route registration won't catch throws from those
  // routes' scopes.)
  app.setErrorHandler((err, req, reply) => {
    // Typed errors thrown by route handlers + services. Already have the
    // canonical body assembled — just emit it.
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send(err.body);
    }
    // Zod parse() failures bubble up here when handlers don't catch
    // them. Translate to validation_failed with a structured fields[]
    // payload. `instanceof` is unreliable when multiple zod copies are
    // loaded (vitest pre-bundling), so we also accept a duck-typed
    // ZodError by name + shape.
    if (
      err instanceof ZodError ||
      ((err as { name?: string }).name === "ZodError" &&
        Array.isArray((err as { issues?: unknown }).issues))
    ) {
      const e = zodErrorToHttp(err as ZodError);
      return reply.code(e.statusCode).send(e.body);
    }
    // Fastify's built-in JSON-schema validation errors (route schemas).
    if ((err as { validation?: unknown }).validation) {
      const e = httpError(ErrorCodes.VALIDATION_FAILED, {
        details: { fields: (err as { validation: unknown }).validation as unknown },
      });
      return reply.code(e.statusCode).send(e.body);
    }
    // Rate limit hits surface as a Fastify error with statusCode 429.
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 429) {
      return reply.code(429).send({
        error: ErrorCodes.RATE_LIMITED,
        message: "Too many requests",
      });
    }
    // Legacy throws from services that set { statusCode, message: "<code>" }.
    // Honour them so we don't accidentally upgrade a 4xx to a 500
    // during the migration. Once every service is converted to
    // HttpError these branches can be deleted.
    if (statusCode >= 400 && statusCode < 500) {
      const message = (err as { message?: string }).message;
      return reply
        .code(statusCode)
        .send({ error: message && message.length > 0 ? message : ErrorCodes.INVALID_REQUEST });
    }
    // 5xx — log + Sentry. Body is opaque; details only in Sentry.
    app.log.error({ err, reqId: req.id }, "request_failed");
    sentryFastifyErrorHook(req, err);
    return reply.code(500).send({ error: ErrorCodes.INTERNAL_ERROR });
  });

  // PERF-1: /health stays the cheap liveness probe but also reports the
  // current Postgres pool usage so an external monitor can graph it.
  app.get("/health", async () => {
    const out: { ok: true; pool?: { activeConnections: number } } = { ok: true };
    try {
      const rows = await app.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE usename = current_user`,
      );
      const n = rows[0]?.count;
      if (n !== undefined) out.pool = { activeConnections: Number(n) };
    } catch {
      // managed Postgres may forbid pg_stat_activity reads — ignore.
    }
    return out;
  });
  await app.register(healthRoutes);

  await app.register(internalRoutes, { prefix: "/api/v1/internal" });
  await app.register(internalSyntheticRoutes, { prefix: "/api/v1/internal" });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(invitesRoutes, { prefix: "/api/v1/invites" });
  await app.register(notificationsRoutes, { prefix: "/api/v1/notifications" });
  await app.register(analyticsRoutes, { prefix: "/api/v1/analytics" });
  await app.register(feedbackRoutes, { prefix: "/api/v1/feedback" });
  await app.register(profileRoutes, { prefix: "/api/v1/profile" });
  await app.register(preferencesRoutes, { prefix: "/api/v1/preferences" });
  await app.register(discoveryRoutes, { prefix: "/api/v1/discovery" });
  await app.register(swipesRoutes, { prefix: "/api/v1/swipes" });
  await app.register(likesRoutes, { prefix: "/api/v1/likes" });
  await app.register(matchesRoutes, { prefix: "/api/v1/matches" });
  await app.register(chatRoutes, { prefix: "/api/v1/conversations" });
  await app.register(realtimeRoutes, { prefix: "/api/v1/realtime" });
  await app.register(safetyRoutes, { prefix: "/api/v1/safety" });
  await app.register(transparencyRoutes, { prefix: "/api/v1/transparency" });
  await app.register(privacyRoutes, { prefix: "/api/v1/privacy" });
  await app.register(dsaRoutes, { prefix: "/api/v1/dsa" });
  await app.register(waitlistRoutes, { prefix: "/api/v1/waitlist" });

  await app.register(adminAuthRoutes, { prefix: "/api/v1/admin/auth" });
  await app.register(adminTotpRoutes, { prefix: "/api/v1/admin/auth/totp" });
  await app.register(adminUserRoutes, { prefix: "/api/v1/admin/users" });
  await app.register(adminReportRoutes, { prefix: "/api/v1/admin/reports" });
  await app.register(adminConversationRoutes, { prefix: "/api/v1/admin" });
  await app.register(adminPhotoRoutes, { prefix: "/api/v1/admin/photos" });
  await app.register(adminAuditRoutes, { prefix: "/api/v1/admin/audit" });
  await app.register(adminMetricsRoutes, { prefix: "/api/v1/admin/metrics" });
  await app.register(adminSyntheticRoutes, { prefix: "/api/v1/admin" });
  await app.register(adminRoleRoutes, { prefix: "/api/v1/admin" });
  await app.register(adminInvitesRoutes, { prefix: "/api/v1/admin/invites" });
  await app.register(adminFlagsRoutes, { prefix: "/api/v1/admin/flags" });
  await app.register(adminMetrosRoutes, { prefix: "/api/v1/admin/metros" });
  await app.register(adminFeedbackRoutes, { prefix: "/api/v1/admin/feedback" });
  await app.register(adminAnalyticsRoutes, { prefix: "/api/v1/admin/analytics" });
  await app.register(adminGeographyRoutes, { prefix: "/api/v1/admin/geography" });
  await app.register(adminDsaRoutes, { prefix: "/api/v1/admin/dsa-notices" });
  await app.register(adminWaitlistRoutes, { prefix: "/api/v1/admin/waitlist" });

  app.addHook("onClose", async () => {
    // OPS-3: drain pending Sentry events on graceful shutdown.
    await Sentry.flush(2000).catch(() => undefined);
  });

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildServer()
    .then((app) => app.listen({ port: env.PORT, host: env.HOST }))
    .then((addr) => {
      // eslint-disable-next-line no-console
      console.log(`OpenMatch backend listening on ${addr}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
