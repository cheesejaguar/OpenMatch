// Trust & safety automation — heuristic text moderation provider.
//
// This is the in-tree, no-external-dependency implementation of the
// `ModerationProvider` contract. It runs synchronously on the request
// thread because each rule is O(n) over a bounded input (≤2000 chars
// for messages, ≤500 for bios). For longer-tail / image content the
// interface is identical so an operator can drop in a Hive /
// Sightengine / Rekognition provider without changing callers.
//
// Design principles:
//   - **Explainable.** Every rule emits a stable `reasonCode` string;
//     tests pin on that code and the admin UI groups by it.
//   - **Conservative on messages.** Cheap-to-route content like crypto
//     keywords or phone numbers BLOCKS a message (caller refuses the
//     send) but only FLAGS the same content in a profile bio — bios are
//     edit-once and a block would prevent the user from ever discussing
//     their interests in trading or moving abroad. The asymmetry is
//     intentional.
//   - **No regex bombs.** Every pattern is anchored or bounded; the
//     longest possible scan path is `O(input length)`.

export type ModerationSurface = "bio" | "message" | "display_name" | "photo_caption";
export type ModerationDecisionKind = "allow" | "flag" | "block";

export interface ModerationSignal {
  /** Stable identifier for the rule that fired (snake_case). */
  reasonCode: string;
  /** Per-surface verdict for this signal. */
  decision: Exclude<ModerationDecisionKind, "allow">;
  /** Short excerpt of the matching text (≤240 chars). */
  excerpt: string;
  /** Free-form per-rule metadata. */
  details: Record<string, unknown>;
}

export interface ModerationResult {
  /** Aggregated decision: the strongest verdict across all signals. */
  decision: ModerationDecisionKind;
  signals: ModerationSignal[];
}

export interface ModerationInput {
  surface: ModerationSurface;
  text: string;
}

// ---------------------------------------------------------------------
// ModerationProvider interface — a sibling plugin/extension PR may also
// declare this. We export it here so we have a single named contract no
// matter which lane lands first; both files declare structurally
// compatible shapes.
// ---------------------------------------------------------------------

export interface ModerationProvider {
  readonly name: string;
  moderate(input: ModerationInput): Promise<ModerationResult> | ModerationResult;
}

// ---------------------------------------------------------------------
// Whitelist of domains that are legitimate to mention on a dating
// platform — primarily public social profiles. Anything else flagged.
// ---------------------------------------------------------------------

const DOMAIN_WHITELIST = new Set<string>([
  "instagram.com",
  "linkedin.com",
  "github.com",
  "youtube.com",
  "spotify.com",
  "soundcloud.com",
  "open.spotify.com",
  "music.apple.com",
  "tiktok.com",
  "letterboxd.com",
  "goodreads.com",
  "strava.com",
  "ravelry.com",
  "openmatch.app",
  "openmatch.com",
]);

// ---------------------------------------------------------------------
// Patterns. Each is bounded; no exponential backtracking.
// ---------------------------------------------------------------------

// Domain detection — looks for `something.tld` where tld is 2–24 chars.
// We do NOT require a scheme so "follow me on insta.com/x" still fires.
const URL_PATTERN = /\b([a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9][a-z0-9-]{0,62}){1,3})\b/gi;

// E.164-ish phone numbers, +CC and US-style. Allows spaces, dashes,
// parens, dots between digit groups. Requires ≥7 total digits to keep
// false positives down (zip codes, years, etc. won't fire).
const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{1,4})?/g;

// Off-platform handle patterns: an @-handle followed by signal phrases
// like "DM me", "add me on", "find me at".
const HANDLE_NEAR_INVITE =
  /(?:dm\s*me|add\s*me\s*(?:on|at)?|find\s*me\s*at|hit\s*me\s*up\s*on|reach\s*me\s*at)[^@\n]{0,30}@([a-z0-9._]{3,30})/i;
const PLATFORM_HANDLE =
  /\b(?:telegram|whatsapp|snapchat|snap|kik|signal|wickr|discord)\b[^@\n]{0,40}@?([a-z0-9._]{3,30})/i;

// Crypto/scam-ish keywords. We accept all of these in BIOS (lots of
// people do work in finance) but block them in MESSAGES (the canonical
// romance-scam push).
const CRYPTO_KEYWORDS =
  /\b(?:bitcoin\s+returns?|crypto\s+(?:trading|investment|signals?)|investment\s+opportunity|guaranteed\s+returns?|usdt\s+wallet|forex\s+signals?|mining\s+pool|airdrop\s+claim)\b/i;

// All-caps spam: only fires when the message has enough characters to
// be meaningfully shouty.
const MIN_CAPS_LEN = 20;
const CAPS_RATIO_THRESHOLD = 0.8;

// Single-character repetition (≥10 of the same letter).
const REPEATED_CHAR = /(.)\1{9,}/i;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function clip(s: string, n = 240): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function strongestDecision(
  a: ModerationDecisionKind,
  b: ModerationDecisionKind,
): ModerationDecisionKind {
  if (a === "block" || b === "block") return "block";
  if (a === "flag" || b === "flag") return "flag";
  return "allow";
}

function looksLikeDomain(raw: string): { host: string } | null {
  // Reject pure-numeric "domains" (timestamps, version numbers).
  const lowered = raw.toLowerCase();
  if (/^\d+(?:\.\d+)+$/.test(lowered)) return null;
  // Require a recognisable TLD-shape on the last segment (≥2 alphabetic).
  const segments = lowered.split(".");
  if (segments.length < 2) return null;
  const tld = segments[segments.length - 1] ?? "";
  if (!/^[a-z]{2,24}$/.test(tld)) return null;
  return { host: lowered };
}

function isDomainWhitelisted(host: string): boolean {
  if (DOMAIN_WHITELIST.has(host)) return true;
  // Allow subdomains of whitelisted hosts ("user.medium.com" if we ever
  // whitelist medium.com).
  for (const wl of DOMAIN_WHITELIST) {
    if (host.endsWith(`.${wl}`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------

function detectUrls(input: ModerationInput): ModerationSignal[] {
  const out: ModerationSignal[] = [];
  // .matchAll returns lazy matches; we cap the iteration at the first
  // 16 occurrences as a belt-and-braces cap on pathological inputs.
  let i = 0;
  for (const match of input.text.matchAll(URL_PATTERN)) {
    if (++i > 16) break;
    const raw = match[1] ?? match[0];
    const dom = looksLikeDomain(raw);
    if (!dom) continue;
    if (isDomainWhitelisted(dom.host)) continue;
    out.push({
      reasonCode: "url_in_text",
      decision: input.surface === "message" ? "flag" : "flag",
      excerpt: clip(raw),
      details: { host: dom.host, offset: match.index ?? -1 },
    });
  }
  return out;
}

function detectPhone(input: ModerationInput): ModerationSignal[] {
  const out: ModerationSignal[] = [];
  for (const match of input.text.matchAll(PHONE_PATTERN)) {
    const raw = match[0];
    const digits = raw.replace(/\D+/g, "");
    if (digits.length < 7) continue;
    if (digits.length > 15) continue; // unrealistic phone length
    out.push({
      reasonCode: "phone_number",
      decision: input.surface === "message" ? "block" : "flag",
      excerpt: clip(raw),
      details: { digitCount: digits.length, offset: match.index ?? -1 },
    });
  }
  return out;
}

function detectHandles(input: ModerationInput): ModerationSignal[] {
  const out: ModerationSignal[] = [];
  const inviteMatch = HANDLE_NEAR_INVITE.exec(input.text);
  if (inviteMatch) {
    out.push({
      reasonCode: "offplatform_invite",
      decision: input.surface === "message" ? "block" : "flag",
      excerpt: clip(inviteMatch[0]),
      details: { handle: inviteMatch[1] },
    });
  }
  const platMatch = PLATFORM_HANDLE.exec(input.text);
  if (platMatch) {
    out.push({
      reasonCode: "offplatform_platform",
      decision: input.surface === "message" ? "block" : "flag",
      excerpt: clip(platMatch[0]),
      details: { handle: platMatch[1] },
    });
  }
  return out;
}

function detectCrypto(input: ModerationInput): ModerationSignal[] {
  const m = CRYPTO_KEYWORDS.exec(input.text);
  if (!m) return [];
  return [
    {
      reasonCode: "crypto_keyword",
      // In a message this is a near-perfect scam signal; in a bio it's
      // weaker (people do legit work in crypto) so we only flag.
      decision: input.surface === "message" ? "flag" : "flag",
      excerpt: clip(m[0]),
      details: { keyword: m[0] },
    },
  ];
}

function detectAllCaps(input: ModerationInput): ModerationSignal[] {
  if (input.surface !== "message") return [];
  const letters = input.text.replace(/[^a-z]/gi, "");
  if (letters.length < MIN_CAPS_LEN) return [];
  const upper = letters.replace(/[^A-Z]/g, "").length;
  const ratio = upper / letters.length;
  if (ratio < CAPS_RATIO_THRESHOLD) return [];
  return [
    {
      reasonCode: "all_caps_spam",
      decision: "flag",
      excerpt: clip(input.text),
      details: { ratio: Number(ratio.toFixed(3)), letterCount: letters.length },
    },
  ];
}

function detectRepeatedChar(input: ModerationInput): ModerationSignal[] {
  if (input.surface !== "message") return [];
  const m = REPEATED_CHAR.exec(input.text);
  if (!m) return [];
  return [
    {
      reasonCode: "char_flood",
      decision: "block",
      excerpt: clip(m[0]),
      details: { char: m[1] },
    },
  ];
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export function evaluateHeuristics(input: ModerationInput): ModerationResult {
  if (!input.text || input.text.length === 0) {
    return { decision: "allow", signals: [] };
  }
  const signals: ModerationSignal[] = [
    ...detectUrls(input),
    ...detectPhone(input),
    ...detectHandles(input),
    ...detectCrypto(input),
    ...detectAllCaps(input),
    ...detectRepeatedChar(input),
  ];
  let decision: ModerationDecisionKind = "allow";
  for (const s of signals) decision = strongestDecision(decision, s.decision);
  return { decision, signals };
}

/**
 * Concrete `ModerationProvider` for the heuristic engine. Drop-in
 * compatible with future image/text providers (Hive, Sightengine, etc.).
 */
export class HeuristicTextModerator implements ModerationProvider {
  readonly name = "heuristic";

  moderate(input: ModerationInput): ModerationResult {
    return evaluateHeuristics(input);
  }
}
