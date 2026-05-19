"use server";

import { redirect } from "next/navigation";
import { adminFetch } from "../../lib/api/admin-client";

export async function createAccessGrantAction(formData: FormData) {
  const entityType = String(formData.get("entityType") ?? "conversation");
  const entityId = String(formData.get("entityId") ?? "");
  const reason = String(formData.get("reason") ?? "other");
  const note = String(formData.get("note") ?? "");
  const reportId = String(formData.get("reportId") ?? "");
  const nextPath = String(formData.get("next") ?? "/overview");
  if (!entityId) return;
  const res = await adminFetch<{ accessGrantId: string }>("/api/v1/admin/access-grants", {
    method: "POST",
    body: {
      entityType,
      entityId,
      reason,
      note: note || undefined,
      reportId: reportId || undefined,
    },
  });
  if (!res.ok) {
    redirect(`${nextPath}?accessError=1&code=${encodeURIComponent(res.error.code)}`);
  }
  const url = new URL(nextPath, "http://placeholder");
  url.searchParams.set("accessGrantId", res.data.accessGrantId);
  redirect(`${url.pathname}?${url.searchParams.toString()}`);
}
