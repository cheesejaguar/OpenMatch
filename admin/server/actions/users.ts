"use server";

import { revalidatePath } from "next/cache";
import { type AdminApiError, adminFetch } from "../../lib/api/admin-client";
import { ErrorCodes } from "../../lib/api/error-codes";

type ActionResult = { ok: true } | { ok: false; status: number; error: AdminApiError };

const REASON_CODES = [
  "harassment",
  "hate_or_discrimination",
  "threats_or_violence",
  "sexual_content",
  "scam_or_spam",
  "fake_profile",
  "underage",
  "impersonation",
  "offensive_profile",
  "off_platform_solicitation",
  "ban_evasion",
  "other",
] as const;

type ReasonCode = (typeof REASON_CODES)[number];

function asReasonCode(v: FormDataEntryValue | null): ReasonCode {
  const s = String(v ?? "other");
  return (REASON_CODES as readonly string[]).includes(s) ? (s as ReasonCode) : "other";
}

export async function banUserAction(userId: string, formData: FormData): Promise<ActionResult> {
  const type = String(formData.get("banType") ?? "temporary") as
    | "temporary"
    | "permanent"
    | "safety_hold";
  const durationDays = formData.get("durationDays")
    ? Number(formData.get("durationDays"))
    : undefined;
  const body = {
    type,
    reasonCode: asReasonCode(formData.get("reasonCode")),
    internalNote: String(formData.get("internalNote") ?? ""),
    userFacingExplanation: String(formData.get("userFacingExplanation") ?? ""),
    durationDays,
    revokeSessions: true,
  };
  const res = await adminFetch(`/api/v1/admin/users/${userId}/ban`, {
    method: "POST",
    body,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath(`/users/${userId}`);
  return { ok: true };
}

export async function unbanUserAction(userId: string, formData: FormData): Promise<ActionResult> {
  const body = {
    reason: String(formData.get("reason") ?? ""),
    internalNote: String(formData.get("internalNote") ?? ""),
    requireVerification: formData.get("requireVerification") === "on",
    requireProfileReview: formData.get("requireProfileReview") === "on",
  };
  const res = await adminFetch(`/api/v1/admin/users/${userId}/unban`, {
    method: "POST",
    body,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath(`/users/${userId}`);
  return { ok: true };
}

export async function addNoteAction(userId: string, formData: FormData): Promise<ActionResult> {
  const body = { body: String(formData.get("body") ?? "") };
  if (!body.body.trim()) {
    return {
      ok: false,
      status: 400,
      error: { code: ErrorCodes.VALIDATION_FAILED, message: "body required" },
    };
  }
  const res = await adminFetch(`/api/v1/admin/users/${userId}/notes`, {
    method: "POST",
    body,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath(`/users/${userId}`);
  return { ok: true };
}
