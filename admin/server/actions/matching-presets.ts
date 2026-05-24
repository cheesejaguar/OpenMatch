"use server";

import { revalidatePath } from "next/cache";
import { type AdminApiError, adminFetch } from "../../lib/api/admin-client";
import { WEIGHT_KEYS } from "../../lib/matching/weight-keys";

// Server actions backing the matching-presets admin page. Validation here
// mirrors the backend Zod schema so obvious mistakes are caught before the
// round-trip; the backend remains the source of truth and re-validates.

export interface PresetActionResult {
  ok: boolean;
  status: number;
  error?: string;
  apiError?: AdminApiError;
}

const KEY_RE = /^[a-z][a-z0-9-]*$/;
const WEIGHT_KEY_SET = new Set<string>(WEIGHT_KEYS);

function validateWeights(weights: Record<string, number>): string | null {
  for (const [k, v] of Object.entries(weights)) {
    if (!WEIGHT_KEY_SET.has(k)) return `unknown weight key: ${k}`;
    if (typeof v !== "number" || Number.isNaN(v) || v < 0 || v > 1) {
      return `weight ${k} must be between 0 and 1`;
    }
  }
  return null;
}

export interface UpsertPresetInput {
  key: string;
  label: string;
  description: string;
  strategyId: string;
  weights: Record<string, number>;
  enabled: boolean;
  isDefault: boolean;
  sortOrder?: number;
}

export async function createPreset(input: UpsertPresetInput): Promise<PresetActionResult> {
  const key = input.key.trim();
  if (!KEY_RE.test(key)) return { ok: false, status: 400, error: "invalid_key (use kebab-case)" };
  if (!input.label.trim()) return { ok: false, status: 400, error: "label_required" };
  if (!input.description.trim()) return { ok: false, status: 400, error: "description_required" };
  const weightError = validateWeights(input.weights);
  if (weightError) return { ok: false, status: 400, error: weightError };

  const res = await adminFetch("/api/v1/admin/matching-presets", {
    method: "POST",
    body: {
      key,
      label: input.label.trim(),
      description: input.description.trim(),
      strategyId: input.strategyId,
      weights: input.weights,
      enabled: input.enabled,
      isDefault: input.isDefault,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error.code, apiError: res.error };
  revalidatePath("/matching-presets");
  return { ok: true, status: res.status };
}

export interface PatchPresetInput {
  key: string;
  label?: string;
  description?: string;
  strategyId?: string;
  weights?: Record<string, number>;
  enabled?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
}

export async function updatePreset(input: PatchPresetInput): Promise<PresetActionResult> {
  if (!KEY_RE.test(input.key)) return { ok: false, status: 400, error: "invalid_key" };
  if (input.weights) {
    const weightError = validateWeights(input.weights);
    if (weightError) return { ok: false, status: 400, error: weightError };
  }
  const body: Record<string, unknown> = {};
  if (input.label !== undefined) body.label = input.label.trim();
  if (input.description !== undefined) body.description = input.description.trim();
  if (input.strategyId !== undefined) body.strategyId = input.strategyId;
  if (input.weights !== undefined) body.weights = input.weights;
  if (input.enabled !== undefined) body.enabled = input.enabled;
  if (input.isDefault !== undefined) body.isDefault = input.isDefault;
  if (input.sortOrder !== undefined) body.sortOrder = input.sortOrder;

  const res = await adminFetch(`/api/v1/admin/matching-presets/${input.key}`, {
    method: "PATCH",
    body,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error.code, apiError: res.error };
  revalidatePath("/matching-presets");
  return { ok: true, status: res.status };
}
