import type { FastifyPluginAsync } from "fastify";
import { ably, conversationChannel } from "../lib/realtime.js";

// Issues a short-lived Ably token request scoped to the user's conversation
// channels. iOS uses this to subscribe directly to Ably for live chat.
//
// We mint a capability that grants subscribe + presence on each conversation
// the caller belongs to. Tokens last 1h; the client re-fetches on expiry.
export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post("/token", async (_req, reply) => {
    if (!ably) {
      return reply.code(503).send({ error: "realtime_unconfigured" });
    }
    const userId = (_req as { userId?: string }).userId!;

    // Scope strictly to live conversations: an active match the caller is
    // a member of. Unmatched / closed conversations must not grant subscribe
    // capability, otherwise stale Ably channels remain reachable.
    const conversations = await app.prisma.conversation.findMany({
      where: {
        match: {
          status: "active",
          OR: [{ userAId: userId }, { userBId: userId }],
        },
      },
      select: { id: true },
    });

    const capability: Record<string, string[]> = {};
    for (const c of conversations) {
      capability[conversationChannel(c.id)] = ["subscribe", "presence"];
    }

    const tokenRequest = await ably.auth.createTokenRequest({
      clientId: userId,
      capability: JSON.stringify(capability),
      ttl: 60 * 60 * 1000,
    });
    return tokenRequest;
  });
};
