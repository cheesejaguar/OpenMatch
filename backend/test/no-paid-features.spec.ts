import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Guardrail tests — fail CI if anyone adds payment / paid mechanics.
// See README.md and CONTRIBUTING.md.

function listSourceFiles(dir: string, results: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      listSourceFiles(full, results);
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(full);
    }
  }
  return results;
}

const ROOT = path.resolve(__dirname, "..", "src");
const FILES = listSourceFiles(ROOT);

const FORBIDDEN: Array<{ pattern: RegExp; rationale: string }> = [
  { pattern: /super_?like/i, rationale: "Super likes are explicitly disallowed (§15.2)." },
  { pattern: /paid[_ ]?boost/i, rationale: "Paid boosts are disallowed (§15.1)." },
  { pattern: /stripe|paypal|braintree/i, rationale: "No payment integrations." },
  { pattern: /subscription[_ ]?tier/i, rationale: "No subscription tiers." },
  { pattern: /paywall/i, rationale: "Core features are free; no paywalls." },
  { pattern: /storekit/i, rationale: "No in-app purchases." },
];

describe("no paid features in backend source", () => {
  for (const rule of FORBIDDEN) {
    it(`source does not contain ${rule.pattern} (${rule.rationale})`, () => {
      for (const file of FILES) {
        const content = fs.readFileSync(file, "utf-8");
        // Allow appearances inside comments that are explicitly *forbidding*
        // the pattern. We exclude lines whose comment context says
        // "Super likes are disallowed", etc.
        const stripped = content
          .split("\n")
          .filter((line) => {
            const trimmed = line.trim();
            return !(
              trimmed.startsWith("//") ||
              trimmed.startsWith("*") ||
              trimmed.startsWith("/*")
            );
          })
          .join("\n");
        expect(
          stripped,
          `${path.relative(ROOT, file)} contains forbidden pattern ${rule.pattern}`,
        ).not.toMatch(rule.pattern);
      }
    });
  }
});
