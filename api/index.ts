import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
// Imported from the compiled backend output so @vercel/node bundles a
// concrete .js file rather than trying to traverse the workspace's
// NodeNext-style `.js`→`.ts` source imports.
import { buildServer } from "../backend/dist/server.js";

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
