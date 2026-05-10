import Fastify from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import { env } from "./env.js";
import prismaPlugin from "./plugins/prisma.js";
import redisPlugin from "./plugins/redis.js";
import authPlugin from "./plugins/auth.js";
import ratelimitPlugin from "./plugins/ratelimit.js";
import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { preferencesRoutes } from "./routes/preferences.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { swipesRoutes } from "./routes/swipes.js";
import { likesRoutes } from "./routes/likes.js";
import { matchesRoutes } from "./routes/matches.js";
import { chatRoutes } from "./routes/chat.js";
import { safetyRoutes } from "./routes/safety.js";
import { transparencyRoutes } from "./routes/transparency.js";

export async function buildServer() {
  const app = Fastify({
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
    origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });
  await app.register(websocket);
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
  await app.register(ratelimitPlugin);

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(profileRoutes, { prefix: "/api/v1/profile" });
  await app.register(preferencesRoutes, { prefix: "/api/v1/preferences" });
  await app.register(discoveryRoutes, { prefix: "/api/v1/discovery" });
  await app.register(swipesRoutes, { prefix: "/api/v1/swipes" });
  await app.register(likesRoutes, { prefix: "/api/v1/likes" });
  await app.register(matchesRoutes, { prefix: "/api/v1/matches" });
  await app.register(chatRoutes, { prefix: "/api/v1/conversations" });
  await app.register(safetyRoutes, { prefix: "/api/v1/safety" });
  await app.register(transparencyRoutes, { prefix: "/api/v1/transparency" });

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
