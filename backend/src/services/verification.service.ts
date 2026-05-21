// Trust & safety automation — selfie-pose verification service.
//
// The flow:
//   1. iOS calls `POST /api/v1/verification/selfie/start` and gets back
//      a `{ challengePrompt, challengeNonce }`. The nonce ties the
//      eventual upload to this specific challenge.
//   2. iOS captures the selfie, then PUTs the bytes to
//      `POST /api/v1/verification/selfie` with the nonce.
//   3. Admin sees the request in `admin/app/(app)/moderation/verification/`
//      and approves / rejects. On approval, `User.isAgeVerified` and
//      `Profile.isPhotoVerified` are both flipped.
//
// Phone + ID verification share the model but are not wired to a
// provider here — see `phone-verifier.ts` / `id-verifier.ts`.

import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { uploadProfilePhoto } from "../lib/media.js";

// A small set of poses that are easy to render via SF Symbols on iOS
// and hard to fake with a static photo without effort. The selection
// is deterministic on the server so the admin can verify the prompt
// matches the captured pose.
const POSE_PROMPTS = [
  "Hold up 2 fingers and look right",
  "Touch your right ear with your left hand",
  "Smile with your mouth open and look at the camera",
  "Hold your palm flat and parallel to the camera",
  "Point at the ceiling with your index finger",
  "Tilt your head to the left and raise your right eyebrow",
  "Cover your right eye with your hand",
  "Show a thumbs-up with your left hand",
] as const;

export function pickPosePrompt(seed?: number): string {
  const idx =
    typeof seed === "number" && Number.isFinite(seed)
      ? Math.abs(Math.trunc(seed)) % POSE_PROMPTS.length
      : Math.floor(Math.random() * POSE_PROMPTS.length);
  return POSE_PROMPTS[idx] ?? POSE_PROMPTS[0]!;
}

export function generateNonce(): string {
  return randomBytes(24).toString("base64url");
}

export interface StartSelfieVerificationOpts {
  prisma: PrismaClient;
  userId: string;
}

export async function startSelfieVerification(opts: StartSelfieVerificationOpts): Promise<{
  requestId: string;
  challengePrompt: string;
  challengeNonce: string;
}> {
  // Don't pile up open requests for the same user — expire any older
  // pending ones so the latest is unambiguous.
  await opts.prisma.verificationRequest.updateMany({
    where: { userId: opts.userId, kind: "selfie_pose", status: "pending" },
    data: { status: "expired" },
  });
  const challengePrompt = pickPosePrompt();
  const challengeNonce = generateNonce();
  const row = await opts.prisma.verificationRequest.create({
    data: {
      userId: opts.userId,
      kind: "selfie_pose",
      status: "pending",
      challengePrompt,
      challengeNonce,
    },
  });
  return { requestId: row.id, challengePrompt, challengeNonce };
}

export interface SubmitSelfieVerificationOpts {
  prisma: PrismaClient;
  userId: string;
  challengeNonce: string;
  imageBytes: Buffer;
  contentType: string;
}

export async function submitSelfieVerification(
  opts: SubmitSelfieVerificationOpts,
): Promise<{ ok: true; requestId: string } | { ok: false; reason: string }> {
  const existing = await opts.prisma.verificationRequest.findUnique({
    where: { challengeNonce: opts.challengeNonce },
  });
  if (!existing) return { ok: false, reason: "challenge_not_found" };
  if (existing.userId !== opts.userId) return { ok: false, reason: "challenge_not_found" };
  if (existing.status !== "pending") return { ok: false, reason: "challenge_used" };

  // Persist to the same blob store as profile photos; the storage key
  // is namespaced under the userId so an admin export can include it.
  const uploaded = await uploadProfilePhoto({
    profileId: `verification/${opts.userId}`,
    data: opts.imageBytes,
    contentType: opts.contentType,
  });

  const updated = await opts.prisma.verificationRequest.update({
    where: { id: existing.id },
    data: {
      imageStorageKey: uploaded.storageKey,
      imageContentType: opts.contentType,
      imageBytes: opts.imageBytes.byteLength,
    },
  });
  return { ok: true, requestId: updated.id };
}

export interface DecideVerificationOpts {
  prisma: PrismaClient;
  requestId: string;
  adminUserId: string;
  decision: "approved" | "rejected";
  decisionNote?: string;
}

export async function decideSelfieVerification(
  opts: DecideVerificationOpts,
): Promise<{ ok: true; userId: string } | { ok: false; reason: "not_found" | "already_decided" }> {
  const row = await opts.prisma.verificationRequest.findUnique({
    where: { id: opts.requestId },
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "pending") return { ok: false, reason: "already_decided" };

  await opts.prisma.$transaction(async (tx) => {
    await tx.verificationRequest.update({
      where: { id: row.id },
      data: {
        status: opts.decision,
        reviewerAdminUserId: opts.adminUserId,
        reviewedAt: new Date(),
        decisionNote: opts.decisionNote ?? null,
      },
    });
    if (opts.decision === "approved") {
      await tx.user.update({
        where: { id: row.userId },
        data: { isAgeVerified: true },
      });
      // Profile may not exist yet for a brand-new user, so we use
      // updateMany to no-op rather than throw.
      await tx.profile.updateMany({
        where: { userId: row.userId },
        data: { isPhotoVerified: true, verificationStatus: "verified" },
      });
    }
  });
  return { ok: true, userId: row.userId };
}
