import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { env } from "../env.js";

// Media abstraction.
// - Production: Vercel Blob via client uploads. The server mints a short-lived
//   upload token from `handleUpload`; the client PUTs directly to Blob.
// - Dev (no BLOB_READ_WRITE_TOKEN): local filesystem under backend/.local-media
//   served via a /media/ path. For local development only.

const LOCAL_DIR = path.resolve(process.cwd(), ".local-media");

export interface UploadTicket {
  storageKey: string;
  uploadUrl: string;
  readUrl: string;
  method: "PUT";
  expiresAt: Date;
}

export async function createUploadTicket(profileId: string, ext: string): Promise<UploadTicket> {
  const safeExt = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : "jpg";
  const storageKey = `profiles/${profileId}/${randomUUID()}.${safeExt}`;

  await fs.mkdir(path.dirname(path.join(LOCAL_DIR, storageKey)), {
    recursive: true,
  });
  return {
    storageKey,
    uploadUrl: `/media/upload/${encodeURIComponent(storageKey)}`,
    readUrl: `/media/${encodeURIComponent(storageKey)}`,
    method: "PUT",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
}

export async function writeLocal(storageKey: string, body: Buffer): Promise<void> {
  const full = path.join(LOCAL_DIR, storageKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
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

// Vercel Blob client-upload handshake. The browser/iOS app calls
// POST /api/v1/profile/photos/upload-url with the filename; `handleUpload`
// validates the request, issues a one-shot upload token, and (on completion)
// fires onUploadCompleted so we can persist the ProfilePhoto row.
export async function handlePhotoUpload(args: {
  body: HandleUploadBody;
  request: Request;
  userId: string;
  onCompleted: (storageKey: string, cdnUrl: string) => Promise<void>;
}) {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN not configured");
  }
  return handleUpload({
    body: args.body,
    request: args.request,
    onBeforeGenerateToken: async (pathname) => {
      const safe = /\.(jpe?g|png|webp|heic|heif)$/i.test(pathname);
      if (!safe) throw new Error("invalid_extension");
      return {
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
        maximumSizeInBytes: 10 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ userId: args.userId, requestedAt: Date.now() }),
      };
    },
    onUploadCompleted: async ({ blob }) => {
      await args.onCompleted(blob.pathname, blob.url);
    },
  });
}
