import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
// Import the compiled backend. `npm run build -w @openmatch/backend` emits
// backend/dist/src/server.js (rootDir "./" + include "src/**/*.ts").
// The Vercel buildCommand in vercel.json runs the build before this
// function is bundled, so this .js path always resolves at deploy time.
import { buildServer } from "../backend/dist/src/server.js";

// Vercel Node Function entry point.
//
// Why this lives at /api/index.ts (not backend/api/index.ts):
// Vercel auto-discovers Serverless Functions inside the project root's
// `api/` directory only. Patterns under any other path don't match the
// discovery scan and produce:
//   "The pattern ... defined in `functions` doesn't match any
//    Serverless Functions inside the `api` directory."
//
// The Fastify app is built once per process and memoized on globalThis
// so warm invocations skip the boot. We forward the raw (req, res) to
// Fastify's internal HTTP server via `emit('request', ...)`; this is
// the recommended pattern when wrapping Fastify in a serverless function.
// We deliberately do NOT call `app.listen()` — Vercel binds the port itself.

type GlobalWithApp = typeof globalThis & { __omApp?: Promise<FastifyInstance> };
const g = globalThis as GlobalWithApp;

async function getApp(): Promise<FastifyInstance> {
  if (!g.__omApp) {
    g.__omApp = (async () => {
      const app = await buildServer();
      await app.ready();
      return app;
    })();
  }
  return g.__omApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit("request", req, res);
}
