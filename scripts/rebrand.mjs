#!/usr/bin/env node
// rebrand.mjs — interactive helper for forking OpenMatch under a new
// brand. Walks an operator through the inputs (brand name, bundle id
// prefix, Apple Team ID, hero color) and prints a unified diff of the
// changes it would make. Does NOT apply anything — the operator
// reviews and commits manually.
//
// Files inspected:
//   - ios/project.yml                                    (bundleIdPrefix + PRODUCT_BUNDLE_IDENTIFIER)
//   - ios/OpenMatch/DesignSystem/OMColor.swift           (Aurora Dawn → derived palette)
//   - ios/OpenMatch/Resources/Info.plist                 (CFBundleDisplayName)
//   - admin/app/globals.css                              (--om-* tokens)
//   - admin/app/layout.tsx                               (export const metadata title)
//   - backend/.env.example                               (APP_BASE_URL, sample APPLE_*)
//   - backend/src/services/auth.service.ts               (BRAND_NAME constant)
//   - README.md                                          (title + first paragraph)
//
// Run: node scripts/rebrand.mjs
//      (or `npm run rebrand` if the npm script is wired up)

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ----------------------------------------------------------------------------
// Color derivation
// ----------------------------------------------------------------------------

function hexToRgb(hex) {
  const m = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(m)) {
    throw new Error(`Invalid hex color: ${hex} (expected 6 hex digits, e.g. #5B2B6E or 5b2b6e)`);
  }
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const c = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = ((h % 1) + 1) % 1;
  const f = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: f(hk + 1 / 3) * 255, g: f(hk) * 255, b: f(hk - 1 / 3) * 255 };
}

function shift({ h, s, l }, dh = 0, ds = 0, dl = 0) {
  return { h: h + dh, s: Math.max(0, Math.min(1, s + ds)), l: Math.max(0, Math.min(1, l + dl)) };
}

function derivePalette(heroHex) {
  const heroHsl = rgbToHsl(hexToRgb(heroHex));
  // Light variants — use the hero as plum; rotate hue for the rest.
  // The exact deltas were chosen empirically to keep the palette feeling
  // related to the hero rather than rainbow-pasted.
  const plumLight = rgbToHex(hslToRgb(heroHsl));
  const plumDark = rgbToHex(hslToRgb(shift(heroHsl, 0, -0.1, 0.15)));
  const magentaLight = rgbToHex(hslToRgb(shift(heroHsl, +0.05, +0.05, +0.2)));
  const magentaDark = rgbToHex(hslToRgb(shift(heroHsl, +0.05, +0.1, +0.3)));
  const marigoldLight = rgbToHex(hslToRgb({ h: (heroHsl.h + 0.4) % 1, s: 1, l: 0.6 }));
  const marigoldDark = rgbToHex(hslToRgb({ h: (heroHsl.h + 0.4) % 1, s: 1, l: 0.7 }));
  const periwinkleLight = rgbToHex(hslToRgb({ h: (heroHsl.h - 0.15 + 1) % 1, s: 0.7, l: 0.7 }));
  const periwinkleDark = rgbToHex(hslToRgb({ h: (heroHsl.h - 0.15 + 1) % 1, s: 0.55, l: 0.55 }));
  return {
    plum: { light: plumLight, dark: plumDark },
    magenta: { light: magentaLight, dark: magentaDark },
    marigold: { light: marigoldLight, dark: marigoldDark },
    periwinkle: { light: periwinkleLight, dark: periwinkleDark },
  };
}

// ----------------------------------------------------------------------------
// Diff plumbing
// ----------------------------------------------------------------------------

function unifiedDiff(path, before, after) {
  if (before === after) return null;
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  // Tiny LCS-free diff: line-by-line replace where they differ. Good
  // enough for an operator-facing preview.
  const out = [];
  out.push(`--- ${path}`);
  out.push(`+++ ${path}`);
  const max = Math.max(beforeLines.length, afterLines.length);
  let context = [];
  let hunkStart = -1;
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      context.push(`  ${b ?? ""}`);
      if (context.length > 3 && hunkStart === -1) context.shift();
    } else {
      if (hunkStart === -1) {
        hunkStart = i;
        out.push(`@@ around line ${i + 1} @@`);
        out.push(...context);
      } else {
        out.push(...context);
      }
      context = [];
      if (b !== undefined) out.push(`- ${b}`);
      if (a !== undefined) out.push(`+ ${a}`);
    }
  }
  return out.join("\n");
}

// ----------------------------------------------------------------------------
// Per-file transforms
// ----------------------------------------------------------------------------

async function readMaybe(path) {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function transformProjectYml(src, { bundleIdPrefix }) {
  if (!src) return null;
  return src
    .replace(/^(\s*bundleIdPrefix:\s*)\S+/m, `$1${bundleIdPrefix}`)
    .replace(
      /PRODUCT_BUNDLE_IDENTIFIER:\s*app\.openmatch\.ios\b/g,
      `PRODUCT_BUNDLE_IDENTIFIER: ${bundleIdPrefix}.ios`,
    );
}

function transformInfoPlist(src, { displayName }) {
  if (!src) return null;
  // CFBundleDisplayName is the value on the line after <key>CFBundleDisplayName</key>.
  return src.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${displayName}$2`,
  );
}

function transformOMColor(src, palette) {
  if (!src) return null;
  // Replace the four Aurora Dawn brand lines. Leaves cinnabar / mauve alone.
  const sub = (name) =>
    new RegExp(`static let ${name} = dual\\(light: 0x[0-9A-Fa-f]{6}, dark: 0x[0-9A-Fa-f]{6}\\)`);
  return src
    .replace(
      sub("plum"),
      `static let plum = dual(light: 0x${palette.plum.light.toUpperCase()}, dark: 0x${palette.plum.dark.toUpperCase()})`,
    )
    .replace(
      sub("magenta"),
      `static let magenta = dual(light: 0x${palette.magenta.light.toUpperCase()}, dark: 0x${palette.magenta.dark.toUpperCase()})`,
    )
    .replace(
      sub("marigold"),
      `static let marigold = dual(light: 0x${palette.marigold.light.toUpperCase()}, dark: 0x${palette.marigold.dark.toUpperCase()})`,
    )
    .replace(
      sub("periwinkle"),
      `static let periwinkle = dual(light: 0x${palette.periwinkle.light.toUpperCase()}, dark: 0x${palette.periwinkle.dark.toUpperCase()})`,
    );
}

function transformGlobalsCss(src, palette) {
  if (!src) return null;
  return src
    .replace(/--om-plum:\s*#[0-9a-fA-F]{6};/, `--om-plum: #${palette.plum.light};`)
    .replace(/--om-magenta:\s*#[0-9a-fA-F]{6};/, `--om-magenta: #${palette.magenta.light};`)
    .replace(/--om-marigold:\s*#[0-9a-fA-F]{6};/, `--om-marigold: #${palette.marigold.light};`)
    .replace(
      /--om-periwinkle:\s*#[0-9a-fA-F]{6};/,
      `--om-periwinkle: #${palette.periwinkle.light};`,
    );
}

function transformEnvExample(src, { bundleId, teamId }) {
  if (!src) return null;
  return src
    .replace(/^APPLE_TEAM_ID=.*$/m, `APPLE_TEAM_ID=${teamId}`)
    .replace(/^APPLE_CLIENT_ID=.*$/m, `APPLE_CLIENT_ID=${bundleId}`);
}

function transformAuthService(src, { brandName }) {
  if (!src) return null;
  return src.replace(
    /^export const BRAND_NAME = "[^"]+";$/m,
    `export const BRAND_NAME = "${brandName}";`,
  );
}

function transformReadme(src, { brandName }) {
  if (!src) return null;
  // Replace the first-heading "💞 OpenMatch" only — leave references to
  // "OpenMatch" in the body alone (those describe the upstream project).
  return src.replace(/^# 💞 OpenMatch$/m, `# 💞 ${brandName}`);
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("OpenMatch fork-rebrand wizard");
  console.log("=============================");
  console.log("This will preview a diff against your working tree. Nothing is written.");
  console.log("Press ^C at any prompt to abort.\n");

  const brandName = (await rl.question("Brand name (e.g. Sparkmatch): ")).trim();
  if (!brandName) throw new Error("Brand name is required.");

  const bundleIdPrefix = (await rl.question("Bundle ID prefix (e.g. com.sparkmatch): ")).trim();
  if (!/^[a-z][a-z0-9.-]*[a-z0-9]$/.test(bundleIdPrefix)) {
    throw new Error("Bundle ID prefix should be reverse-DNS, lowercase. e.g. com.sparkmatch");
  }
  const bundleId = `${bundleIdPrefix}.ios`;

  const teamId = (await rl.question("Apple Team ID (10 chars, e.g. ABCDE12345): ")).trim();
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    console.warn(`  ⚠ Apple Team IDs are usually 10 uppercase alphanumerics. Got: ${teamId}`);
  }

  const heroHex = (await rl.question("Hero color hex (e.g. #5B2B6E): ")).trim();
  rl.close();

  const palette = derivePalette(heroHex);
  console.log("\nDerived palette (light variant):");
  for (const [k, v] of Object.entries(palette)) {
    console.log(`  ${k.padEnd(11)} #${v.light}  (dark: #${v.dark})`);
  }
  console.log("");

  const targets = [
    {
      path: "ios/project.yml",
      transform: (s) => transformProjectYml(s, { bundleIdPrefix }),
    },
    {
      path: "ios/OpenMatch/Resources/Info.plist",
      transform: (s) => transformInfoPlist(s, { displayName: brandName }),
    },
    {
      path: "ios/OpenMatch/DesignSystem/OMColor.swift",
      transform: (s) => transformOMColor(s, palette),
    },
    {
      path: "admin/app/globals.css",
      transform: (s) => transformGlobalsCss(s, palette),
    },
    {
      path: "backend/.env.example",
      transform: (s) => transformEnvExample(s, { bundleId, teamId }),
    },
    {
      path: "backend/src/services/auth.service.ts",
      transform: (s) => transformAuthService(s, { brandName }),
    },
    {
      path: "README.md",
      transform: (s) => transformReadme(s, { brandName }),
    },
  ];

  console.log("Proposed changes:\n");
  let anyChanges = false;
  for (const t of targets) {
    const abs = resolve(ROOT, t.path);
    const before = await readMaybe(abs);
    if (before == null) {
      console.log(`  (skipped — not found: ${t.path})`);
      continue;
    }
    const after = t.transform(before);
    if (after == null || after === before) {
      console.log(`  (no change: ${t.path})`);
      continue;
    }
    anyChanges = true;
    const diff = unifiedDiff(relative(ROOT, abs), before, after);
    console.log(diff);
    console.log("");
  }

  if (!anyChanges) {
    console.log(
      "No changes to make. Either the brand markers were already swapped, or the files weren't found.",
    );
    return;
  }

  console.log("─────────────────────────────────────────────────");
  console.log("Nothing was written. To apply manually:");
  console.log("  1. Re-run with `--write` (not yet implemented; intentionally manual).");
  console.log("  2. Or copy the diff hunks into your editor.");
  console.log("");
  console.log("Don't forget the steps the script can't automate:");
  console.log(
    "  - Replace fonts under admin/app/fonts/ and ios/OpenMatch/Resources/Fonts/ (see docs/forking.md §5).",
  );
  console.log("  - Regenerate logo assets: `npm run gen:logo` (see docs/forking.md §6).");
  console.log(
    "  - Update Apple Developer (App ID, Services ID, Push key) — see docs/forking.md §2.",
  );
  console.log("  - Author a privacy policy + ToS from docs/templates/.");
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});
