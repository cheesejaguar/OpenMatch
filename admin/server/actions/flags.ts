"use server";

import { revalidatePath } from "next/cache";
import { adminFetch } from "../../lib/api/admin-client";

export interface ToggleFlagResult {
  ok: boolean;
  status: number;
  error?: string;
}

const FLAG_KEY_RE = /^[a-z][a-z0-9_]*$/;

export async function toggleFlag(key: string, enabled: boolean): Promise<ToggleFlagResult> {
  if (!FLAG_KEY_RE.test(key)) return { ok: false, status: 400, error: "invalid_key" };
  const res = await adminFetch(`/api/v1/admin/flags/${key}`, {
    method: "PATCH",
    body: { enabled },
  });
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, error: "server_rejected" };
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
  error?: string;
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
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, error: "server_rejected" };
  }
  revalidatePath("/flags");
  return { ok: true, status: res.status };
}
