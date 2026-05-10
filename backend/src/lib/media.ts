import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { env } from "../env.js";

// Media abstraction. Production = GCS signed URLs.
// Dev (no GCS_BUCKET) = local filesystem under backend/.local-media.
//
// Signed URLs are always short-lived. The local fallback emits a /media/
// path that the server serves directly; it is for local development only.

const LOCAL_DIR = path.resolve(process.cwd(), ".local-media");

export interface UploadTicket {
  storageKey: string;
  uploadUrl: string;
  readUrl: string;
  method: "PUT";
  expiresAt: Date;
}

export async function createUploadTicket(
  profileId: string,
  ext: string,
): Promise<UploadTicket> {
  const safeExt = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : "jpg";
  const storageKey = `profiles/${profileId}/${randomUUID()}.${safeExt}`;

  if (env.GCS_BUCKET) {
    // Real GCS signed-URL flow happens here in production.
    // We avoid a hard dependency on @google-cloud/storage in dev so the
    // package installs with zero GCP credentials. In production deploy,
    // add @google-cloud/storage to dependencies and wire it here.
    throw new Error(
      "GCS signed URL generation requires @google-cloud/storage; install in production deployment.",
    );
  }

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

export async function writeLocal(
  storageKey: string,
  body: Buffer,
): Promise<void> {
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
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}
