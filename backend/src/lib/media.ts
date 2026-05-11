import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { del, put } from "@vercel/blob";
import { env } from "../env.js";

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

const LOCAL_DIR = path.resolve(process.cwd(), ".local-media");

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

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
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
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
  const storageKey = `profiles/${args.profileId}/${randomUUID()}.${extForMime(args.contentType)}`;

  if (env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(storageKey, args.data, {
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
  await fs.writeFile(full, args.data);
  return {
    storageKey,
    cdnUrl: `/media/${encodeURIComponent(storageKey)}`,
  };
}

export async function deleteProfilePhoto(storageKey: string, cdnUrl: string): Promise<void> {
  if (env.BLOB_READ_WRITE_TOKEN) {
    // Vercel Blob's `del` takes the public URL (or storageKey on newer SDKs).
    // Best-effort: a failed delete should not block removing the DB row,
    // since orphan blobs are cheaper than orphan DB rows.
    try {
      await del(cdnUrl, { token: env.BLOB_READ_WRITE_TOKEN });
    } catch {
      // intentionally swallowed
    }
    return;
  }
  const full = path.join(LOCAL_DIR, storageKey);
  await fs.unlink(full).catch(() => undefined);
}

export async function readLocal(storageKey: string): Promise<Buffer | null> {
  const full = path.join(LOCAL_DIR, storageKey);
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}

export function hashIdentity(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
