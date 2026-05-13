import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  buildExportBundle,
  cancelAccountDeletion,
  getNotificationPreferences,
  listEffectiveConsents,
  listMyDsars,
  openDsar,
  recordConsent,
  scheduleAccountDeletion,
  updateNotificationPreferences,
  withdrawConsent,
} from "../services/privacy.service.js";

// Authenticated rights-and-controls routes — the user-facing half of
// the compliance surface. Public (non-user) intake for DSA / TAKE IT
// DOWN reports is in routes/dsa.ts so it can be unauthenticated and
// rate-limited differently.

const CONSENT_SCOPES = [
  "terms_of_service",
  "privacy_notice",
  "art9_processing",
  "precise_location",
  "marketing_email",
  "marketing_push",
  "marketing_sms",
  "analytics",
  "recommender_personalised",
  "limit_use_spi",
] as const;

const consentSchema = z.object({
  scope: z.enum(CONSENT_SCOPES),
  granted: z.boolean(),
  surface: z.string().min(1).max(60).default("api"),
});

const dsarSchema = z.object({
  requestType: z.enum([
    "access",
    "correction",
    "portability",
    "restriction",
    "objection",
    "limit_use_spi",
    "withdraw_consent",
    // deletion handled by /account/deletion, not /dsar — different SLA and grace logic
  ]),
  jurisdiction: z.string().length(2).optional(),
  notes: z.string().max(2000).optional(),
});

const deletionSchema = z.object({
  reason: z.string().max(500).optional(),
});

const notificationPrefsSchema = z.object({
  productNewsEmail: z.boolean().optional(),
  productNewsPush: z.boolean().optional(),
  productNewsSms: z.boolean().optional(),
  newMatchPush: z.boolean().optional(),
  newMessagePush: z.boolean().optional(),
  newLikePush: z.boolean().optional(),
  safetyPush: z.boolean().optional(),
  pushPreviewMode: z.enum(["full", "sender_only", "hidden"]).optional(),
  marketingOptInSource: z.string().max(60).optional(),
});

export const privacyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  // ---- Consents -------------------------------------------------------

  app.get("/consents", async (req) => {
    return listEffectiveConsents(app.prisma, req.userId!);
  });

  app.post(
    "/consents",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = consentSchema.parse(req.body);
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip;
      const record = body.granted
        ? await recordConsent(app.prisma, {
            userId: req.userId!,
            scope: body.scope,
            granted: true,
            surface: body.surface,
            ip,
            userAgent: req.headers["user-agent"] ?? null,
          })
        : await withdrawConsent(app.prisma, {
            userId: req.userId!,
            scope: body.scope,
            surface: body.surface,
            ip,
            userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
          });
      app.log.info(
        { event: "privacy.consent", userId: req.userId, scope: body.scope, granted: body.granted },
        "consent_recorded",
      );
      return reply.code(201).send({
        id: record.id,
        scope: record.scope,
        granted: body.granted,
        policyVersion: record.policyVersion,
      });
    },
  );

  // ---- DSAR -----------------------------------------------------------

  app.get("/dsar", async (req) => listMyDsars(app.prisma, req.userId!));

  app.post(
    "/dsar",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = dsarSchema.parse(req.body);
      const ticket = await openDsar(app.prisma, {
        userId: req.userId!,
        requestType: body.requestType,
        channel: "in_app",
        jurisdiction: body.jurisdiction,
        notes: body.notes,
      });
      app.log.info(
        { event: "privacy.dsar_opened", userId: req.userId, requestType: body.requestType },
        "dsar_opened",
      );
      return reply.code(202).send({
        id: ticket.id,
        status: ticket.status,
        dueAt: ticket.dueAt,
      });
    },
  );

  // ---- Data export (synchronous shortcut for the simple case) ----------
  //
  // For access / portability we can build the bundle inline because it
  // already fits comfortably in a single response. For larger users
  // this will move behind a worker that writes a signed-URL bundle.
  // We always also record a DSAR ticket so the rights-request register
  // is complete.
  app.get(
    "/export",
    { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const bundle = await buildExportBundle(app.prisma, req.userId!);
      await openDsar(app.prisma, {
        userId: req.userId!,
        requestType: "access",
        channel: "in_app",
        notes: "Self-service /privacy/export",
      });
      reply.header("Content-Disposition", `attachment; filename="openmatch-export.json"`);
      return bundle;
    },
  );

  // ---- Account deletion ------------------------------------------------
  //
  // Apple App Store §5.1.1(v) requires in-app account deletion. The
  // grace period is short enough that "I deleted by mistake" is
  // recoverable, but expired requests are unrecoverable. We do not
  // physically remove rows synchronously; an async worker (Workstream D)
  // runs after the grace period and erases / anonymises per the
  // privacy-notice retention rules.

  app.get("/account/deletion", async (req) => {
    return app.prisma.accountDeletionRequest.findFirst({
      where: { userId: req.userId!, status: { in: ["scheduled", "in_progress"] } },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        gracePeriodEndsAt: true,
        cancelledAt: true,
      },
    });
  });

  app.post(
    "/account/deletion",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = deletionSchema.parse(req.body);
      const request = await scheduleAccountDeletion(app.prisma, {
        userId: req.userId!,
        reason: body.reason,
      });
      app.log.warn(
        { event: "privacy.account_deletion_scheduled", userId: req.userId, requestId: request.id },
        "account_deletion_scheduled",
      );
      return reply.code(202).send({
        id: request.id,
        status: request.status,
        gracePeriodEndsAt: request.gracePeriodEndsAt,
        cancellableUntil: request.gracePeriodEndsAt,
      });
    },
  );

  app.delete("/account/deletion", async (req, reply) => {
    try {
      const cancelled = await cancelAccountDeletion(app.prisma, req.userId!);
      app.log.info(
        {
          event: "privacy.account_deletion_cancelled",
          userId: req.userId,
          requestId: cancelled.id,
        },
        "account_deletion_cancelled",
      );
      return reply.send({ id: cancelled.id, status: cancelled.status });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
    }
  });

  // ---- Notification & marketing preferences ----------------------------

  app.get("/notifications", async (req) => {
    return getNotificationPreferences(app.prisma, req.userId!);
  });

  app.put("/notifications", async (req) => {
    const body = notificationPrefsSchema.parse(req.body);
    return updateNotificationPreferences(app.prisma, req.userId!, body);
  });

  // ---- Recommender opt-out (DSA Art. 38 prep) -------------------------
  //
  // A user can opt out of personalised ranking. This is implemented as a
  // consent toggle so it's auditable and revocable; discovery.service
  // reads `recommender_personalised` to choose the ranking variant.
  app.get("/recommender/personalised", async (req) => {
    const consents = await listEffectiveConsents(app.prisma, req.userId!);
    const c = consents.find((c) => c.scope === "recommender_personalised");
    // Default is opted IN to personalised — the user is presumed to
    // want it unless they actively turn it off. We still record the
    // implicit baseline as a ConsentRecord at signup (Workstream C iOS
    // hook) so the audit trail is complete.
    return { granted: c?.granted ?? true };
  });
};
