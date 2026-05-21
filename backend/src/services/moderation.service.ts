// Trust & safety automation — high-level moderation service.
//
// This is the seam every text-bearing route calls. It glues the
// configured `ModerationProvider` (currently the in-tree
// `HeuristicTextModerator`) to the persistence layer
// (`ModerationFlag` rows + `ScamSignal` rows for ops dashboards).
//
// The route handler decides what to do with the result:
//   - `allow`  → continue as normal.
//   - `flag`   → continue, but the row is queued for admin review.
//   - `block`  → refuse the write (throw an HttpError); the user-facing
//                copy is decided by the caller.

import type { PrismaClient } from "@prisma/client";
import {
  HeuristicTextModerator,
  type ModerationInput,
  type ModerationProvider,
  type ModerationResult,
  type ModerationSurface,
} from "../lib/moderation-heuristics.js";

// Single shared instance — heuristic engine is stateless so a module
// singleton is fine. Tests can replace this via `__setModerationProvider`.
let provider: ModerationProvider = new HeuristicTextModerator();

export function getModerationProvider(): ModerationProvider {
  return provider;
}

/** Test-only seam — production code never calls this. */
export function __setModerationProvider(p: ModerationProvider): void {
  provider = p;
}

export interface ModerateOptions {
  surface: ModerationSurface;
  text: string;
}

export async function moderateText(opts: ModerateOptions): Promise<ModerationResult> {
  const input: ModerationInput = { surface: opts.surface, text: opts.text };
  return provider.moderate(input);
}

export interface RecordFlagsOptions {
  prisma: PrismaClient;
  userId: string;
  result: ModerationResult;
  surface: ModerationSurface;
  targetMessageId?: string;
  targetProfileId?: string;
}

/**
 * Persist any `flag` / `block` signals as `ModerationFlag` rows. Allow
 * verdicts are not persisted to keep table volume bounded — the
 * provider is deterministic so an admin can re-run it offline.
 *
 * Side-effects:
 *   - inserts one `ModerationFlag` per signal
 *   - inserts a single aggregated `ScamSignal` row when at least one
 *     "high-confidence" rule fired, so the operator scam-signals widget
 *     reflects the true volume
 */
export async function recordModerationFlags(opts: RecordFlagsOptions): Promise<void> {
  const { prisma, userId, result, surface } = opts;
  if (result.signals.length === 0) return;

  const rows = result.signals.map((s) => ({
    targetUserId: userId,
    surface,
    decision: s.decision,
    reasonCode: s.reasonCode,
    excerpt: s.excerpt,
    provider: provider.name,
    details: s.details as never,
    targetMessageId: opts.targetMessageId ?? null,
    targetProfileId: opts.targetProfileId ?? null,
  }));

  await prisma.moderationFlag.createMany({ data: rows });

  // Mirror "blocking" rules into ScamSignal so the existing scam-signal
  // widget on /overview shows heuristic volume too. We pick one
  // representative kind per result; full granularity is in ModerationFlag.
  const blocking = result.signals.find((s) => s.decision === "block");
  if (blocking) {
    let kind: "payment_solicitation" | "rapid_offplatform_push" | "other" = "other";
    if (
      blocking.reasonCode === "offplatform_invite" ||
      blocking.reasonCode === "offplatform_platform"
    ) {
      kind = "rapid_offplatform_push";
    } else if (blocking.reasonCode === "crypto_keyword") {
      kind = "payment_solicitation";
    }
    await prisma.scamSignal.create({
      data: {
        userId,
        kind,
        score: 65,
        details: {
          reasonCode: blocking.reasonCode,
          surface,
          provider: provider.name,
        } as never,
      },
    });
  }
}
