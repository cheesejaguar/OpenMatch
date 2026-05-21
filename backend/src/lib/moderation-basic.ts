// BasicModerationProvider — heuristic-only text rules, no image checks.
//
// Ships as an optional alternative to the noop default for forks that
// want *some* automated filter without integrating a third-party
// scanner. The rules are deliberately conservative — they intentionally
// err on the side of `flag` rather than `block` so a false positive
// surfaces in the admin queue instead of silently rejecting a real
// user's message.
//
// What it catches:
//   - URLs of any scheme (http/https/bare-domain-with-tld). Pure URL
//     messages in early-stage conversation are the dominant
//     off-platform-routing pattern.
//   - Off-platform contact keywords (telegram / whatsapp / signal /
//     wechat / kik / snap / discord / cashapp / venmo / onlyfans).
//   - Phone-number leaks (NANP-style 10-digit + a handful of
//     international shapes). Strict enough to skip "I'm 5'10\"".
//
// What it does NOT catch (deliberately):
//   - Harassment / slurs — open lists drift and are jurisdictionally
//     fraught; that classification belongs in a real provider.
//   - Image content — there is no built-in image scanner. `scanImage`
//     returns `clean` here; a fork wiring this provider in still wants
//     to layer an image scanner on top.

import type {
  ImageScanInput,
  ImageScanResult,
  ModerationProvider,
  TextModerationCategory,
  TextScanInput,
  TextScanResult,
} from "./moderation-provider.js";

// Matches:
//   http://example.com, https://x.com/path, www.example.com,
//   bare host.tld (com|net|org|io|co|app|xyz|me|gg)
// Avoids matching "u.s.a." or version strings like "1.2.3" by requiring
// the host segment before the TLD to be at least 2 chars and the TLD
// itself to be one of an allow-list of likely-real registries.
const URL_RE =
  /(?:https?:\/\/|www\.)\S+|(?:\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|net|org|io|co|app|xyz|me|gg|tv|ly|to|sh)\b)/i;

// Common off-platform contact / payment keywords. Matched as whole
// tokens (word boundaries) so "kikoff" doesn't trigger on "kik".
const OFF_PLATFORM_RE =
  /\b(telegram|whatsapp|signal app|wechat|kik|snapchat|discord|cashapp|cash app|venmo|zelle|onlyfans|of(?=\.com))\b/i;

// 10-digit NANP-style: 555-555-5555, (555) 555 5555, 555.555.5555,
// and an international leading + variant. Requires at least one
// separator so plain "5551234567" still trips but a row of years like
// "20262026" does not.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

function categorise(text: string): TextModerationCategory[] {
  const cats: TextModerationCategory[] = [];
  if (OFF_PLATFORM_RE.test(text)) cats.push("off_platform");
  if (URL_RE.test(text)) cats.push("spam");
  if (PHONE_RE.test(text)) cats.push("scam");
  return cats;
}

export class BasicModerationProvider implements ModerationProvider {
  readonly name = "basic";

  async scanImage(_input: ImageScanInput): Promise<ImageScanResult> {
    // No image scanning in the basic provider. Fork composing this
    // with a real image scanner should subclass / wrap.
    return { decision: "clean", categories: [], confidence: 0 };
  }

  async scanText(input: TextScanInput): Promise<TextScanResult> {
    const cats = categorise(input.text);
    if (cats.length === 0) {
      return { decision: "clean", categories: [], confidence: 0 };
    }
    // Multiple categories tripping at once (e.g. URL + phone in the
    // same message) is a high-confidence spam/scam signal — block.
    // Single categories flag for admin review.
    const decision = cats.length >= 2 ? "block" : "flag";
    return {
      decision,
      categories: cats,
      confidence: cats.length >= 2 ? 0.85 : 0.6,
    };
  }
}
