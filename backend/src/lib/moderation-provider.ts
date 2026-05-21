// ModerationProvider — fork-extension surface for content scanning.
//
// Today moderation is reactive: photos enter as `clean` and only flip
// to `under_review` / `restricted` when a human admin acts on a report.
// Forks that want to wire in an automated scanner (Hive, Cloudflare
// Images AI, AWS Rekognition, …) implement this interface and register
// it via `setModerationProvider(...)` at boot. The selector reads
// `MODERATION_PROVIDER` from the env at startup; the default is `noop`
// so out-of-the-box behaviour is unchanged.
//
// The decision vocabulary is intentionally small:
//   - clean: pass through. Set ProfilePhoto.moderationStatus = clean,
//     deliver the message body verbatim.
//   - flag : deliver but mark for admin review. Photos enter
//     under_review and aren't shown in discovery until an admin acts;
//     messages are delivered with moderationStatus = under_review so
//     the recipient still gets them but the safety queue can audit.
//   - block: refuse. Photo upload returns the moderation rejection
//     code; chat send returns MESSAGE_REJECTED_BY_MODERATION and the
//     row is never written.
//
// The `confidence` and `categories` fields are surfaced into admin
// tooling and structured logs. Forks may surface the raw provider
// response via `rawProviderResponse` so on-call can debug a single
// decision without re-running the scan.

export type ModerationDecision = "clean" | "flag" | "block";

export type ImageModerationCategory = "nsfw" | "violence" | "underage" | "other";
export type TextModerationCategory =
  | "spam"
  | "harassment"
  | "scam"
  | "off_platform"
  | "sexual"
  | "other";

export interface ImageScanInput {
  blobPathname: string;
  mimeType: string;
  // Optional raw bytes — the basic provider doesn't read them, but a
  // real provider (e.g. one that POSTs to an external scanner) will.
  // Passing `undefined` lets the provider fetch the bytes itself from
  // blob storage if it prefers.
  data?: Buffer;
}

export interface ImageScanResult {
  decision: ModerationDecision;
  categories: ImageModerationCategory[];
  confidence: number;
  rawProviderResponse?: unknown;
}

export interface TextScanInput {
  text: string;
  context: "bio" | "message" | "prompt";
}

export interface TextScanResult {
  decision: ModerationDecision;
  categories: TextModerationCategory[];
  confidence: number;
  rawProviderResponse?: unknown;
}

export interface ModerationProvider {
  readonly name: string;
  scanImage(input: ImageScanInput): Promise<ImageScanResult>;
  scanText(input: TextScanInput): Promise<TextScanResult>;
}

// -------- Noop default --------------------------------------------------

export class NoopModerationProvider implements ModerationProvider {
  readonly name = "noop";

  async scanImage(_input: ImageScanInput): Promise<ImageScanResult> {
    return { decision: "clean", categories: [], confidence: 0 };
  }

  async scanText(_input: TextScanInput): Promise<TextScanResult> {
    return { decision: "clean", categories: [], confidence: 0 };
  }
}

// -------- Selector ------------------------------------------------------

let activeProvider: ModerationProvider = new NoopModerationProvider();

export function setModerationProvider(p: ModerationProvider): void {
  activeProvider = p;
}

export function getModerationProvider(): ModerationProvider {
  return activeProvider;
}

/**
 * Boot-time selector. Wired from `backend/src/server.ts` based on the
 * `MODERATION_PROVIDER` env var. Unknown values fall back to the noop
 * default rather than crashing the deployment so a typo in env config
 * never bricks signups.
 */
export async function configureModerationProviderFromEnv(name: string): Promise<void> {
  switch (name) {
    case "basic": {
      // Dynamic import so the noop path doesn't pull the heuristic
      // regexes into the dispatch graph when the operator hasn't opted
      // in. `await import` is the ESM-native replacement for require().
      const mod = await import("./moderation-basic.js");
      setModerationProvider(new mod.BasicModerationProvider());
      break;
    }
    default:
      setModerationProvider(new NoopModerationProvider());
      break;
  }
}
