# Trust & Safety: Verification Integrations

OpenMatch ships scaffolding for three layers of identity verification.
Each layer has a well-defined interface and a `Noop*` default
implementation so a fresh deployment compiles and serves requests
without any third-party credentials.

When an operator signs up for a provider, they:

1. Set the env vars listed below.
2. Implement the matching `*Verifier` interface in
   `backend/src/services/verification-providers.ts`, or wire an existing
   adapter from a Marketplace plugin.
3. Call `__setPhoneVerifier()` / `__setIdVerifier()` during
   `buildServer()` to register the real implementation in place of the
   `Noop*` default.

Until that switch is flipped, the user-facing flows return a clear
`*_not_configured` error and the admin queue surfaces verification
attempts so operators can audit the demand.

## 1. Selfie-pose verification (in-tree, ships ready)

No external provider required. The iOS client renders a
randomly-chosen pose prompt (e.g. "hold up two fingers and look right"),
captures a selfie, and POSTs the bytes to `POST /api/v1/verification/selfie`.
An admin reviews the image in the `Verification` queue and approves /
rejects. Approving sets `User.isAgeVerified = true` and
`Profile.isPhotoVerified = true`.

No env vars to set. This layer is fully owned by OpenMatch.

## 2. Phone verification (Twilio Verify scaffold)

**Interface:** `PhoneVerifier` (see `verification-providers.ts`).

When you sign up for Twilio Verify:

| Env var | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID`  | Twilio account SID. |
| `TWILIO_AUTH_TOKEN`   | Twilio auth token. Store as a Vercel secret. |
| `TWILIO_VERIFY_SERVICE_SID` | The Verify service SID from the Twilio console. |

Implementation sketch:

```ts
import twilio from "twilio";
import { __setPhoneVerifier, type PhoneVerifier } from "./services/verification-providers.js";

class TwilioPhoneVerifier implements PhoneVerifier {
  readonly name = "twilio_verify";
  private client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

  async start(phoneNumber: string) {
    const r = await this.client.verify.v2
      .services(env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phoneNumber, channel: "sms" });
    return { ok: r.status === "pending", externalRef: r.sid };
  }

  async complete(externalRef: string, code: string) {
    const r = await this.client.verify.v2
      .services(env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ verificationSid: externalRef, code });
    return { ok: r.status === "approved" };
  }
}

__setPhoneVerifier(new TwilioPhoneVerifier());
```

## 3. Government-ID verification (Persona / Onfido scaffold)

**Interface:** `IdVerifier`.

Two production-grade options:

### Persona

| Env var | Purpose |
|---|---|
| `PERSONA_API_KEY`        | Persona API key. |
| `PERSONA_TEMPLATE_ID`    | Inquiry template to use. |
| `PERSONA_WEBHOOK_SECRET` | Used to verify Persona's status webhook. |

Use the Inquiry API to mint a session URL, redirect the user, and
implement a webhook handler that updates the `VerificationRequest`
row's status when Persona reports an outcome.

### Onfido

| Env var | Purpose |
|---|---|
| `ONFIDO_API_TOKEN`      | Onfido API token. |
| `ONFIDO_WEBHOOK_TOKEN`  | HMAC secret for Onfido's status webhook. |
| `ONFIDO_REGION`         | `eu` or `us`. |

Use Onfido's `applicants` + `checks` API to start a verification,
return the Studio session URL to iOS, and update the
`VerificationRequest` row from the webhook.

## Operator checklist

- [ ] Add the env vars to your Vercel project (Production + Preview).
- [ ] Implement the matching `Verifier` class and register it in
      `buildServer()`.
- [ ] Confirm the admin queue shows a fresh request when iOS exercises
      the flow.
- [ ] Document who in your team is on the verification review rotation.
- [ ] Smoke-test the user-facing copy for the `*_not_configured` error
      so a misconfigured deployment still degrades cleanly.

## Where things live

- Schema:        `backend/prisma/schema.prisma` — `VerificationRequest`,
                 `VerificationRequestStatus`, `VerificationRequestKind`.
- Service:       `backend/src/services/verification.service.ts`
- Provider iface:`backend/src/services/verification-providers.ts`
- User routes:   `backend/src/routes/verification.ts`
- Admin routes:  `backend/src/routes/admin/verification.ts`
- iOS flow:      `ios/OpenMatch/Features/Safety/VerificationFlow.swift`
- Admin UI:      `admin/app/(app)/moderation/verification/page.tsx`
