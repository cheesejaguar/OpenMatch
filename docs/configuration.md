# Platform configuration

OpenMatch is a single-tenant codebase, but the **product variant** is
configurable per deployment via a top-level `openmatch.config.ts`. The
default config reproduces today's dating-app behaviour; forks pick a
different variant (mentorship, roommates, sports) or hand-roll a custom
one without patching feature code.

## TL;DR

```bash
# 1. Copy a starter into place.
cp examples/configs/mentorship.config.ts openmatch.config.ts

# 2. Boot — Zod validates the config and refuses to start on an
#    invalid shape.
npm run dev -w @openmatch/backend
```

For per-environment overrides (preview vs prod), set
`OPENMATCH_CONFIG_PATH` to point at an absolute path. The loader
accepts `.ts` / `.js` / `.mjs` modules whose `default` export is the
config, OR a `.json` file.

```bash
OPENMATCH_CONFIG_PATH=/etc/openmatch/preview.config.json npm start -w @openmatch/backend
```

## Schema

The full schema is defined in `openmatch.config.schema.ts` at the
repo root. Quick summary:

| Field | Purpose |
|---|---|
| `variant` | Tag for the deployment: `dating`, `mentorship`, `roommates`, `sports`, or `custom`. |
| `features.requireGenderPreferences` | Backend rejects PATCH `/preferences/me` that clears `interestedGenders` to `[]`. |
| `features.requireAgeWindow` | Backend rejects PATCH `/preferences/me` that submits a non-positive `minAge` / `maxAge`. |
| `features.requirePhotos` | Profile cannot flip to `visible` until `minPhotos` photos exist. |
| `features.minPhotos` | Floor for the visible-profile gate above. |
| `features.maxPhotos` | Hard cap on photos per profile (replaces the previous hardcoded `9`). |
| `features.enableMatchOverlay` | iOS shows the celebratory match overlay (`true`) or a plain notification (`false`). |
| `features.enableSwipeDeck` | iOS renders the swipe deck (`true`) or a browse-style grid (`false`). |
| `features.enableBoosts` | Reserved for paid-discovery surfaces. Defaults `false` — OpenMatch ships no paid features. |
| `features.enableVerification` | ID-document verification surface. |
| `features.enableVoiceNotes` / `features.enableVideoNotes` | Hooks for the Wave 2 communication PR. |
| `copy.appName` | Product name surfaced in iOS chrome + email. |
| `copy.matchVerb` | Past-tense verb used in the match overlay (`matched`, `connected`, `paired`). |
| `copy.swipeRightVerb` | Verb for the unilateral interest action (`like`, `connect`, `interested`). |
| `copy.profilePrompt` | First onboarding prompt. |
| `branding.{primary,accent}Color{Light,Dark}` | Brand colour tokens. |

## Picking a variant

| If you're building | Use this starter |
|---|---|
| A dating app | the default (`openmatch.config.ts` already matches) |
| A mentor/mentee matcher | `examples/configs/mentorship.config.ts` |
| A roommate matcher | `examples/configs/roommates.config.ts` |
| A pickup-sports / training-partner app | `examples/configs/sports.config.ts` |
| Something else | Copy the dating default, set `variant: 'custom'`, tweak features/copy/branding |

## Per-runtime wiring

* **Backend** — `backend/src/lib/config.ts` exports a `config` object
  that proxies the active config. The server entry point awaits
  `initConfig()` before any plugin registers. Tests can swap in a
  config via `__setConfigForTests({...})` and reset via
  `__resetConfigForTests()`.
* **Admin** — `admin/lib/config.ts` exports `getConfig()` (async) and
  `getConfigSync()`. Always resolve via the async accessor on the
  server first to populate the cache; pass the snapshot to client
  components via props.
* **iOS** — A subset of the config is baked into `Info.plist` at build
  time (`OMConfigVariant`, `OMConfigMatchVerb`, `OMConfigSwipeRightVerb`,
  `OMConfigEnableSwipeDeck`, `OMConfigEnableMatchOverlay`,
  `OMConfigMinPhotos`, `OMConfigMaxPhotos`, `OMConfigRequirePhotos`,
  `OMConfigAppName`). `PlatformConfig.shared` reads them with safe
  fallbacks to the dating defaults.

## Validation

`openmatch.config.schema.ts` (and its in-tree mirrors at
`backend/src/lib/config-schema.ts` and `admin/lib/config-schema.ts`)
runs Zod validation at boot. Common failure modes:

* `features.minPhotos > features.maxPhotos` — boot fails.
* `features.requirePhotos: true` with `features.minPhotos: 0` — boot fails.
* Non-hex branding colour — boot fails (must be `#RRGGBB` or `#RRGGBBAA`).

A spec at `backend/test/openmatch-config.spec.ts` round-trips the
default config + every example through the schema so structural
regressions surface in CI.

## Custom variants

For a fully custom product, copy the dating default, set
`variant: 'custom'`, and override whichever feature/copy/branding
fields differ. The `custom` tag tells log dashboards + Sentry that the
deployment isn't one of the canned variants — useful when triaging
behaviour reports.

## Multi-brand deploys

If you need to run more than one product variant from one repository,
deploy multiple instances (Vercel projects + Neon databases), each
with its own `openmatch.config.ts`. See [multi-tenancy.md](./multi-tenancy.md)
for the explicit decision record and the `MultiTenantHooks` extension
hook for forks that want true in-process multi-tenancy.
