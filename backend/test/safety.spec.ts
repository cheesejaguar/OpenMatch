import { describe, expect, it } from "vitest";
import { stripExif, stripJpegExif, stripPngExif, stripWebpExif } from "../src/lib/safety/exif.js";
import { evaluateScamRules } from "../src/services/safety/scam-rules.js";

describe("stripJpegExif", () => {
  it("passes non-JPEG through unchanged", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = stripJpegExif(png);
    expect(r.removed).toBe(false);
    expect(r.bytes).toEqual(png);
  });

  it("preserves a JPEG with no EXIF segment", () => {
    // Minimal JPEG: SOI + APP0 (JFIF) + DQT + SOF0 + DHT + SOS + EOI.
    // We build a tiny synthetic JPEG with only a JFIF APP0 segment.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]), // SOI
      Buffer.from([0xff, 0xe0]), // APP0
      Buffer.from([0x00, 0x10]), // length 16
      Buffer.from("JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00", "binary"),
      Buffer.from([0xff, 0xd9]), // EOI
    ]);
    const r = stripJpegExif(jpeg);
    expect(r.removed).toBe(false);
    expect(r.bytes.length).toBe(jpeg.length);
  });

  it("removes an APP1/EXIF segment from a JPEG", () => {
    const exifPayload = Buffer.alloc(30, 0x00);
    const lengthBytes = Buffer.from([0x00, 0x20]); // 32 (=30 + 2 length bytes)
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]), // SOI
      Buffer.from([0xff, 0xe1]), // APP1
      lengthBytes,
      exifPayload,
      Buffer.from([0xff, 0xd9]), // EOI
    ]);
    const r = stripJpegExif(jpeg);
    expect(r.removed).toBe(true);
    expect(r.bytesRemoved).toBeGreaterThan(0);
    // After stripping, we should be left with SOI + EOI only.
    expect(r.bytes.length).toBe(4);
    expect(r.bytes[0]).toBe(0xff);
    expect(r.bytes[1]).toBe(0xd8);
    expect(r.bytes[2]).toBe(0xff);
    expect(r.bytes[3]).toBe(0xd9);
  });

  it("removes multiple APP1 segments", () => {
    const exif1 = Buffer.concat([
      Buffer.from([0xff, 0xe1, 0x00, 0x06]),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);
    const exif2 = Buffer.concat([
      Buffer.from([0xff, 0xe1, 0x00, 0x06]),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      exif1,
      exif2,
      Buffer.from([0xff, 0xd9]),
    ]);
    const r = stripJpegExif(jpeg);
    expect(r.removed).toBe(true);
    expect(r.bytes.length).toBe(4);
  });
});

describe("evaluateScamRules", () => {
  it("returns no signals for a clean profile", () => {
    expect(
      evaluateScamRules({
        userId: "u1",
        recentMessages: [{ body: "hey, how's your week?", createdAt: new Date() }],
        profileBio: "love hiking and dogs",
      }),
    ).toEqual([]);
  });

  it("flags rapid off-platform push by timer", () => {
    const signals = evaluateScamRules({
      userId: "u1",
      timeToFirstOffPlatformPushSec: 60,
    });
    expect(signals.find((s) => s.kind === "rapid_offplatform_push")).toBeTruthy();
  });

  it("flags off-platform messaging mentions", () => {
    const signals = evaluateScamRules({
      userId: "u1",
      recentMessages: [{ body: "let's chat on whatsapp", createdAt: new Date() }],
    });
    expect(signals.find((s) => s.kind === "rapid_offplatform_push")).toBeTruthy();
  });

  it("flags payment solicitation", () => {
    const signals = evaluateScamRules({
      userId: "u1",
      recentMessages: [{ body: "can you send me a small amount on Venmo", createdAt: new Date() }],
    });
    expect(signals.find((s) => s.kind === "payment_solicitation")).toBeTruthy();
  });

  it("escalates to romance_scam_pattern when off-platform + payment combine", () => {
    const signals = evaluateScamRules({
      userId: "u1",
      recentMessages: [
        { body: "let's talk on telegram", createdAt: new Date() },
        { body: "btw can you cashapp me a little to help out", createdAt: new Date() },
      ],
    });
    expect(signals.find((s) => s.kind === "romance_scam_pattern")?.score).toBeGreaterThanOrEqual(
      90,
    );
  });

  it("flags geo mismatch", () => {
    const signals = evaluateScamRules({
      userId: "u1",
      signupCountry: "NG",
      declaredCountry: "US",
    });
    expect(signals.find((s) => s.kind === "geo_mismatch")).toBeTruthy();
  });
});

describe("stripPngExif", () => {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Build a chunk: [length:4 BE][type:4 ASCII][data:length][crc:4]
  function chunk(type: string, data: Buffer): Buffer {
    const out = Buffer.alloc(4 + 4 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    // CRC isn't validated by our stripper; zero is fine.
    return out;
  }

  it("passes non-PNG through unchanged", () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    const r = stripPngExif(buf);
    expect(r.removed).toBe(false);
    expect(r.bytes).toEqual(buf);
  });

  it("removes an eXIf chunk", () => {
    const png = Buffer.concat([
      PNG_SIG,
      chunk("IHDR", Buffer.alloc(13)),
      chunk("eXIf", Buffer.from("GPS_LEAK")),
      chunk("IDAT", Buffer.alloc(8)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const r = stripPngExif(png);
    expect(r.removed).toBe(true);
    expect(r.bytesRemoved).toBeGreaterThan(0);
    expect(r.bytes.includes(Buffer.from("GPS_LEAK"))).toBe(false);
  });

  it("removes tEXt / iTXt / zTXt text chunks", () => {
    const png = Buffer.concat([
      PNG_SIG,
      chunk("IHDR", Buffer.alloc(13)),
      chunk("tEXt", Buffer.from("Comment\0GPS Lat=37.7749")),
      chunk("iTXt", Buffer.from("Description\0\0\0\0\0secret")),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const r = stripPngExif(png);
    expect(r.removed).toBe(true);
    expect(r.bytes.includes(Buffer.from("GPS Lat="))).toBe(false);
    expect(r.bytes.includes(Buffer.from("secret"))).toBe(false);
  });
});

describe("stripWebpExif", () => {
  function webp(chunks: Array<{ fourcc: string; data: Buffer }>): Buffer {
    const inner: Buffer[] = [];
    for (const c of chunks) {
      const padded = c.data.length + (c.data.length & 1);
      const out = Buffer.alloc(8 + padded);
      out.write(c.fourcc, 0, "ascii");
      out.writeUInt32LE(c.data.length, 4);
      c.data.copy(out, 8);
      inner.push(out);
    }
    const body = Buffer.concat(inner);
    const file = Buffer.alloc(12 + body.length);
    file.write("RIFF", 0, "ascii");
    file.writeUInt32LE(4 + body.length, 4);
    file.write("WEBP", 8, "ascii");
    body.copy(file, 12);
    return file;
  }

  it("passes non-WebP through unchanged", () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    const r = stripWebpExif(buf);
    expect(r.removed).toBe(false);
    expect(r.bytes).toEqual(buf);
  });

  it("removes EXIF and XMP chunks but keeps VP8L", () => {
    const file = webp([
      { fourcc: "VP8L", data: Buffer.from([0x2f, 0, 0, 0]) },
      { fourcc: "EXIF", data: Buffer.from("GPS_LEAK") },
      { fourcc: "XMP ", data: Buffer.from("xmpsecret") },
    ]);
    const r = stripWebpExif(file);
    expect(r.removed).toBe(true);
    expect(r.bytes.includes(Buffer.from("GPS_LEAK"))).toBe(false);
    expect(r.bytes.includes(Buffer.from("xmpsecret"))).toBe(false);
    // VP8L kept; the structure should still be a valid RIFF/WEBP.
    expect(r.bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(r.bytes.toString("ascii", 8, 12)).toBe("WEBP");
  });

  it("recomputes the RIFF length after removal", () => {
    const file = webp([
      { fourcc: "VP8L", data: Buffer.from([0x2f, 0, 0, 0]) },
      { fourcc: "EXIF", data: Buffer.alloc(100) },
    ]);
    const r = stripWebpExif(file);
    const declared = r.bytes.readUInt32LE(4);
    // RIFF size should equal "WEBP" + remaining chunks = 4 + (8 + 4) = 16
    expect(declared).toBe(16);
  });
});

describe("stripExif dispatcher", () => {
  it("returns format=other for unknown content types", () => {
    const r = stripExif(Buffer.from([0, 1, 2]), "image/avif");
    expect(r.format).toBe("other");
    expect(r.removed).toBe(false);
  });

  it("dispatches by content type", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xd9])]);
    expect(stripExif(jpeg, "image/jpeg").format).toBe("jpeg");
    expect(stripExif(jpeg, "image/png").format).toBe("other"); // wrong magic
  });
});
