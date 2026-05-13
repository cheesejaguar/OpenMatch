import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Compliance invariant: no API surface may ever return raw lat/lng or
// expose the Profile.location geography column to anyone but the owning
// user. The only sanctioned way to surface distance is the
// `formatDistance` helper in src/lib/location.ts.
//
// This test is intentionally a static-scan, not a runtime test, so that
// it triggers on the diff in CI — before a leak ever ships.
//
// Privacy principle: docs/privacy/principles.md §3
// Threat-model entry: I-1 in docs/legal/threat-model.md

function listSourceFiles(dir: string, results: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".local-media") {
        continue;
      }
      listSourceFiles(full, results);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

const ROOT = path.resolve(__dirname, "..", "src");

// Files allowed to handle precise location internally. Adding to this
// list requires a privacy-review.
const PRIVILEGED_FILES = new Set(
  [
    "src/lib/location.ts", // formatDistance + haversineKm
    "src/services/discovery.service.ts", // PostGIS distance computation
    "src/routes/profile.ts", // initial location capture (server never echoes back)
    "src/services/privacy.service.ts", // export bundle uses the city-only projection
  ].map((p) => path.resolve(ROOT, "..", p)),
);

// Patterns that, if present in an API response object literal or
// Prisma `select` projection in a NON-privileged file, indicate a leak.
const LEAK_PATTERNS: Array<{ pattern: RegExp; rationale: string }> = [
  {
    pattern: /\b(latitude|longitude)\b\s*:/,
    rationale: "Raw lat/long must never appear in an API response shape.",
  },
  {
    pattern: /select\s*:\s*\{[^}]*\blocation\s*:\s*true/,
    rationale: "Profile.location (PostGIS) must not be selected for return.",
  },
  {
    pattern: /\.location\s*===\s*null|\.location\s*!==\s*null/,
    rationale:
      "Comparing the PostGIS location field at the API level suggests it has been hoisted out of the privileged module.",
  },
  // Catch `coords: { lat, lng }` shapes used in responses.
  {
    pattern: /coords?\s*:\s*\{\s*lat\s*:/,
    rationale: "Response shapes must not include client-style coords objects.",
  },
];

describe("no precise-location leak in non-privileged source", () => {
  const files = listSourceFiles(ROOT).filter((f) => !PRIVILEGED_FILES.has(f));

  for (const rule of LEAK_PATTERNS) {
    it(`no source file matches ${rule.pattern} (${rule.rationale})`, () => {
      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        // Strip line comments so a comment explaining "we never expose
        // latitude" doesn't itself trigger the test.
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

  it("formatDistance is the only function that returns a `text` distance string", () => {
    // Smoke check: any non-privileged file that produces a string like
    // "X miles away" or "X km away" is a likely bypass of formatDistance.
    const forbidden = /\b(?:\d+(?:\.\d+)?)\s*(?:mi|miles|km)\s+away\b/;
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content, `${path.relative(ROOT, file)} hand-formats a distance string`).not.toMatch(
        forbidden,
      );
    }
  });
});
