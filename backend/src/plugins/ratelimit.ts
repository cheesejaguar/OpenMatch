import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

// Anti-spam / anti-abuse rate limits.
// These are NEVER paid-only bypassable. They exist for integrity, not
// monetization. See docs/product/openmatch-design.md §15.4.
export default fp(async (app) => {
  await app.register(rateLimit, {
    global: false,
    max: 600, // a generous default; per-route limits override
    timeWindow: "1 minute",
    keyGenerator: (req) => (req as { userId?: string }).userId ?? req.ip ?? "anon",
    errorResponseBuilder: (_req, ctx) => ({
      error: "rate_limited",
      message:
        "You're moving fast. This limit exists to protect users from spam — it is never bypassable by payment.",
      retryAfter: ctx.after,
    }),
  });
});
