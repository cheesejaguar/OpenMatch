import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { del, put } from "@vercel/blob";
import { env } from "../env.js";
import { stripExif } from "./safety/exif.js";

// Media abstraction.
// - Production: Vercel Blob via server-side `put()`. iOS sends the (already
//   downscaled) image bytes as multipart/form-data; the server uploads to
//   Blob and persists a ProfilePhoto row.
// - Dev (no BLOB_READ_WRITE_TOKEN): local filesystem under backend/.local-media
//   served via a /media/ path. For local development only.
//
// Why server-mediated rather than the @vercel/blob/client handshake: the
// client-upload protocol is browser-first and reverse-engineering it from
// Swift means depending on undocumented wire formats. `put()` is part of
// the stable public SDK API. The 4.5MB Vercel function body limit is more
// than enough for an on-device-downscaled 1080px JPEG (~400KB-1.5MB).
//
// Privacy hardening (SEV-N16 / SEV-M7): the raw Vercel Blob URL is a
// non-guessable but immutable bearer token. We treat it as a server-only
// secret — the `cdnUrl` column persists it so the server can re-fetch
// or `del()` later, but the URL is NEVER returned to API clients. iOS
// asks the server for a short-lived signed URL via
// `GET /api/v1/photos/:id/url`, which performs authorization checks
// (owner / matched / not-blocked / admin) and returns a JWT scoped to
// the `GET /api/v1/photos/:id/serve` proxy endpoint. The proxy revalidates
// the JWT and streams the blob bytes back. This adds two server hops per
// thumbnail load but means:
//   1. A blocked user cannot view their blocker's photos even with a stale
//      cached URL.
//   2. Revoking access (unmatch, block, delete) takes effect at the next
//      URL fetch — at worst the signed-URL TTL later (5 min).
//   3. The blob URL itself never appears in client storage / proxies.
// `@vercel/blob` v0.23 only supports `access: "public"`; private blobs are
// on the SDK roadmap. When private blobs ship, we can drop the proxy and
// mint Blob-signed download URLs directly — the API surface
// (`/photos/:id/url`) stays the same so iOS doesn't change.

const LOCAL_DIR = path.resolve(process.cwd(), ".local-media");

// We accept JPEG / PNG / WebP because we have server-side EXIF strippers
// for each. HEIC/HEIF were previously accepted but rejected here now:
// stripping requires a full ISO BMFF box parser we don't ship, and the
// iOS client already re-encodes captured HEIC images to JPEG before
// upload (ImageUploader.swift). Accepting a format we cannot strip
// would be a silent privacy regression.
export const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export interface UploadedPhoto {
  storageKey: string;
  cdnUrl: string;
}

function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

// SEV-V16 — sniff the upload bytes against the magic-byte signatures
// we accept. The previous trust-the-client-MIME path let a polyglot
// PDF / HTML payload be stored with `Content-Type: image/jpeg`; while
// most modern browsers won't render mis-typed content, any consumer
// that does (a future admin preview, an in-app webview, an image
// resizer that decodes-and-re-encodes) would inherit the
// misclassification. The stripExif dispatcher already detects format
// via signature; we now reject when the claimed MIME doesn't match the
// detected format instead of silently passing the original bytes
// through.
function detectImageFormat(buf: Buffer): "jpeg" | "png" | "webp" | "other" {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return "other";
}

const MIME_TO_FORMAT: Record<string, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function uploadProfilePhoto(args: {
  profileId: string;
  data: Buffer;
  contentType: string;
}): Promise<UploadedPhoto> {
  if (!ALLOWED_MIME_TYPES.has(args.contentType)) {
    throw Object.assign(new Error("unsupported_media_type"), { statusCode: 415 });
  }
  if (args.data.byteLength > MAX_PHOTO_BYTES) {
    throw Object.assign(new Error("payload_too_large"), { statusCode: 413 });
  }

  // SEV-V16 — reject when the bytes don't match the claimed
  // content-type. Closes the "PNG / WebP labelled but actually a
  // polyglot" upload primitive before we hand bytes to Vercel Blob's
  // CDN with an attacker-controlled Content-Type.
  const detected = detectImageFormat(args.data);
  const expected = MIME_TO_FORMAT[args.contentType];
  if (!expected || detected !== expected) {
    throw Object.assign(new Error("content_type_mismatch"), { statusCode: 415 });
  }

  // Defence-in-depth: strip EXIF (incl. GPS) on the server even though
  // the iOS client re-encodes before upload. The dispatcher covers
  // JPEG, PNG (eXIf / tEXt / iTXt / zTXt chunks), and WebP (EXIF + XMP
  // chunks within the RIFF container).
  const stripped = stripExif(args.data, args.contentType);
  const bytes = stripped.bytes;

  const storageKey = `profiles/${args.profileId}/${randomUUID()}.${extForMime(args.contentType)}`;

  if (env.BLOB_READ_WRITE_TOKEN) {
    // `access: "public"` is the only value @vercel/blob@^0.23 accepts; the
    // SDK comment notes private blobs are planned. We compensate at the API
    // layer by never returning blob.url to clients and gating all reads
    // behind the photos/:id/url -> /serve proxy.
    const blob = await put(storageKey, bytes, {
      access: "public",
      contentType: args.contentType,
      token: env.BLOB_READ_WRITE_TOKEN,
    });
    return { storageKey: blob.pathname, cdnUrl: blob.url };
  }

  // Local-dev fallback. The cdnUrl is a relative path served by the same
  // backend in dev — production never reaches this branch because
  // BLOB_READ_WRITE_TOKEN is set.
  const full = path.join(LOCAL_DIR, storageKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
  return {
    storageKey,
    cdnUrl: `/media/${encodeURIComponent(storageKey)}`,
  };
}

export interface PhotoDeleteResult {
  ok: boolean;
  error?: string;
}

// Hard-delete the underlying blob. Returns success/failure rather than
// swallowing errors silently so the deletion-purge worker can record the
// outcome and retry. Local-fs deletes are treated as success even if the
// file is already missing.
export async function deleteProfilePhoto(
  storageKey: string,
  cdnUrl: string,
): Promise<PhotoDeleteResult> {
  if (env.BLOB_READ_WRITE_TOKEN) {
    try {
      await del(cdnUrl, { token: env.BLOB_READ_WRITE_TOKEN });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const full = path.join(LOCAL_DIR, storageKey);
  try {
    await fs.unlink(full);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      return { ok: false, error: code ?? "unlink_failed" };
    }
  }
  return { ok: true };
}

export async function readLocal(storageKey: string): Promise<Buffer | null> {
  const full = path.join(LOCAL_DIR, storageKey);
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}

// Server-side fetch of the blob bytes for the proxy endpoint. Used by
// `GET /api/v1/photos/:id/serve` after the JWT has been validated.
// Returns null when the blob is missing or the fetch fails so the route
// can render a 404.
//
// PERF-X2 — historically this awaited the full `arrayBuffer()` before
// returning. For our 4MB photo cap that was a full per-request memcpy
// + an event-loop pause while the whole body landed in the function's
// heap. Fluid Compute (Node 24) handles Web ReadableStream natively;
// the previous comment blaming Edge runtime constraints is obsolete.
//
// The streaming variant `fetchPhotoStream` returns the upstream
// WHATWG `ReadableStream` + content metadata; the route hands it to
// `reply.send` which pipes it through to the client. The buffer-based
// `fetchPhotoBytes` is retained for callers that need the bytes
// in-process (currently none — kept for backward compat).
export interface PhotoBytes {
  bytes: Buffer;
  contentType: string;
}

export interface PhotoStream {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  // For PERF-X3 we may want the upstream ETag forwarded directly.
  etag: string | null;
  lastModified: string | null;
  // Vercel Blob supports Range requests natively; preserved here so the
  // route can propagate 206 Partial Content for resumable downloads.
  acceptRanges: string | null;
  status: number;
}

export async function fetchPhotoStream(
  storageKey: string,
  cdnUrl: string,
  init?: { range?: string; ifNoneMatch?: string },
): Promise<PhotoStream | null> {
  if (env.BLOB_READ_WRITE_TOKEN) {
    try {
      const headers: Record<string, string> = {};
      if (init?.range) headers.range = init.range;
      if (init?.ifNoneMatch) headers["if-none-match"] = init.ifNoneMatch;
      const res = await fetch(cdnUrl, { headers });
      // 304/206 are non-200 statuses we still want to surface so the
      // route can pass them through. 4xx/5xx upstream → null → route
      // renders PHOTO_NOT_FOUND.
      if (res.status >= 400) return null;
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const contentLengthRaw = res.headers.get("content-length");
      const contentLength = contentLengthRaw === null ? null : Number(contentLengthRaw);
      // Some upstreams (esp. CDN edges) return a body of `null` on 304;
      // the route handles that by emitting an empty 304 reply.
      const body = res.body;
      if (!body) {
        // 304 with no body is a legitimate response — surface it so the
        // route can short-circuit. Otherwise treat as fetch failure.
        if (res.status === 304) {
          return {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
            contentType,
            contentLength,
            etag: res.headers.get("etag"),
            lastModified: res.headers.get("last-modified"),
            acceptRanges: res.headers.get("accept-ranges"),
            status: 304,
          };
        }
        return null;
      }
      return {
        body,
        contentType,
        contentLength: Number.isFinite(contentLength) ? contentLength : null,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        acceptRanges: res.headers.get("accept-ranges"),
        status: res.status,
      };
    } catch {
      return null;
    }
  }
  const buf = await readLocal(storageKey);
  if (!buf) return null;
  // Best-effort content-type from extension.
  const ext = path.extname(storageKey).toLowerCase();
  const contentType =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "application/octet-stream";
  // Wrap the local buffer as a ReadableStream for shape parity. The
  // dev path doesn't need streaming for performance but we keep the
  // return type uniform so the route logic stays single-branched.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
  return {
    body: stream,
    contentType,
    contentLength: buf.byteLength,
    etag: null,
    lastModified: null,
    acceptRanges: null,
    status: 200,
  };
}

export async function fetchPhotoBytes(
  storageKey: string,
  cdnUrl: string,
): Promise<PhotoBytes | null> {
  if (env.BLOB_READ_WRITE_TOKEN) {
    try {
      const res = await fetch(cdnUrl);
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const buf = Buffer.from(await res.arrayBuffer());
      return { bytes: buf, contentType };
    } catch {
      return null;
    }
  }
  const buf = await readLocal(storageKey);
  if (!buf) return null;
  // Best-effort content-type from extension.
  const ext = path.extname(storageKey).toLowerCase();
  const contentType =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "application/octet-stream";
  return { bytes: buf, contentType };
}

// hashIdentity has moved to lib/hash.ts; re-export so any out-of-tree
// import paths continue to resolve.
export { hashIdentity } from "./hash.js";
