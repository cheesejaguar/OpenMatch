"use server";

import { revalidatePath } from "next/cache";
import { type AdminApiError, adminFetch } from "../../lib/api/admin-client";
import { ErrorCodes } from "../../lib/api/error-codes";

type ActionResult = { ok: true } | { ok: false; status: number; error: AdminApiError };

const RESOLUTIONS = [
  "no_action",
  "warning",
  "content_removed",
  "temporary_suspension",
  "permanent_ban",
] as const;

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

function asResolution(v: FormDataEntryValue | null) {
  const s = String(v ?? "no_action");
  return (RESOLUTIONS as readonly string[]).includes(s)
    ? (s as (typeof RESOLUTIONS)[number])
    : "no_action";
}

function asReason(v: FormDataEntryValue | null) {
  const s = String(v ?? "other");
  return (REASON_CODES as readonly string[]).includes(s)
    ? (s as (typeof REASON_CODES)[number])
    : "other";
}

export async function resolveReportAction(
  reportId: string,
  formData: FormData,
): Promise<ActionResult> {
  const body = {
    resolution: asResolution(formData.get("resolution")),
    reasonCode: asReason(formData.get("reasonCode")),
    internalNote: String(formData.get("internalNote") ?? ""),
    userFacingExplanation: String(formData.get("userFacingExplanation") ?? ""),
  };
  const res = await adminFetch(`/api/v1/admin/reports/${reportId}/resolve`, {
    method: "POST",
    body,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  return { ok: true };
}

export async function dismissReportAction(reportId: string): Promise<ActionResult> {
  const res = await adminFetch(`/api/v1/admin/reports/${reportId}/dismiss`, {
    method: "POST",
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
  return { ok: true };
}

export async function escalateReportAction(reportId: string): Promise<ActionResult> {
  const res = await adminFetch(`/api/v1/admin/reports/${reportId}/escalate`, {
    method: "POST",
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath(`/reports/${reportId}`);
  return { ok: true };
}

export async function addReportNoteAction(
  reportId: string,
  formData: FormData,
): Promise<ActionResult> {
  const body = { body: String(formData.get("body") ?? "") };
  if (!body.body.trim()) {
    return {
      ok: false,
      status: 400,
      error: { code: ErrorCodes.VALIDATION_FAILED, message: "body required" },
    };
  }
  const res = await adminFetch(`/api/v1/admin/reports/${reportId}/notes`, {
    method: "POST",
    body,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath(`/reports/${reportId}`);
  return { ok: true };
}
