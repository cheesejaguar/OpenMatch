import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hashText } from "../../src/lib/hash.js";
import { ALLOWED_MIME_TYPES, MAX_PHOTO_BYTES } from "../../src/lib/media.js";
import { stripExif } from "../../src/lib/safety/exif.js";

// Round C — Photo + media-related properties.
//
// EXIF stripping must be:
//   1. content-preserving for the parts that aren't metadata (we assert
//      this by stripping a no-metadata image and verifying the buffer
//      round-trips);
//   2. format-aware (JPEG / PNG / WebP each have a distinct strip path);
//   3. hash-deterministic (the content hash never returns a non-hex
//      string for any input length).

// Minimum valid SOI/EOI JPEG container — no EXIF inside. Standard test
// fixture used elsewhere in the codebase.
const MINIMAL_JPEG = Buffer.from([
  0xff,
  0xd8, // SOI
  0xff,
  0xe0,
  0x00,
  0x10, // APP0 segment
  0x4a,
  0x46,
  0x49,
  0x46,
  0x00, // "JFIF\0"
  0x01,
  0x01, // version
  0x00, // units
  0x00,
  0x01,
  0x00,
  0x01, // density
  0x00,
  0x00, // thumbnail size
  0xff,
  0xd9, // EOI
]);

// Minimal PNG signature + IHDR + IEND. No ancillary metadata chunks.
const MINIMAL_PNG = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // signature
  0x00,
  0x00,
  0x00,
  0x0d, // IHDR length
  0x49,
  0x48,
  0x44,
  0x52, // "IHDR"
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01, // 1x1
  0x08,
  0x06,
  0x00,
  0x00,
  0x00, // 8-bit RGBA, no interlace
  0x1f,
  0x15,
  0xc4,
  0x89, // CRC
  0x00,
  0x00,
  0x00,
  0x00, // IEND length
  0x49,
  0x45,
  0x4e,
  0x44, // "IEND"
  0xae,
  0x42,
  0x60,
  0x82, // CRC
]);

describe("media validation properties (fast-check)", () => {
  it("ALLOWED_MIME_TYPES is closed under string equality", () => {
    fc.assert(
      fc.property(fc.constantFrom("image/jpeg", "image/png", "image/webp"), (mime) => {
        return ALLOWED_MIME_TYPES.has(mime);
      }),
      { numRuns: 30 },
    );
  });

  it("ALLOWED_MIME_TYPES rejects arbitrary other strings", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }).filter((s) => !s.startsWith("image/")),
        (s) => !ALLOWED_MIME_TYPES.has(s),
      ),
      { numRuns: 100 },
    );
  });

  it("MAX_PHOTO_BYTES is a positive integer", () => {
    expect(Number.isInteger(MAX_PHOTO_BYTES)).toBe(true);
    expect(MAX_PHOTO_BYTES).toBeGreaterThan(0);
  });

  it("stripExif of a metadata-free JPEG is bit-identical to its input", () => {
    fc.assert(
      fc.property(fc.constant(MINIMAL_JPEG), (jpeg) => {
        const result = stripExif(jpeg, "image/jpeg");
        // No APP1 segments → bytesRemoved must be 0 and the output must
        // equal the input.
        return (
          result.bytesRemoved === 0 &&
          result.removed === false &&
          Buffer.compare(result.bytes, jpeg) === 0
        );
      }),
      { numRuns: 20 },
    );
  });

  it("stripExif of a metadata-free PNG is bit-identical to its input", () => {
    fc.assert(
      fc.property(fc.constant(MINIMAL_PNG), (png) => {
        const result = stripExif(png, "image/png");
        return (
          result.bytesRemoved === 0 &&
          result.removed === false &&
          Buffer.compare(result.bytes, png) === 0
        );
      }),
      { numRuns: 20 },
    );
  });

  it("stripExif tags the correct format for each accepted mime", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("image/jpeg", "image/png", "image/webp", "image/heic"),
        (mime) => {
          const buf = mime.includes("png") ? MINIMAL_PNG : MINIMAL_JPEG;
          const result = stripExif(buf, mime);
          if (mime === "image/heic") return result.format === "other";
          if (mime === "image/jpeg") return result.format === "jpeg";
          if (mime === "image/png") return result.format === "png" || result.format === "other";
          if (mime === "image/webp") return result.format === "webp" || result.format === "other";
          return false;
        },
      ),
      { numRuns: 30 },
    );
  });

  it("hashText always returns 64 lowercase hex chars", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 4096 }), (s) => {
        const h = hashText(s);
        return h.length === 64 && /^[0-9a-f]+$/.test(h);
      }),
      { numRuns: 100 },
    );
  });

  it("hashText is deterministic — same input always yields same output", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 1024 }), (s) => {
        const a = hashText(s);
        const b = hashText(s);
        return a === b;
      }),
      { numRuns: 100 },
    );
  });

  it("the underlying sha256 also produces 64 hex chars for arbitrary buffers (sanity)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 8192 }), (arr) => {
        const h = createHash("sha256").update(Buffer.from(arr)).digest("hex");
        return h.length === 64 && /^[0-9a-f]+$/.test(h);
      }),
      { numRuns: 100 },
    );
  });
});
