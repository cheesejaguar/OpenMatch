import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Round C — sync-error-codes script idempotency.
//
// CI runs `node scripts/sync-error-codes.mjs` followed by
// `git diff --exit-code admin/lib/api/error-codes.ts`. This test
// guards the script itself: running it twice in a row should leave the
// output file bit-identical, AND every code in the backend registry
// must appear in the generated admin file.

const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/sync-error-codes.mjs");
const OUTPUT = path.join(REPO_ROOT, "admin/lib/api/error-codes.ts");
const SOURCE = path.join(REPO_ROOT, "backend/src/lib/error-codes.ts");

describe("scripts/sync-error-codes.mjs", () => {
  it("is idempotent — re-running produces a byte-identical file", async () => {
    execSync(`node ${SCRIPT}`, { cwd: REPO_ROOT });
    const first = await readFile(OUTPUT, "utf-8");
    execSync(`node ${SCRIPT}`, { cwd: REPO_ROOT });
    const second = await readFile(OUTPUT, "utf-8");
    expect(second).toBe(first);
  });

  it("emits every backend ErrorCodes entry into the admin file", async () => {
    execSync(`node ${SCRIPT}`, { cwd: REPO_ROOT });
    const src = await readFile(SOURCE, "utf-8");
    const out = await readFile(OUTPUT, "utf-8");
    const codeEntries = [...src.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*"([a-z0-9_]+)"/gm)];
    for (const [, key, value] of codeEntries) {
      expect(out).toContain(`${key}: "${value}"`);
    }
  });

  it("recovers when the admin file has been hand-edited", async () => {
    // Drop a bogus line that the script must overwrite.
    await writeFile(OUTPUT, "// stale\nexport const ErrorCodes = {} as const;\n");
    execSync(`node ${SCRIPT}`, { cwd: REPO_ROOT });
    const out = await readFile(OUTPUT, "utf-8");
    expect(out).toContain("AUTO-GENERATED");
    expect(out).toContain('VALIDATION_FAILED: "validation_failed"');
  });
});
