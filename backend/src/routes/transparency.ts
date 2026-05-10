import fs from "node:fs/promises";
import path from "node:path";
import { currentConfig } from "@openmatch/matching";
import type { FastifyPluginAsync } from "fastify";

// All transparency routes are public by design (no auth required). The two
// endpoints that touch the filesystem are rate-limited per IP to bound disk
// I/O if anyone tries to hammer them.
const FS_ROUTE_RATE_LIMIT = { max: 60, timeWindow: "1 minute" } as const;

export const transparencyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/algorithm/current", async () => {
    return {
      ...currentConfig,
      note: "These are the live weights and constraints used by the discovery deck. The package source and synthetic tests are in the public repository.",
      sourceUrl: "https://github.com/cheesejaguar/openmatch/tree/main/matching",
    };
  });

  app.get("/algorithm/changelog", { config: { rateLimit: FS_ROUTE_RATE_LIMIT } }, async () => {
    // Pull from the algorithm audit table (one row per config change),
    // plus the static CHANGELOG.md as a fallback.
    const records = await app.prisma.algorithmAuditRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    let markdown: string | null = null;
    try {
      const root = path.resolve(process.cwd(), "..");
      markdown = await fs.readFile(path.join(root, "docs", "algorithm", "CHANGELOG.md"), "utf-8");
    } catch {
      markdown = null;
    }
    return { records, markdown };
  });

  app.get("/ranking-config/current", async () => ({
    algorithmVersion: currentConfig.algorithmVersion,
    rankingConfigVersion: currentConfig.rankingConfigVersion,
    weights: currentConfig.weights,
  }));

  app.get(
    "/community-guidelines",
    { config: { rateLimit: FS_ROUTE_RATE_LIMIT } },
    async (_req, reply) => {
      try {
        const root = path.resolve(process.cwd(), "..");
        const md = await fs.readFile(
          path.join(root, "docs", "safety", "community-guidelines.md"),
          "utf-8",
        );
        reply.header("content-type", "text/markdown");
        return md;
      } catch {
        return reply.code(404).send({ error: "not_found" });
      }
    },
  );
};
