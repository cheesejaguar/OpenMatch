// POST /api/v1/iap/validate — accept a platform receipt and delegate to
// the configured BillingProvider for verification. On `valid: true` an
// Entitlement row is recorded so downstream paywall checks have a local
// source of truth. The noop default returns `valid: false` for every
// receipt, so this route is a no-op in core; forks wire a real provider
// before buildServer() and inherit the route behaviour automatically.

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getBillingProvider } from "../lib/billing-provider.js";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";

const bodySchema = z.object({
  platform: z.enum(["apple", "google"]),
  // Receipts vary widely in length — Apple StoreKit base64 receipts
  // routinely exceed 5KB. 64KB cap keeps memory bounded while
  // accommodating multi-renewal histories some receipts carry.
  receipt: z
    .string()
    .min(1)
    .max(64 * 1024),
});

export const iapRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/validate",
    {
      preHandler: app.authenticate,
      // Receipt validation hits an external provider; rate-limit per IP
      // so a misbehaving client can't fan out validations.
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = bodySchema.parse(req.body);
      const userId = req.userId!;

      const provider = getBillingProvider();
      const result = await provider.validateReceipt({
        platform: body.platform,
        receipt: body.receipt,
        userId,
      });

      if (!result.valid) {
        // We do NOT leak whether the provider rejected the format vs.
        // the signature vs. the renewal state. A single `invalid` code
        // keeps the surface narrow for replay-style abuse.
        return sendHttpError(reply, httpError(ErrorCodes.INVALID_REQUEST));
      }

      // Idempotent insert: if the same (source, transactionId) pair has
      // already been recorded we update the expiresAt instead of
      // creating a duplicate row. The schema-level unique index also
      // guards against a concurrent insert race.
      const source = body.platform;
      const productId = result.productId ?? "unknown";
      const transactionId = result.transactionId ?? null;

      const entitlement =
        transactionId !== null
          ? await app.prisma.entitlement.upsert({
              where: {
                source_transactionId: { source, transactionId },
              },
              create: {
                userId,
                productId,
                expiresAt: result.expiresAt ?? null,
                source,
                transactionId,
              },
              update: {
                expiresAt: result.expiresAt ?? null,
                productId,
              },
            })
          : await app.prisma.entitlement.create({
              data: {
                userId,
                productId,
                expiresAt: result.expiresAt ?? null,
                source,
              },
            });

      return reply.send({
        ok: true,
        entitlement: {
          id: entitlement.id,
          productId: entitlement.productId,
          expiresAt: entitlement.expiresAt?.toISOString() ?? null,
          source: entitlement.source,
        },
      });
    },
  );
};
