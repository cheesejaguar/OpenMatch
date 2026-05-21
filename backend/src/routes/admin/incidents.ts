import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { _resetStatusCacheForTests } from "../status.js";

// Admin endpoints for posting incident updates to the public status
// page. The data model is append-only: every update is a new row, and
// the latest row per `incidentKey` is the authoritative current state.
//
// Routes:
//   POST   /api/v1/admin/incidents               — post a new update
//   GET    /api/v1/admin/incidents               — list recent updates
//
// Auth: admin session + 2FA + INCIDENT_MANAGE permission. Read is
// admin-only here (the *public* status page reads from `/status/public`,
// not these routes) so the schema can include `postedBy` etc.

const postSchema = z.object({
  // When omitted, the server mints a fresh cuid() so this update
  // starts a new incident. When provided, the update joins an
  // existing incident timeline.
  incidentKey: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(140),
  body: z.string().min(1).max(4000),
  status: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  severity: z.enum(["none", "minor", "major", "critical"]).default("minor"),
  service: z.string().min(1).max(40).default("backend"),
});

const listSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

// Cheap cuid()-shaped key generator: 8-char timestamp + 12 random hex
// chars. Doesn't need cryptographic strength — incidentKey is just a
// grouping handle and any collision merges two unrelated timelines,
// which is recoverable by an admin re-keying via a new update.
function generateIncidentKey(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 14).padStart(12, "0");
  return `inc_${ts}_${rand}`;
}

export const adminIncidentsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);

  app.post(
    "/",
    { preHandler: app.requirePermission(PERMISSIONS.INCIDENT_MANAGE) },
    async (req, reply) => {
      const body = postSchema.parse(req.body);
      const principal = req.admin!;
      const incidentKey = body.incidentKey ?? generateIncidentKey();
      const row = await app.prisma.incidentUpdate.create({
        data: {
          incidentKey,
          title: body.title,
          body: body.body,
          status: body.status,
          severity: body.severity,
          service: body.service,
          postedBy: principal.adminUserId,
        },
      });
      // Invalidate the public-status cache so the new update appears
      // on /status within the next request (otherwise it could lag
      // by up to PUBLIC_STATUS_CACHE_MS).
      _resetStatusCacheForTests();
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "incident_update_posted",
          targetEntityType: "incident_update",
          targetEntityId: row.id,
          metadata: {
            incidentKey: row.incidentKey,
            status: row.status,
            severity: row.severity,
            service: row.service,
          },
        },
      );
      return reply.code(201).send({
        id: row.id,
        incidentKey: row.incidentKey,
        title: row.title,
        body: row.body,
        status: row.status,
        severity: row.severity,
        service: row.service,
        postedAt: row.postedAt.toISOString(),
        postedBy: row.postedBy,
      });
    },
  );

  // Listing intentionally returns ALL updates, not just the most-recent
  // per incident. The admin UI groups client-side; surfacing the raw
  // timeline makes it easier to audit/correct individual posts.
  app.get(
    "/",
    { preHandler: app.requirePermission(PERMISSIONS.INCIDENT_MANAGE) },
    async (req, reply) => {
      const q = listSchema.parse(req.query);
      const take = q.limit + 1;
      const rows = await app.prisma.incidentUpdate.findMany({
        orderBy: { postedAt: "desc" },
        take,
        ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      });
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      return reply.send({
        items: items.map((r) => ({
          id: r.id,
          incidentKey: r.incidentKey,
          title: r.title,
          body: r.body,
          status: r.status,
          severity: r.severity,
          service: r.service,
          postedAt: r.postedAt.toISOString(),
          postedBy: r.postedBy,
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id : null,
      });
    },
  );
};
