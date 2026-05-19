import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { normalizeInviteCode } from "../lib/invite-codes.js";

const validateSchema = z.object({ code: z.string().min(1).max(64) });

// Public invite-code validation endpoint. Read-only — it does NOT
// consume a use; redemption happens transactionally inside
// /auth/start when a new User is created. We don't reveal the cohort
// label for codes that are invalid so the endpoint can't be used to
// enumerate the cohort taxonomy.

export const invitesRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/validate",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = validateSchema.parse(req.body);
      const code = normalizeInviteCode(body.code);
      const row = await app.prisma.betaInviteCode.findUnique({ where: { code } });
      if (!row) return reply.send({ valid: false, reason: "not_found" });
      if (row.revokedAt) return reply.send({ valid: false, reason: "revoked" });
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        return reply.send({ valid: false, reason: "expired" });
      }
      if (row.usedCount >= row.maxUses) {
        return reply.send({ valid: false, reason: "exhausted" });
      }
      return reply.send({ valid: true, cohortLabel: row.cohortLabel });
    },
  );
};
