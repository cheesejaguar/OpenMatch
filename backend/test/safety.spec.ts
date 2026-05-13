import { describe, expect, it } from "vitest";
import { stripJpegExif } from "../src/lib/safety/exif.js";
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
