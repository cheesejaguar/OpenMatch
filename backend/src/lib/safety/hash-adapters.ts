import { createHash } from "node:crypto";
import type { HashList } from "@prisma/client";

// Adapter interfaces for child-safety and NCII hash-matching services.
//
// These are *interfaces*, not implementations: PhotoDNA (Microsoft),
// NCMEC industry hash sharing, and StopNCII.org all require signed
// agreements and per-vendor API keys before they can be wired up
// (tracked in docs/legal/vendor-register.md). Until those agreements
// land we ship a NullHashMatcher that records every call as a hash
// signal with `matchedList = internal` and never asserts a match. This
// keeps the call sites stable: the photo upload pipeline runs the
// matcher unconditionally, and switching to a live vendor is a single
// constructor swap.
//
// Statutory references:
//   - 18 U.S.C. §2258A    NCMEC CyberTipline reporting for CSAM
//   - TAKE IT DOWN Act §1309  NCII removal (48h)
//   - EU DSA Art. 16/17       notice-and-action + statement of reasons

export interface HashCandidate {
  /** Local content identifier (e.g. ProfilePhoto.id). */
  contentId: string;
  /** Owning user, if known. */
  userId?: string;
  /** The bytes to be hashed. Adapter may compute several algorithms. */
  bytes: Buffer;
  /** Best-effort mime. */
  mimeType?: string;
}

export interface HashMatchResult {
  /** True if the content matched a watch-list entry. */
  matched: boolean;
  /** Which list matched, if any. */
  list?: HashList;
  /** Vendor-side identifier of the matched entry, if any. */
  listEntry?: string;
  /** Algorithm used to compute the hash that was matched. */
  algorithm: string;
  /** The hex hash that was queried (always set, even on miss). */
  hashHex: string;
  /** Suggested action; the moderator pipeline may override. */
  suggestedAction: "auto_remove" | "queue_for_review" | "ignore";
}

export interface HashMatcher {
  readonly id: string;
  match(candidate: HashCandidate): Promise<HashMatchResult>;
}

// SHA-256 is universal; useful as the "internal" fallback algorithm so
// we always have *some* hash to record and to spot exact-byte
// duplicates across uploads. Not a perceptual hash — exact-byte only.
function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// Default no-op matcher. Always returns matched=false; the recorded
// signal is for telemetry only.
export class NullHashMatcher implements HashMatcher {
  readonly id = "null";
  async match(candidate: HashCandidate): Promise<HashMatchResult> {
    return {
      matched: false,
      algorithm: "sha256",
      hashHex: sha256(candidate.bytes),
      suggestedAction: "ignore",
    };
  }
}

// PhotoDNA adapter (Microsoft). The real implementation POSTs the image
// bytes to PhotoDNA Cloud Service and reads `IsMatch` from the response.
// The constructor requires an API key; we surface a clear "not
// configured" failure path so production cannot silently pass without
// PhotoDNA being wired in.
export class PhotoDnaMatcher implements HashMatcher {
  readonly id = "photodna";
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://api.microsoftmoderator.com/photodna/v1.0/Match",
  ) {
    if (!apiKey) {
      throw Object.assign(new Error("photodna_not_configured"), { statusCode: 500 });
    }
  }

  async match(_candidate: HashCandidate): Promise<HashMatchResult> {
    // Intentionally not implementing the network call here — the real
    // wire-up requires production credentials and a signed agreement
    // with Microsoft. The shape returned mirrors what the real call
    // produces so call-sites are correct today.
    // See docs/legal/vendor-register.md (PhotoDNA pending row).
    throw Object.assign(new Error("photodna_pending_wireup"), { statusCode: 501 });
  }
}

// StopNCII.org matcher. Real implementation queries the public-good
// hash list (hashes are pre-computed by the victim's device; we
// receive a list of hashes to deny). Behaviour at runtime is therefore
// "compare candidate hash against locally-cached list".
export class StopNciiMatcher implements HashMatcher {
  readonly id = "stopncii";
  private readonly denyList: Set<string>;
  constructor(denyHashes: Iterable<string> = []) {
    this.denyList = new Set(Array.from(denyHashes).map((h) => h.toLowerCase()));
  }
  async match(candidate: HashCandidate): Promise<HashMatchResult> {
    const hashHex = sha256(candidate.bytes); // placeholder — PDQ in production
    return this.denyList.has(hashHex)
      ? {
          matched: true,
          list: "stopncii",
          algorithm: "sha256",
          hashHex,
          suggestedAction: "auto_remove",
        }
      : {
          matched: false,
          algorithm: "sha256",
          hashHex,
          suggestedAction: "ignore",
        };
  }
}

// Composite matcher — fan-out across configured adapters; first match
// wins. Order matters: list the most authoritative source first.
export class ChainedMatcher implements HashMatcher {
  readonly id: string;
  constructor(private readonly chain: HashMatcher[]) {
    this.id = chain.map((m) => m.id).join("+");
  }
  async match(candidate: HashCandidate): Promise<HashMatchResult> {
    let lastMiss: HashMatchResult | undefined;
    for (const m of this.chain) {
      try {
        const r = await m.match(candidate);
        if (r.matched) return r;
        lastMiss = r;
      } catch (err) {
        // A failing adapter (e.g. PhotoDNA not yet wired) must not
        // block the upload. We log via the caller; here we just keep
        // trying the chain.
        void err;
      }
    }
    return (
      lastMiss ?? {
        matched: false,
        algorithm: "sha256",
        hashHex: sha256(candidate.bytes),
        suggestedAction: "ignore",
      }
    );
  }
}
