"use server";

import { revalidatePath } from "next/cache";
import { adminFetch } from "../../lib/api/admin-client";
import type { InviteCreatedDTO } from "../../lib/api/types";

export interface CreateInviteInput {
  cohortLabel: string;
  count: number;
  maxUses: number;
  expiresAt?: string | null;
  notes?: string;
}

export interface CreateInviteResult {
  ok: boolean;
  status: number;
  error?: string;
  items?: InviteCreatedDTO["items"];
}

// Server action — POSTs to the R1A admin invites endpoint. Caller
// passes a JSON-able payload; we forward & revalidate the /invites
// route so the new codes appear in the list immediately.
export async function createInviteBatch(input: CreateInviteInput): Promise<CreateInviteResult> {
  const trimmedCohort = input.cohortLabel.trim();
  if (!trimmedCohort) return { ok: false, status: 400, error: "cohort_required" };
  const count = Math.max(1, Math.min(100, Math.floor(input.count)));
  const maxUses = Math.max(1, Math.min(1000, Math.floor(input.maxUses)));
  const body: Record<string, unknown> = {
    cohortLabel: trimmedCohort,
    count,
    maxUses,
  };
  if (input.expiresAt) body.expiresAt = input.expiresAt;
  if (input.notes?.trim()) body.notes = input.notes.trim();

  const res = await adminFetch<InviteCreatedDTO>("/api/v1/admin/invites", {
    method: "POST",
    body,
  });
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, error: "server_rejected" };
  }
  revalidatePath("/invites");
  return { ok: true, status: res.status, items: res.data.items };
}

export interface RevokeInviteResult {
  ok: boolean;
  status: number;
  error?: string;
}

export async function revokeInvite(id: string): Promise<RevokeInviteResult> {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return { ok: false, status: 400, error: "invalid_id" };
  }
  const res = await adminFetch(`/api/v1/admin/invites/${id}/revoke`, { method: "POST" });
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, error: "server_rejected" };
  }
  revalidatePath("/invites");
  return { ok: true, status: res.status };
}
