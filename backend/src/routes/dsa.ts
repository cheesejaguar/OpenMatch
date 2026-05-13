import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { openNotice } from "../services/dsa.service.js";

// DSA notice-and-action intake — also fulfils:
//   - TAKE IT DOWN Act NCII reporting form (`category=ncii`)
//   - DMCA notice (`category=copyright_dmca`)
//   - CSAM reports from non-users (`category=csam`)
//
// Intentionally unauthenticated: a victim of NCII may not have an
// account, and the DSA requires a notice path open to any natural or
// legal person. Rate limit is strict to deter abuse; trusted flaggers
// get a separate, authenticated path (Workstream C2 — TBD).

const CATEGORIES = [
  "illegal_content",
  "csam",
  "ncii",
  "copyright_dmca",
  "terrorism_violent",
  "hate_speech",
  "privacy_violation",
  "defamation",
  "scam_fraud",
  "underage",
  "other",
] as const;

const noticeSchema = z.object({
  category: z.enum(CATEGORIES),
  // The "place at OpenMatch" the offending content lives: a user id, a
  // photo id, a message id, or a URL. The reporter doesn't have to know
  // our internal identifiers — they can paste a profile URL.
  contentReference: z.string().min(1).max(1000),
  // Free-text description; required by DSA Art. 16(2)(b).
  description: z.string().min(20).max(10_000),
  // The reporter's good-faith statement (Art. 16(2)(d)).
  isInGoodFaith: z.literal(true),
  // Optional contact — we strongly prefer to have one so we can ask
  // follow-up questions and notify of outcome.
  reporterName: z.string().min(1).max(200).optional(),
  reporterEmail: z.string().email().optional(),
  reporterCountry: z.string().length(2).optional(),
  // Optional legal frame (e.g. "TAKE IT DOWN Act §1309", "GDPR Art. 17").
  legalBasisClaim: z.string().max(500).optional(),
  jurisdictionClaim: z.string().max(200).optional(),
});

export const dsaRoutes: FastifyPluginAsync = async (app) => {
  // Public health check so this endpoint can be discovered without
  // exposing operational state.
  app.get("/", async () => ({
    service: "OpenMatch DSA notice-and-action",
    statutory_basis: [
      "EU 2022/2065 (DSA) Art. 16",
      "TAKE IT DOWN Act §1309 (NCII)",
      "17 U.S.C. §512 (DMCA)",
      "18 U.S.C. §2258A (CSAM, when applicable)",
    ],
    categories: CATEGORIES,
    target_response_hours: {
      csam: 24,
      ncii: 48,
      underage: 24,
      terrorism_violent: 24,
      copyright_dmca: 168,
      default: 168,
    },
    privacy_notice: "/legal/privacy-notice",
  }));

  app.post(
    "/notice",
    {
      // Strict: this is unauthenticated and abuse-prone. We rely on the
      // ack response giving the reporter a receipt id, not on speed.
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const body = noticeSchema.parse(req.body);
      // A trusted-flagger gets priority handling. We can't know who the
      // reporter is here (unauthenticated), but if the *trustedFlaggerId*
      // header is provided and verified against a separate API key in
      // Workstream C2, that path will set the flag. For now, no flag.
      const ticket = await openNotice(app.prisma, {
        category: body.category,
        reporterIsUser: false,
        reporterName: body.reporterName,
        reporterEmail: body.reporterEmail,
        reporterCountry: body.reporterCountry,
        contentReference: body.contentReference,
        description: body.description,
        isInGoodFaith: body.isInGoodFaith,
        jurisdictionClaim: body.jurisdictionClaim,
        legalBasisClaim: body.legalBasisClaim,
      });
      app.log.warn(
        {
          event: "dsa.notice_received",
          ticketId: ticket.id,
          category: ticket.category,
          slaDueAt: ticket.slaDueAt,
        },
        "dsa_notice_received",
      );
      return reply.code(202).send({
        ticketId: ticket.id,
        receivedAt: ticket.receivedAt,
        slaDueAt: ticket.slaDueAt,
        nextSteps:
          "You will receive an acknowledgement and (where contact details were provided) a follow-up by the response time above.",
      });
    },
  );

  // Authenticated reporter status lookup. Reporters with an OpenMatch
  // account can poll their own ticket; non-users must rely on email
  // confirmation flows (sent by the moderator workflow).
  app.get<{ Params: { id: string } }>("/notice/:id", async (req, reply) => {
    const ticket = await app.prisma.noticeAndActionReport.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        category: true,
        status: true,
        receivedAt: true,
        acknowledgedAt: true,
        slaDueAt: true,
        resolvedAt: true,
        reporterEmail: true,
        reporterUserId: true,
      },
    });
    if (!ticket) return reply.code(404).send({ error: "not_found" });

    // Authorisation: reporter must either be the authenticated user, or
    // match the email they originally provided (out-of-band proof — we
    // do not implement here; for non-users we email status updates).
    try {
      await req.jwtVerify();
      const userId = (req.user as { sub?: string } | undefined)?.sub;
      if (ticket.reporterUserId && ticket.reporterUserId === userId) {
        return reply.send(ticket);
      }
    } catch {
      // unauthenticated — fall through
    }
    // For unauthenticated callers we return only the existence and SLA,
    // never the full record (prevents enumeration of competitors' reports).
    return reply.send({
      id: ticket.id,
      category: ticket.category,
      receivedAt: ticket.receivedAt,
      slaDueAt: ticket.slaDueAt,
      status: ticket.status,
    });
  });
};
