import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hashIdentity, hashIdentityCandidates } from "../lib/hash.js";

// BETA-3 — public waitlist endpoint. Captures out-of-cohort interest so
// we have an audience when the metro expands.
//
// Privacy: we never store the raw email. The row keys on
// `hashIdentity(email)` (SHA-256 of trimmed-lower email) so a returning
// submission is idempotent and the table is GDPR-friendly out of the
// gate. Country/city are optional self-declared strings.

const waitlistSchema = z.object({
  email: z.string().email().max(254),
  country: z.string().min(2).max(2).optional(),
  city: z.string().min(1).max(120).optional(),
});

export const waitlistRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = waitlistSchema.parse(req.body);
      const emailHash = hashIdentity(body.email);

      // Upsert keeps the endpoint idempotent: re-submitting the same
      // email returns the original position. country/city are only
      // overwritten on update if the caller supplied them.
      // SEV-A11 — during the HMAC cutover legacy rows may still be
      // keyed under the unsalted SHA-256. Look up under both forms so
      // a returning user is not treated as a new signup.
      const existing = await app.prisma.waitlistEntry.findFirst({
        where: { emailHash: { in: hashIdentityCandidates(body.email) } },
      });
      const row = existing
        ? await app.prisma.waitlistEntry.update({
            where: { emailHash: existing.emailHash },
            data: {
              country: body.country ?? existing.country,
              city: body.city ?? existing.city,
            },
          })
        : await app.prisma.waitlistEntry.create({
            data: {
              emailHash,
              country: body.country ?? null,
              city: body.city ?? null,
            },
          });

      const ahead = await app.prisma.waitlistEntry.count({
        where: { createdAt: { lt: row.createdAt } },
      });
      return reply.send({
        position: ahead + 1,
        createdAt: row.createdAt.toISOString(),
      });
    },
  );
};
