import { describe, expect, it } from "vitest";
import { uploadProfilePhoto } from "../src/lib/media.js";

// SEV-V16 — uploadProfilePhoto rejects byte / content-type mismatches.
//
// The route already gates on the claimed MIME against
// ALLOWED_MIME_TYPES, so the bypass path was "claim a permitted MIME
// and send polyglot bytes". The fixed implementation reads the magic
// bytes and refuses with `content_type_mismatch` (HTTP 415) when they
// don't match the claimed type, before Vercel Blob ever sees the
// upload.

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_HEADER = Buffer.from("%PDF-1.7\n", "ascii");

async function expectReject(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
    throw new Error("did_not_reject");
  } catch (err) {
    return err as Error;
  }
}

describe("SEV-V16 — uploadProfilePhoto magic-byte verification", () => {
  it("rejects PDF bytes claiming image/jpeg", async () => {
    const err = await expectReject(() =>
      uploadProfilePhoto({
        profileId: "profile-1",
        data: PDF_HEADER,
        contentType: "image/jpeg",
      }),
    );
    expect(err.message).toBe("content_type_mismatch");
    expect((err as { statusCode?: number }).statusCode).toBe(415);
  });

  it("rejects PNG bytes claiming image/jpeg", async () => {
    const err = await expectReject(() =>
      uploadProfilePhoto({
        profileId: "profile-1",
        data: PNG_HEADER,
        contentType: "image/jpeg",
      }),
    );
    expect(err.message).toBe("content_type_mismatch");
  });

  it("accepts a matching JPEG header (legacy local-FS path)", async () => {
    // No BLOB_READ_WRITE_TOKEN configured in test, so this goes via
    // the local-FS branch — we only care that the magic-byte check
    // doesn't reject.
    const out = await uploadProfilePhoto({
      profileId: "profile-2",
      data: JPEG_HEADER,
      contentType: "image/jpeg",
    });
    expect(out.storageKey).toMatch(/profiles\/profile-2\/.+\.jpg$/);
  });
});
