"use server";

import { revalidatePath } from "next/cache";
import { adminFetch } from "../../lib/api/admin-client";

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

export async function banUserAction(userId: string, formData: FormData) {
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
  if (res.status >= 400) {
    return { ok: false as const, status: res.status, data: res.data };
  }
  revalidatePath(`/users/${userId}`);
  return { ok: true as const };
}

export async function unbanUserAction(userId: string, formData: FormData) {
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
  if (res.status >= 400) {
    return { ok: false as const, status: res.status, data: res.data };
  }
  revalidatePath(`/users/${userId}`);
  return { ok: true as const };
}

export async function addNoteAction(userId: string, formData: FormData) {
  const body = { body: String(formData.get("body") ?? "") };
  if (!body.body.trim()) return { ok: false as const, status: 400, data: { error: "empty" } };
  const res = await adminFetch(`/api/v1/admin/users/${userId}/notes`, {
    method: "POST",
    body,
  });
  if (res.status >= 400) return { ok: false as const, status: res.status, data: res.data };
  revalidatePath(`/users/${userId}`);
  return { ok: true as const };
}
