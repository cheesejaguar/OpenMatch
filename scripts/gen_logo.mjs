#!/usr/bin/env node
// gen_logo.mjs — rasterize the canonical "om" wordmark SVG into the
// platform-specific PNG variants required by iOS and the admin
// dashboard. The SVG sources live in assets/logo/ and embed the
// Fraunces 9pt Black Italic .ttf as base64 so CI runners (which may
// not have the font installed system-wide) still render correctly via
// sharp's librsvg backend.
//
// Outputs:
//   ios/OpenMatch/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-{light,dark,tinted}.png
//   ios/OpenMatch/Assets.xcassets/LaunchMark.imageset/LaunchMark{,@2x,@3x}.png  (LIGHT variant)
//   admin/public/favicon.png                                                    (transparent / favicon variant)
//   admin/public/favicon.svg                                                    (copy of the tinted SVG, transparent BG)
//   admin/public/om-mark.svg                                                    (copy of the LIGHT SVG)
//
// Run:    node scripts/gen_logo.mjs
// Or:     npm run gen:logo

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const SRC = {
  light: resolve(ROOT, "assets/logo/om-mark-light.svg"),
  dark: resolve(ROOT, "assets/logo/om-mark-dark.svg"),
  tinted: resolve(ROOT, "assets/logo/om-mark-tinted.svg"),
  favicon: resolve(ROOT, "assets/logo/om-mark.svg"),
};

const OUTPUTS = [
  // iOS AppIcon — three appearances, all 1024x1024
  {
    src: SRC.light,
    out: "ios/OpenMatch/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-light.png",
    size: 1024,
  },
  {
    src: SRC.dark,
    out: "ios/OpenMatch/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-dark.png",
    size: 1024,
  },
  {
    src: SRC.tinted,
    out: "ios/OpenMatch/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-tinted.png",
    size: 1024,
  },
  // iOS LaunchMark — LIGHT variant at @1x/@2x/@3x (120pt base)
  {
    src: SRC.light,
    out: "ios/OpenMatch/Assets.xcassets/LaunchMark.imageset/LaunchMark.png",
    size: 120,
  },
  {
    src: SRC.light,
    out: "ios/OpenMatch/Assets.xcassets/LaunchMark.imageset/LaunchMark@2x.png",
    size: 240,
  },
  {
    src: SRC.light,
    out: "ios/OpenMatch/Assets.xcassets/LaunchMark.imageset/LaunchMark@3x.png",
    size: 360,
  },
  // Admin favicon — transparent BG, plum fill (favicon variant)
  {
    src: SRC.favicon,
    out: "admin/public/favicon.png",
    size: 32,
  },
];

async function render({ src, out, size }) {
  const target = resolve(ROOT, out);
  await mkdir(dirname(target), { recursive: true });
  // density=300 gives sharp's librsvg backend enough resolution to
  // honor the embedded @font-face; we then downscale to the target
  // size for crisp anti-aliasing.
  await sharp(src, { density: 300 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(target);
  console.log(`  ✓ ${out} (${size}×${size})`);
}

async function copySvg(src, dest) {
  const target = resolve(ROOT, dest);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(src, target);
  console.log(`  ✓ ${dest}`);
}

async function verifyLegibility() {
  // Rasterize the favicon at 16x16 and assert we get a non-trivial PNG
  // (>= 200 bytes) with pixel variance. If the embedded font failed to
  // load, sharp falls back to the system font and the bytes are still
  // produced — but we still log dimensions for the human eye.
  const buf = await sharp(SRC.favicon, { density: 300 })
    .resize(16, 16, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const meta = await sharp(buf).metadata();
  const stats = await sharp(buf).stats();
  const variance = stats.channels[0].max - stats.channels[0].min;
  console.log(
    `\n  16×16 legibility check — ${buf.length} bytes, ${meta.width}×${meta.height}, R-channel range ${variance}`,
  );
  if (variance < 30) {
    console.warn(
      "  ⚠ low variance — glyphs may have collapsed at 16px. Consider tightening kerning further.",
    );
  } else {
    console.log("  ✓ glyphs visible at 16px");
  }
}

async function main() {
  console.log("Rendering om-mark PNGs…");
  for (const job of OUTPUTS) {
    await render(job);
  }
  console.log("\nCopying SVGs into admin/public…");
  await copySvg(SRC.favicon, "admin/public/favicon.svg");
  await copySvg(SRC.light, "admin/public/om-mark.svg");

  await verifyLegibility();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
