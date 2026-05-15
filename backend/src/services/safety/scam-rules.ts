import type { PrismaClient, ScamSignalKind } from "@prisma/client";

// Rule-based romance-scam detection. Deliberately *rule-based*, not ML:
//   - explainability — every flag has a clear ToS-language reason.
//   - auditability — every rule lives in version control.
//   - no surprise inputs — same fields the algorithm spec already lists.
//
// Flags are signals, not decisions. A signal queues a report for human
// review and may contribute to a ban, but never produces an immediate
// permanent ban on its own. See docs/algorithm/fairness.md and
// docs/legal/compliance-roadmap.md §2.7.

export interface ScamRuleContext {
  userId: string;
  // Message history snippet, oldest to newest, plain text only.
  recentMessages?: Array<{ body: string; createdAt: Date }>;
  // Profile snapshot.
  profileBio?: string;
  // Signup country (ISO-3166 alpha-2), if known.
  signupCountry?: string;
  // Declared profile country (ISO-3166 alpha-2), if known.
  declaredCountry?: string;
  // Time between match and the first message in seconds, if known.
  timeToFirstOffPlatformPushSec?: number;
}

const OFF_PLATFORM_PATTERNS = [
  /\bwhatsapp\b/i,
  /\btelegram\b/i,
  /\bsignal\b/i,
  /\bsnapchat\b/i,
  /\bkik\b/i,
  /\bdiscord\b/i,
  /\bemail\s*me\b/i,
  /\btext\s*me\b/i,
  /\bmy\s+number/i,
  /\b(?:\+?\d[\d\s\-().]{7,})\b/,
];

const PAYMENT_PATTERNS = [
  /\bvenmo\b/i,
  /\bcashapp\b/i,
  /\bzelle\b/i,
  /\bpaypal\b/i,
  /\bwire\s*transfer\b/i,
  /\bbitcoin\b/i,
  /\bcrypto\b/i,
  /\busdt\b/i,
  /\bonlyfans\b/i,
  /\bsugar\s*(daddy|baby|momma)\b/i,
];

// Heuristic: "wow, you're amazing" → "send a small amount" within hours.
const RAPID_OFF_PLATFORM_PUSH_THRESHOLD_SEC = 60 * 30; // 30 minutes

export function evaluateScamRules(ctx: ScamRuleContext): Array<{
  kind: ScamSignalKind;
  score: number;
  details: Record<string, unknown>;
}> {
  const signals: Array<{
    kind: ScamSignalKind;
    score: number;
    details: Record<string, unknown>;
  }> = [];

  const messages = ctx.recentMessages ?? [];
  const haystack = messages.map((m) => m.body).join("\n");

  // Rapid off-platform push.
  if (
    ctx.timeToFirstOffPlatformPushSec !== undefined &&
    ctx.timeToFirstOffPlatformPushSec <= RAPID_OFF_PLATFORM_PUSH_THRESHOLD_SEC
  ) {
    signals.push({
      kind: "rapid_offplatform_push",
      score: 70,
      details: { withinSec: ctx.timeToFirstOffPlatformPushSec },
    });
  } else if (OFF_PLATFORM_PATTERNS.some((p) => p.test(haystack))) {
    signals.push({
      kind: "rapid_offplatform_push",
      score: 40,
      details: {
        sampleMatch: OFF_PLATFORM_PATTERNS.find((p) => p.test(haystack))?.source,
      },
    });
  }

  // Geographic mismatch.
  if (
    ctx.signupCountry &&
    ctx.declaredCountry &&
    ctx.signupCountry.toUpperCase() !== ctx.declaredCountry.toUpperCase()
  ) {
    signals.push({
      kind: "geo_mismatch",
      score: 30,
      details: { signup: ctx.signupCountry, declared: ctx.declaredCountry },
    });
  }

  // Payment solicitation in messages or bio.
  const paymentHay = haystack + "\n" + (ctx.profileBio ?? "");
  if (PAYMENT_PATTERNS.some((p) => p.test(paymentHay))) {
    signals.push({
      kind: "payment_solicitation",
      score: 80,
      details: {
        sampleMatch: PAYMENT_PATTERNS.find((p) => p.test(paymentHay))?.source,
      },
    });
  }

  // Composite: classic romance-scam shape (off-platform push + payment).
  const hasOffPlatform = signals.some((s) => s.kind === "rapid_offplatform_push");
  const hasPayment = signals.some((s) => s.kind === "payment_solicitation");
  if (hasOffPlatform && hasPayment) {
    signals.push({
      kind: "romance_scam_pattern",
      score: 95,
      details: { reason: "off_platform_plus_payment" },
    });
  }

  return signals;
}

export async function recordScamSignals(
  prisma: PrismaClient,
  userId: string,
  signals: ReturnType<typeof evaluateScamRules>,
) {
  if (signals.length === 0) return [];
  return prisma.scamSignal.createManyAndReturn({
    data: signals.map((s) => ({
      userId,
      kind: s.kind,
      score: s.score,
      details: s.details as never,
    })),
  });
}
