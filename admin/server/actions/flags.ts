"use server";

import { revalidatePath } from "next/cache";
import { type AdminApiError, adminFetch } from "../../lib/api/admin-client";

export interface ToggleFlagResult {
  ok: boolean;
  status: number;
  /** Backend error code (e.g. validation_failed, forbidden) or a client-side code. */
  error?: string;
  /** Full typed error payload when the backend rejected the request. */
  apiError?: AdminApiError;
}

const FLAG_KEY_RE = /^[a-z][a-z0-9_]*$/;

export async function toggleFlag(key: string, enabled: boolean): Promise<ToggleFlagResult> {
  if (!FLAG_KEY_RE.test(key)) return { ok: false, status: 400, error: "invalid_key" };
  const res = await adminFetch(`/api/v1/admin/flags/${key}`, {
    method: "PATCH",
    body: { enabled },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error.code, apiError: res.error };
  }
  revalidatePath("/flags");
  return { ok: true, status: res.status };
}

export interface CreateFlagInput {
  key: string;
  description: string;
  enabled: boolean;
  variants?: Record<string, unknown> | null;
}

export interface CreateFlagResult {
  ok: boolean;
  status: number;
  /** Backend error code (e.g. validation_failed, conflict) or a client-side code. */
  error?: string;
  /** Full typed error payload when the backend rejected the request. */
  apiError?: AdminApiError;
}

export async function createFlag(input: CreateFlagInput): Promise<CreateFlagResult> {
  const key = input.key.trim();
  if (!FLAG_KEY_RE.test(key)) return { ok: false, status: 400, error: "invalid_key" };
  const description = input.description.trim();
  if (!description) return { ok: false, status: 400, error: "description_required" };
  const body: Record<string, unknown> = { key, description, enabled: input.enabled };
  if (input.variants && Object.keys(input.variants).length > 0) {
    body.variants = input.variants;
  }
  const res = await adminFetch("/api/v1/admin/flags", { method: "POST", body });
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error.code, apiError: res.error };
  }
  revalidatePath("/flags");
  return { ok: true, status: res.status };
}
