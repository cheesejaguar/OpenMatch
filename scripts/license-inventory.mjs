#!/usr/bin/env node
// License inventory for OpenMatch.
//
// Walks every package in node_modules (deduplicated by name@version),
// reads `license` / `licenses` from each package.json, and enforces a
// SPDX allow-list. Designed to be run in CI without extra deps.
//
// Allow-list: open-source-permissive only — Apache-2.0, MIT, BSD-*, ISC,
// 0BSD, Unlicense, CC0, CC-BY, Zlib, and Python-style PSF. Copyleft
// (GPL/LGPL/AGPL/MPL/EPL) is flagged: the project ships closed-source
// servers and a permissively licensed mobile app, and a copyleft
// transitive can carry surprises into the deployable.
//
// Run with: node scripts/license-inventory.mjs [--json] [--write report]
//
// docs/legal/compliance-roadmap.md §1.9

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ALLOW = new Set([
  "Apache-2.0",
  "MIT",
  "MIT-0",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD-3-Clause-Clear",
  "BSD-4-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "Zlib",
  "Python-2.0",
  "PSF-2.0",
  "WTFPL",
  "Artistic-2.0",
  "BlueOak-1.0.0",
]);

// Explicitly flagged. Not necessarily a hard fail (we may use a service
// that pulls in MPL utilities), but worth a deliberate review.
const REVIEW = new Set([
  "MPL-2.0",
  "EPL-2.0",
  "EPL-1.0",
  "LGPL-2.0",
  "LGPL-2.0-only",
  "LGPL-2.0-or-later",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "CDDL-1.0",
  "CDDL-1.1",
]);

const FORBID = new Set([
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-3.0",
  "SSPL-1.0",
  "BUSL-1.1",
  "Commons-Clause",
  "Elastic-2.0",
]);

function readJsonSafe(p) {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function normalise(license) {
  if (!license) return "UNKNOWN";
  if (typeof license === "string") return license;
  if (Array.isArray(license)) {
    // Old-style { licenses: [{ type: "MIT" }] }
    return license.map((l) => (l && l.type) || "UNKNOWN").join(" OR ");
  }
  if (typeof license === "object" && license.type) return license.type;
  return "UNKNOWN";
}

// Manual classifications for transitive packages whose package.json
// omits the `license` field but whose LICENSE file is a known
// permissive licence. Add a row here, with a reference, after
// inspecting the LICENSE file in node_modules.
const MANUAL_OVERRIDES = new Map([
  ["seq-queue@0.0.5", "MIT"], // LICENSE file is verbatim MIT, no SPDX field.
]);

// Decompose an SPDX expression like "(MIT OR Apache-2.0)" into a set
// of license tokens. We treat any-of-permissive as permissive.
function tokens(spdx) {
  return spdx
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function classify(spdx) {
  const ts = tokens(spdx);
  if (ts.length === 0) return "unknown";
  if (ts.some((t) => ALLOW.has(t))) return "allow";
  if (ts.some((t) => FORBID.has(t))) return "forbid";
  if (ts.some((t) => REVIEW.has(t))) return "review";
  return "unknown";
}

function walk(dir, out = new Map()) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".bin" || entry.name === ".cache") continue;
    const full = join(dir, entry.name);
    if (entry.name.startsWith("@")) {
      walk(full, out);
      continue;
    }
    // A package directory: read package.json if present.
    const pkgPath = join(full, "package.json");
    let st;
    try {
      st = statSync(pkgPath);
    } catch {
      st = null;
    }
    if (st?.isFile()) {
      const pkg = readJsonSafe(pkgPath);
      if (pkg && pkg.name) {
        const key = `${pkg.name}@${pkg.version}`;
        if (!out.has(key)) {
          const spdx = MANUAL_OVERRIDES.get(key) ?? normalise(pkg.license ?? pkg.licenses);
          out.set(key, {
            name: pkg.name,
            version: pkg.version,
            license: spdx,
            classification: classify(spdx),
            // Path is informational only.
            path: full.slice(ROOT.length + 1),
          });
        }
      }
      // Recurse into nested node_modules for hoisted-but-not-flat trees.
      const nested = join(full, "node_modules");
      try {
        if (statSync(nested).isDirectory()) walk(nested, out);
      } catch {
        // no nested
      }
    }
  }
  return out;
}

const inventory = walk(join(ROOT, "node_modules"));

const summary = { allow: 0, review: 0, forbid: 0, unknown: 0 };
const offenders = [];
for (const v of inventory.values()) {
  summary[v.classification] = (summary[v.classification] ?? 0) + 1;
  if (v.classification === "forbid" || v.classification === "unknown") {
    offenders.push(v);
  }
}

const wantJson = process.argv.includes("--json");
const writeIdx = process.argv.indexOf("--write");
const writePath = writeIdx >= 0 ? process.argv[writeIdx + 1] : null;

const report = {
  generatedAt: new Date().toISOString(),
  totals: { packages: inventory.size, ...summary },
  offenders: offenders.sort((a, b) => a.name.localeCompare(b.name)),
};

if (writePath) {
  writeFileSync(writePath, JSON.stringify(report, null, 2));
}

if (wantJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `License inventory: ${inventory.size} packages — ` +
      `${summary.allow ?? 0} allow, ${summary.review ?? 0} review, ` +
      `${summary.forbid ?? 0} forbid, ${summary.unknown ?? 0} unknown\n`,
  );
  if (offenders.length > 0) {
    process.stdout.write("\nOffenders (forbid + unknown):\n");
    for (const o of offenders) {
      process.stdout.write(
        `  ${o.classification.padEnd(7)} ${o.license.padEnd(40)} ${o.name}@${o.version}\n`,
      );
    }
  }
}

// CI exit code:
//   0 — clean
//   1 — at least one forbidden license
//   2 — only unknowns (review needed; not a hard fail today)
if (summary.forbid > 0) process.exit(1);
if (summary.unknown > 0) process.exit(2);
process.exit(0);
