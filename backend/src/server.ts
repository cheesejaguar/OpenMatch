import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { env } from "./env.js";
import adminAuthPlugin from "./plugins/admin-auth.js";
import adminRbacPlugin from "./plugins/admin-rbac.js";
import authPlugin from "./plugins/auth.js";
import countryGatePlugin from "./plugins/country-gate.js";
import flagsPlugin from "./plugins/flags.js";
import metroGatePlugin from "./plugins/metro-gate.js";
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
import { adminMetricsRoutes } from "./routes/admin/metrics.js";
import { adminMetrosRoutes } from "./routes/admin/metros.js";
import { adminPhotoRoutes } from "./routes/admin/photos.js";
import { adminReportRoutes } from "./routes/admin/reports.js";
import { adminRoleRoutes } from "./routes/admin/roles.js";
import { adminTotpRoutes } from "./routes/admin/totp.js";
import { adminUserRoutes } from "./routes/admin/users.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { dsaRoutes } from "./routes/dsa.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { healthRoutes } from "./routes/health.js";
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

export async function buildServer() {
  const app = Fastify({
    // We sit behind Vercel's edge in production, which always sets
    // X-Forwarded-For. Trusting it makes `req.ip` and the rate-limit
    // plugin reflect the upstream client IP rather than the proxy IP.
    // The country-gate and IP-hash logic rely on this; without it,
    // every request would appear to come from the load-balancer.
    trustProxy: env.NODE_ENV !== "test",
    logger:
      env.NODE_ENV === "development"
        ? {
            level: env.LOG_LEVEL,
            transport: { target: "pino-pretty", options: { colorize: true } },
          }
        : { level: env.LOG_LEVEL },
  });

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
  await app.register(swagger, {
    openapi: {
      info: {
        title: "OpenMatch API",
        version: "0.1.0",
        description:
          "OpenMatch is an open-source dating app with an auditable matching algorithm and no paid dating advantage.",
      },
      servers: [{ url: `http://${env.HOST}:${env.PORT}` }],
    },
  });

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

  app.get("/health", async () => ({ ok: true }));
  await app.register(healthRoutes);

  await app.register(internalRoutes, { prefix: "/api/v1/internal" });
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

  await app.register(adminAuthRoutes, { prefix: "/api/v1/admin/auth" });
  await app.register(adminTotpRoutes, { prefix: "/api/v1/admin/auth/totp" });
  await app.register(adminUserRoutes, { prefix: "/api/v1/admin/users" });
  await app.register(adminReportRoutes, { prefix: "/api/v1/admin/reports" });
  await app.register(adminConversationRoutes, { prefix: "/api/v1/admin" });
  await app.register(adminPhotoRoutes, { prefix: "/api/v1/admin/photos" });
  await app.register(adminAuditRoutes, { prefix: "/api/v1/admin/audit" });
  await app.register(adminMetricsRoutes, { prefix: "/api/v1/admin/metrics" });
  await app.register(adminRoleRoutes, { prefix: "/api/v1/admin" });
  await app.register(adminInvitesRoutes, { prefix: "/api/v1/admin/invites" });
  await app.register(adminFlagsRoutes, { prefix: "/api/v1/admin/flags" });
  await app.register(adminMetrosRoutes, { prefix: "/api/v1/admin/metros" });
  await app.register(adminFeedbackRoutes, { prefix: "/api/v1/admin/feedback" });
  await app.register(adminAnalyticsRoutes, { prefix: "/api/v1/admin/analytics" });
  await app.register(adminGeographyRoutes, { prefix: "/api/v1/admin/geography" });
  await app.register(adminDsaRoutes, { prefix: "/api/v1/admin/dsa-notices" });

  app.setErrorHandler((err, _req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    app.log.error({ err }, "request_failed");
    reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
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
