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
// can render a 404. Streams are deliberately bypassed in favour of the
// existing buffer-based contract — these are profile thumbnails (~1.5MB
// each), and the proxy is invoked over the function execution model
// where streaming responses would force a different runtime config.
export interface PhotoBytes {
  bytes: Buffer;
  contentType: string;
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
