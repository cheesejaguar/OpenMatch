# Forking and rebranding OpenMatch

OpenMatch is Apache 2.0 and explicitly built to be forked. You can
ship a derivative product under your own name as long as you keep the
attribution required by the license and the legal templates honest.

This guide walks through everything you need to change to release a
clean fork. It is opinionated — there are paths that work but feel
half-baked, and this document picks one.

> **Hard constraint.** The upstream `main` branch will reject PRs that
> add paid dating mechanics. Your fork can do what it wants with its
> own branches — but if you want to merge upstream, keep the
> constraint in mind.

## At a glance

1. [Pick a name + bundle id](#1-pick-a-name--bundle-id)
2. [Apple developer setup](#2-apple-developer-setup)
3. [Rename the iOS target](#3-rename-the-ios-target)
4. [Swap the color palette](#4-swap-the-color-palette)
5. [Swap the fonts](#5-swap-the-fonts)
6. [Regenerate the logo and app icons](#6-regenerate-the-logo-and-app-icons)
7. [Point the iOS app at your backend](#7-point-the-ios-app-at-your-backend)
8. [Sign in with Apple](#8-sign-in-with-apple)
9. [Brand the email templates](#9-brand-the-email-templates)
10. [Privacy policy and ToS](#10-privacy-policy-and-tos)
11. [Regenerate the TypeScript SDK](#11-regenerate-the-typescript-sdk)
12. [Use scripts/rebrand.mjs](#12-use-scriptsrebrandmjs)
13. [Attribution, license, and trademarks](#13-attribution-license-and-trademarks)

## 1. Pick a name + bundle id

You'll need:

- **Brand name** — what users see. E.g. "Sparkmatch", "Vela", "Plover".
- **App display name** — what appears under the home-screen icon. Typically the brand name. iOS truncates at ~11 characters; verify on a real device.
- **Bundle id prefix** — the reverse-DNS prefix you control. E.g. `com.sparkmatch`, `app.vela`. Must match a domain you own (Apple cross-checks via App Store Connect).
- **Bundle identifier** — `<prefix>.ios` for the consumer app. E.g. `com.sparkmatch.ios`.
- **Apple Team ID** — a 10-character alphanumeric string from [Apple Developer → Membership](https://developer.apple.com/account).
- **Brand color** — a single hex value. The rebrand script derives a full Aurora-Dawn-style palette from it.

Write these down. The rebrand script will ask for them.

## 2. Apple developer setup

Before any code changes, set up the Apple side:

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/yr) under the legal entity that will publish the app.
2. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list):
   - Create an **App ID** with your chosen bundle identifier. Enable Sign In with Apple, Push Notifications, and Associated Domains.
   - Create a **Services ID** (for Sign in with Apple web flow if you use it — needed for the backend even when the iOS app uses native SIWA).
   - Create a **Push key** (`.p8`). Save the Key ID.
3. In App Store Connect, create the **app record** and reserve the name.

## 3. Rename the iOS target

Open [`ios/project.yml`](../ios/project.yml). The relevant lines:

```yaml
name: OpenMatch                         # ← change to your brand
options:
  bundleIdPrefix: app.openmatch         # ← change to your reverse-DNS prefix
…
targets:
  OpenMatch:                            # ← rename the target
    settings:
      PRODUCT_BUNDLE_IDENTIFIER: app.openmatch.ios      # ← consumer app
…
      PRODUCT_BUNDLE_IDENTIFIER: app.openmatch.ios.tests
…
      PRODUCT_BUNDLE_IDENTIFIER: app.openmatch.ios.uitests
```

Also update the display name in [`ios/OpenMatch/Resources/Info.plist`](../ios/OpenMatch/Resources/Info.plist):

```xml
<key>CFBundleDisplayName</key>
<string>OpenMatch</string>   <!-- ← change -->
```

After editing, regenerate the Xcode project:

```bash
cd ios && make generate
```

> **Renaming the directory** (`ios/OpenMatch/` → `ios/YourBrand/`) is
> optional but tidier. If you do it, update every path reference in
> `project.yml`, `Makefile`, and `scripts/gen_logo.mjs`. Sticking with
> `ios/OpenMatch/` is fine — it's an internal directory name.

## 4. Swap the color palette

The brand palette lives in two places that must stay in sync:

- **iOS**: [`ios/OpenMatch/DesignSystem/OMColor.swift`](../ios/OpenMatch/DesignSystem/OMColor.swift) — the `Aurora Dawn` block at the top defines `plum`, `magenta`, `marigold`, `periwinkle`, etc., each with a light + dark hex value.
- **Admin**: [`admin/app/globals.css`](../admin/app/globals.css) — the `:root` block with `--om-plum`, `--om-magenta`, etc.

The two files share semantic names, not literal hex values. The
simplest path is to choose a hero color and derive the rest:

| Token | Role | Suggestion |
|---|---|---|
| `plum` | Hero / nav / primary surfaces | Your brand color |
| `magenta` | Primary CTA, spark moments | A warm complement |
| `marigold` | Celebration / warning | A high-chroma yellow-orange |
| `periwinkle` | Calm / secondary CTA | A muted blue-violet |
| `cinnabar` | Destructive / safety | Stay close to `#D43A3A` — operators learn to read it |
| `paper` / `ink` | Background / foreground | Off-white + near-black; resist pure white/black |

Pick light + dark variants of each. `OMColor.swift` resolves the
correct one automatically based on `UITraitCollection.userInterfaceStyle`.

The [`scripts/rebrand.mjs`](../scripts/rebrand.mjs) helper generates a
diff from a single hero hex if you don't want to hand-tune the palette.

## 5. Swap the fonts

OpenMatch ships **Fraunces** (display / wordmark) and **Geist** (body
/ UI). Both are SIL OFL — you can rebrand and redistribute. If you
want different fonts:

### iOS

1. Add your `.ttf` / `.otf` files to `ios/OpenMatch/Resources/Fonts/`.
2. Register them in `ios/OpenMatch/Resources/Info.plist` under `UIAppFonts`.
3. Update [`ios/OpenMatch/DesignSystem/OMTypography.swift`](../ios/OpenMatch/DesignSystem/OMTypography.swift) — the `postScriptName(for:italic:)` switch statement is the single point of change. The numeric weights / italics map onto whatever PostScript names your new fonts use.
4. Update any direct `Font.custom("Fraunces…")` references — `grep` for them.

### Admin

1. Drop your `.ttf` / `.otf` files into [`admin/app/fonts/`](../admin/app/fonts/).
2. Update the two `localFont({ src: […] })` blocks at the top of [`admin/app/layout.tsx`](../admin/app/layout.tsx) — the `variable` names (`--font-geist`, `--font-fraunces`) are referenced in `globals.css`; either keep the variable names and swap the files, or rename in both files.

## 6. Regenerate the logo and app icons

Logo assets:

1. Replace the canonical SVGs in `assets/logo/` — `om-mark-light.svg`, `om-mark-dark.svg`, `om-mark-tinted.svg`, `om-mark.svg`. The current files embed Fraunces as base64 so CI runners render them correctly without the system font installed; if you keep that approach, encode your new font similarly. Otherwise, flatten the text to paths.
2. Run the rasterizer:
   ```bash
   npm run gen:logo
   ```
   This populates [`ios/OpenMatch/Assets.xcassets/AppIcon.appiconset/`](../ios/OpenMatch/Assets.xcassets/AppIcon.appiconset/) (light / dark / tinted 1024×1024) and [`admin/public/favicon.png`](../admin/public/favicon.png), `favicon.svg`, `om-mark.svg`. See [`scripts/gen_logo.mjs`](../scripts/gen_logo.mjs) for the full output list.
3. Open Xcode and confirm the new icons appear in `Assets.xcassets/AppIcon`.

## 7. Point the iOS app at your backend

Edit [`ios/OpenMatch/Resources/Info.plist`](../ios/OpenMatch/Resources/Info.plist):

```xml
<key>OMAPIBaseURL</key>
<string>https://api.your-brand.com</string>
```

For local dev against a self-host stack, `http://localhost:8080`
works in the simulator (see [`docs/self-hosting.md`](./self-hosting.md)).

## 8. Sign in with Apple

The backend validates Apple ID tokens. To enable SIWA for your fork:

1. Create a **Services ID** in Apple Developer that authorizes your app's bundle identifier.
2. Create a **Sign in with Apple key** (`.p8`).
3. Set these backend env vars:
   ```
   APPLE_TEAM_ID=ABCDE12345
   APPLE_CLIENT_ID=com.yourbrand.ios          # bundle id (native) or services id (web)
   APPLE_KEY_ID=KEYID67890
   APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----…"
   ```

The current validator lives in [`backend/src/services/apple-auth.service.ts`](../backend/src/services/apple-auth.service.ts).
If you publish a separate Services ID for the web flow, you'll need
two `APPLE_CLIENT_ID` entries — extend the validator's audience list
accordingly.

## 9. Brand the email templates

Magic-link email is sent from [`backend/src/services/auth.service.ts`](../backend/src/services/auth.service.ts).
Today the body is a single plain-text string ("Your OpenMatch sign-in
link"). For a serious fork:

1. Replace `Your OpenMatch sign-in link` with your brand name.
2. Replace the `noreply@openmatch.local` SMTP_FROM with a verified
   sender on your domain (e.g. `noreply@your-brand.com`).
3. (Optional but recommended) Extract the body to a template file in
   `backend/src/templates/` and render via a small interpolation
   helper. Keep it plain-text — HTML email is a phishing risk and
   adds a maintenance burden.

The PR that ships this guide also extracts the magic-link copy to a
single named function so you have one place to edit. Grep for
`magicLinkEmailBody` in `auth.service.ts`.

## 10. Privacy policy and ToS

You **need** these to ship — App Store review will reject without
them, and most jurisdictions require them for any service that
collects personal data.

Starting points (generic; mark placeholders before publishing):

- [`docs/templates/privacy-policy.md`](templates/privacy-policy.md)
- [`docs/templates/terms-of-service.md`](templates/terms-of-service.md)

These templates are **not** legal advice. Have a lawyer review them
for your jurisdiction (especially if you're targeting EU users —
GDPR — or California users — CCPA/CPRA). Both templates are derived
from OpenMatch's own privacy principles ([`docs/privacy/principles.md`](privacy/principles.md))
which you can keep, adapt, or replace.

Surface the URLs in:

- iOS: a Settings → Legal screen, plus the SIWA / sign-up flow.
- Admin: a footer link.
- App Store Connect → App Privacy → Privacy Policy URL.

## 11. Regenerate the TypeScript SDK

OpenMatch ships an auto-generated TypeScript client built from the
backend's OpenAPI 3.1 export. Forks can use it directly, modify it,
or regenerate it after their own schema changes:

```bash
# Make sure the backend is running locally (make up-services + npm run dev,
# or make up) so /openapi.json is reachable.
npm run gen:sdk
```

Output lands in `sdk/typescript/`. See
[`scripts/gen-sdk.mjs`](../scripts/gen-sdk.mjs) for what's generated.

The Swift client is not auto-generated today — the openapi-generator
Swift template requires a Java toolchain that we don't want to push
onto every contributor. Forks that want a typed Swift client can run
[`@openapitools/openapi-generator-cli`](https://github.com/OpenAPITools/openapi-generator-cli)
manually:

```bash
npx @openapitools/openapi-generator-cli generate \
  -i http://localhost:8080/openapi.json \
  -g swift5 \
  -o sdk/swift
```

This is tracked as a follow-up — see [`ROADMAP.md`](../ROADMAP.md).

## 12. Use scripts/rebrand.mjs

`scripts/rebrand.mjs` is an interactive helper that walks through the
steps above. It **shows** a diff and **does not apply** anything —
review and commit yourself:

```bash
node scripts/rebrand.mjs
```

Inputs it asks for:

- Brand name
- Bundle id prefix
- Apple Team ID
- Hero color (single hex)

Files it touches in the diff:

- `ios/project.yml`
- `ios/OpenMatch/DesignSystem/OMColor.swift`
- `ios/OpenMatch/Resources/Info.plist`
- `admin/app/globals.css`
- `admin/app/layout.tsx` (display name, not fonts)
- `backend/.env.example` (sample APPLE_* values)
- `README.md` (badge URLs, title)

The script is intentionally simple — sed-like text replacement, no
AST manipulation. If your fork has diverged significantly, hand-edit
instead.

## 13. Attribution, license, and trademarks

OpenMatch is Apache 2.0. You can:

- Use the code commercially.
- Modify it.
- Redistribute it under any license that's compatible with Apache 2.0.

You **must**:

- Keep the `LICENSE` file in your distribution.
- Keep the `NOTICE` file and any attributions it contains. If you make changes, append your own NOTICE entries — don't replace upstream ones.
- Not use the "OpenMatch" name or marks to imply endorsement by upstream maintainers. If your README says "Forked from OpenMatch", that's fine and welcome. If it says "OpenMatch by [your company]", that's not.

The Aurora Dawn palette, Fraunces, and Geist are all permissively
licensed — see their respective LICENSE files. Replace them anyway if
you want a distinctive look; that's the whole point of a rebrand.

---

Stuck? Open a [Discussion](https://github.com/cheesejaguar/openmatch/discussions)
with the `forking` label. PRs against this guide are welcome —
especially from anyone who's gone through the process and hit a
papercut.
