#!/usr/bin/env node
// Generates admin/lib/api/error-codes.ts from backend/src/lib/error-codes.ts.
//
// Round C — keeps the admin dashboard's error-code constants byte-stable
// with the backend registry. CI runs this script and `git diff
// --exit-code admin/lib/api/error-codes.ts` to ensure the two never
// drift; engineers who add a backend code must run this script to
// publish it to the admin client.
//
// Round B hand-copied the initial admin file; this script keeps it in
// sync from the same parse logic that generates docs/api/ERRORS.md.
//
// Usage:
//   node scripts/sync-error-codes.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(REPO_ROOT, "backend/src/lib/error-codes.ts");
const OUTPUT = path.join(REPO_ROOT, "admin/lib/api/error-codes.ts");

function parseErrorCodes(source) {
  const match = source.match(/export const ErrorCodes = \{([\s\S]*?)\} as const;/);
  if (!match) throw new Error("Could not locate ErrorCodes object in error-codes.ts");
  const block = match[1];
  const codes = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*):\s*"([a-z0-9_]+)"/);
    if (m) codes.push({ key: m[1], value: m[2] });
  }
  return codes;
}

function render(codes) {
  const lines = [
    "// AUTO-GENERATED FILE — do not edit by hand.",
    "// Regenerate via `node scripts/sync-error-codes.mjs` after changing",
    "// backend/src/lib/error-codes.ts. CI fails if this file is out of sync.",
    "",
    "export const ErrorCodes = {",
  ];
  for (const c of codes) {
    lines.push(`  ${c.key}: "${c.value}",`);
  }
  lines.push("} as const;");
  lines.push("");
  lines.push("export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const source = await readFile(SOURCE, "utf-8");
  const codes = parseErrorCodes(source);
  const out = render(codes);
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, out);
  // eslint-disable-next-line no-console
  console.log(`wrote ${path.relative(REPO_ROOT, OUTPUT)} (${codes.length} codes)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
