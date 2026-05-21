# Moderation provider

OpenMatch ships a pluggable `ModerationProvider` interface. The active
provider is selected at boot from the `MODERATION_PROVIDER` env var.

## Providers shipped in core

| Name    | Behaviour |
|---------|-----------|
| `noop`  | Default. Returns `clean` for every photo and message. Preserves the pre-plugin behaviour where moderation is reactive (admin-driven). |
| `basic` | Heuristic text rules: URL detection, off-platform keywords (telegram / whatsapp / signal / cashapp / venmo / onlyfans / …), and NANP-style phone-number leak detection. Single-category hits return `flag`; two or more categories at once return `block`. `scanImage` returns `clean` unconditionally — wire a real image scanner on top if you need one. |

## Operator switch

```bash
# .env or Vercel env
MODERATION_PROVIDER=basic
```

Boot reads the value once via `configureModerationProviderFromEnv(name)`
in `backend/src/server.ts`. Unknown values fall back to `noop` so a typo
never bricks signups.

## Decision vocabulary

| Decision | Photo upload                                                              | Chat message                                                                   |
|----------|---------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| `clean`  | Persist with `moderationStatus = clean`.                                  | Deliver with `moderationStatus = clean`.                                       |
| `flag`   | Persist with `moderationStatus = under_review`. Admin queue picks it up. | Deliver with `moderationStatus = under_review`. Recipient still sees the body. |
| `block`  | Reject with `photo_rejected_by_moderation` (HTTP 422). Blob is cleaned.   | Reject with `message_rejected_by_moderation` (HTTP 422). Row is never written. |

## Implementing a custom provider in a fork

```ts
// fork-bootstrap.ts
import { setModerationProvider } from "@openmatch/backend/lib/moderation-provider.js";

class HiveModerationProvider implements ModerationProvider {
  readonly name = "hive";
  async scanImage(input) { /* POST to Hive AI, map their response */ }
  async scanText(input)  { /* POST to Hive AI, map their response */ }
}

// Call before buildServer().
setModerationProvider(new HiveModerationProvider());
```

The fork then sets `MODERATION_PROVIDER=hive` so logs and admin diagnostics
attribute decisions to the right provider name.

## Audit logging

Decisions are not currently written to a dedicated audit table — the
`ProfilePhoto.moderationStatus` and `Message.moderationStatus` columns
are the source of truth. A provider that needs richer audit (raw
provider response, categories, confidence) should log them through its
own surface; we treat the moderation decision as a one-bit input to the
existing safety queue.
