import type { FastifyPluginAsync } from "fastify";
import { currentConfig } from "@openmatch/matching";
import fs from "node:fs/promises";
import path from "node:path";

export const transparencyRoutes: FastifyPluginAsync = async (app) => {
  // No auth required — algorithm transparency is public by design.

  app.get("/algorithm/current", async () => {
    return {
      ...currentConfig,
      note:
        "These are the live weights and constraints used by the discovery deck. The package source and synthetic tests are in the public repository.",
      sourceUrl:
        "https://github.com/cheesejaguar/openmatch/tree/main/matching",
    };
  });

  app.get("/algorithm/changelog", async () => {
    // Pull from the algorithm audit table (one row per config change),
    // plus the static CHANGELOG.md as a fallback.
    const records = await app.prisma.algorithmAuditRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    let markdown: string | null = null;
    try {
      const root = path.resolve(process.cwd(), "..");
      markdown = await fs.readFile(
        path.join(root, "docs", "algorithm", "CHANGELOG.md"),
        "utf-8",
      );
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

  app.get("/community-guidelines", async (_req, reply) => {
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
  });
};
