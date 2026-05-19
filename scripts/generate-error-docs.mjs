#!/usr/bin/env node
// Regenerate docs/api/ERRORS.md from backend/src/lib/error-codes.ts.
// CI invokes this and `git diff --exit-code` to ensure the docs stay
// byte-stable with the registry. Run manually after every code/meta edit:
//
//   node scripts/generate-error-docs.mjs
//
// The parser intentionally only understands the literal-object form used
// by error-codes.ts. If you reach for `if`/`for`/dynamic keys in there,
// rewrite this script too.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(REPO_ROOT, "backend/src/lib/error-codes.ts");
const OUTPUT = path.join(REPO_ROOT, "docs/api/ERRORS.md");

function parseErrorCodes(source) {
  // Pull the "key: value" lines out of the `export const ErrorCodes = { ... } as const;` block.
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

function parseMeta(source) {
  // Pull each `[ErrorCodes.X]: { status: N, description: "…", group: "…" }` entry.
  // Description strings can contain commas, semicolons, parens; we delimit on
  // the closing `}` of each entry.
  const match = source.match(
    /export const ERROR_CODE_META: Record<ErrorCode, ErrorCodeMeta> = \{([\s\S]*?)\n\};/,
  );
  if (!match) throw new Error("Could not locate ERROR_CODE_META object in error-codes.ts");
  const block = match[1];
  // Match each entry: [ErrorCodes.KEY]: { … },
  const meta = new Map();
  const entryRe =
    /\[ErrorCodes\.([A-Z0-9_]+)\]:\s*\{\s*status:\s*(\d+),\s*description:\s*"((?:[^"\\]|\\.)*)"(?:,\s*group:\s*"([^"]+)")?,?\s*\}/g;
  let m;
  while ((m = entryRe.exec(block)) !== null) {
    meta.set(m[1], {
      status: Number(m[2]),
      description: m[3].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
      group: m[4] ?? "Other",
    });
  }
  return meta;
}

function render(codes, meta) {
  const groups = new Map();
  for (const c of codes) {
    const info = meta.get(c.key);
    if (!info) {
      throw new Error(`No ERROR_CODE_META entry for ${c.key}`);
    }
    const group = info.group ?? "Other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ ...c, ...info });
  }

  // Stable group ordering: insertion order from the meta map.
  const groupOrder = [];
  for (const c of codes) {
    const info = meta.get(c.key);
    const g = info?.group ?? "Other";
    if (!groupOrder.includes(g)) groupOrder.push(g);
  }

  const lines = [
    "# OpenMatch API error codes",
    "",
    "This file is generated from `backend/src/lib/error-codes.ts` via",
    "`scripts/generate-error-docs.mjs`. Do not edit by hand.",
    "",
    "Every API error response from the backend has the shape:",
    "",
    "```json",
    '{ "error": "<code>", "message": "optional human text", "fields": [/* validation only */] }',
    "```",
    "",
    "`error` is the stable machine-readable identifier listed below. Clients",
    "MUST branch on this string, not on `message`.",
    "",
  ];

  for (const group of groupOrder) {
    const rows = groups.get(group);
    if (!rows) continue;
    lines.push(`## ${group}`);
    lines.push("");
    lines.push("| Code | HTTP | Description |");
    lines.push("| --- | --- | --- |");
    rows.sort((a, b) => a.value.localeCompare(b.value));
    for (const r of rows) {
      // Escape backslashes FIRST, then pipes, so descriptions are safe
      // inside markdown tables and we don't double-escape an already-
      // escaped pipe. The descriptions in error-codes.ts are author-
      // written today (no user input), but we still defend the
      // generator against future inputs containing backslashes.
      const desc = r.description.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      lines.push(`| \`${r.value}\` | ${r.status} | ${desc} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function main() {
  const source = await readFile(SOURCE, "utf-8");
  const codes = parseErrorCodes(source);
  const meta = parseMeta(source);
  const out = render(codes, meta);
  await writeFile(OUTPUT, out);
  // eslint-disable-next-line no-console
  console.log(
    `wrote ${path.relative(REPO_ROOT, OUTPUT)} (${codes.length} codes, ${meta.size} meta entries)`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
