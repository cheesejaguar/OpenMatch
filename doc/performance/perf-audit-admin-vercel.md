# OpenMatch — Admin Dashboard + Vercel Performance Audit

**Branch:** `audit/perf-admin-vercel-readonly`
**Scope:** `admin/` (Next.js 15 / React 19), root `vercel.json`, `backend/api/index.ts`, `.github/workflows/ci.yml`
**Mode:** Read-only static analysis. No `next build` was executed — sizes / timings are estimated from source structure.
**Auditor:** Performance audit pass, 2026-05-21.

---

## Summary

The admin dashboard is, on the whole, a **lean, well-architected Next.js 15 App Router app**. It avoids every common bundle-size trap: no chart library, no UI framework, no Tailwind/CSS-in-JS runtime, no React Query, no data-grid lib. All charts (`TimeSeriesChart`, `Sparkline`, scatter, funnel) are hand-rolled SVG. The dependency surface is essentially `next`, `react`, `zod`, and `qrcode` — that is unusually disciplined for an admin app this feature-rich.

The trade-off the team has made — **"every admin page is `force-dynamic`, every fetch is `cache: "no-store"`, no Suspense / streaming, no client data fetching"** — is intentional and defensible for an admin app (PRD §11.3: admin pages MUST NOT be cached by intermediaries). It is, however, also leaving substantial latency on the table: every page renders end-to-end on the server in a single round-trip with no streaming, so **TTFB ≈ slowest backend fetch on the page**.

The highest-leverage findings are about that latency budget plus a few platform-level mis-configurations:

- **Single Vercel region (`iad1`)** with no documented Neon region pinning — every Postgres query crosses provider boundaries unless Neon is also in `us-east-1`.
- **No `Suspense` boundaries** anywhere → pages with 2+ awaited fetches block on the slowest leg.
- **Two fetch-waterfalls** that should be parallel: `/photos` (oldest panel chained after main list), `/reports` (same), and `/analytics` (cohort lookup blocks tab fetch).
- **Photo pages serve raw blob URLs at full resolution into a 160 × 160 CSS box** — no `next/image`, no thumbnailing on the backend, no `dangerouslyAllowSVG`-free path tried. On a 50-photo moderation page this can be 10-50 MB transferred to render < 100 KB of displayed pixels.
- **Two unused font weights bundled** (Fraunces Light, Geist Black) — minor, but explicitly called out in the audit brief.
- **Admin CI never runs `next build`** — type errors and bundling failures only surface on Vercel preview deployments, slowing the dev loop.
- **Crons** are scheduled on a single backend Function — fine on Fluid Compute, but `*/5` collisions could overlap with admin peak hours.

There are no `large`-severity correctness or security perf bugs; the gains here are mostly `medium` (latency under load) and `small` (bundle / build).

Total findings: **17** (1 large, 6 medium, 7 small, 3 informational).

---

## Route segment matrix

| Route                                    | Render | Client deps                | Awaited fetches | Notes |
| ---------------------------------------- | ------ | -------------------------- | --------------- | ----- |
| `/`                                      | RSC → redirect `/overview` | — | 0 | OK |
| `/overview`                              | RSC, force-dynamic | — | 1 (metrics overview) | OK |
| `/users`                                 | RSC, force-dynamic | — | 1 | OK |
| `/users/[userId]`                        | RSC, force-dynamic | `BanForm`, `NoteForm`, `UnbanForm` (client) | 2 (parallel — good) | OK |
| `/users/[userId]/photos`                 | RSC, force-dynamic | — | 1 | `<img>` raw blob URLs |
| `/users/[userId]/messages`               | RSC, force-dynamic | — | 1 | OK |
| `/conversations/[id]`                    | RSC, force-dynamic | `AccessReasonForm` (client) | 2 **sequential** | `convoRes` blocks `msgsRes`; could be parallel when no access-grant gate |
| `/reports`                               | RSC, force-dynamic | — | 1 + 1 **sequential** | "Oldest" panel chained after main list |
| `/reports/[reportId]`                    | RSC, force-dynamic | `ResolveForm` (client) | 1 | OK |
| `/photos`                                | RSC, force-dynamic | `PhotoActions` (client) | 1 + 1 **sequential** | same chain as `/reports` |
| `/photos` (image render)                 | — | — | — | `<img src=blob>` at full resolution |
| `/flags`                                 | RSC, force-dynamic | `FlagToggle`, `NewFlagModal` | 1 | OK |
| `/invites`                               | RSC, force-dynamic | `GenerateBatchModal`, `RevokeButton` | 1 | Cohort dropdown derived inline from items (OK) |
| `/audit`                                 | RSC, force-dynamic | — | 1 | 100-row table, no pagination size choice |
| `/feedback`                              | RSC, force-dynamic | — | 1 | OK |
| `/geography`                             | RSC, force-dynamic | — | 1 | Hand-rolled SVG scatter (good) |
| `/analytics?tab=funnel`                  | RSC, force-dynamic | — | 2 sequential (`invites` → tab) | Cohort dropdown blocks tab render |
| `/analytics?tab=retention`               | RSC, force-dynamic | — | 2 sequential | Same |
| `/analytics?tab=engagement`              | RSC, force-dynamic | — | 1 + 3 parallel | Engagement tab does `Promise.all` (good) but waits for cohort fetch first |
| `/health`                                | RSC, force-dynamic | — | 2 parallel | Good |
| `/settings/admins`                       | RSC, force-dynamic | — | 2 parallel | Good |
| `/login`, `/login/totp-{enroll,verify}`  | RSC, force-dynamic | — | — | TOTP-enroll runs `QRCode.toDataURL` on the server (OK, but blocks render) |
| `/login/callback`                        | Route Handler | — | — | OK |

**Verdict on `'use client'` split:** Every client component is correctly client-only — they all use `useState`, `useTransition`, `usePathname`, or DOM events (`onMouseMove`). There is **no over-eager `'use client'` in this codebase**. The split is genuinely good.

---

## Findings

### PERF-A1 — `force-dynamic` + `cache: "no-store"` + no Suspense means TTFB = slowest fetch on the page

**Severity / expected gain:** `large` (perceived latency on multi-fetch pages: ~30-50 % wall-clock improvement on `/users/[id]`, `/analytics`, `/health`, `/settings/admins`, `/photos`, `/reports`)
**Location:** All `admin/app/(app)/**/page.tsx`; `admin/lib/api/admin-client.ts:198` (`cache: "no-store"`)
**Description:**
Every admin page is `export const dynamic = "force-dynamic"`, every server fetch is `cache: "no-store"`, and **no page wraps slow fetches in `<Suspense>`**. The composition means:

1. Vercel cannot statically prerender any shell.
2. Next.js cannot start streaming HTML until the page component's top-level `await` resolves.
3. On any page with N parallel fetches, TTFB is `max(fetchN)` and the user sees nothing until then.

For `/users/[userId]` (user + notes), `/health` (snapshot + timeseries), `/settings/admins` (roles + admins), this is already mitigated with `Promise.all`. But all of those pages still render a blank screen until both legs return.

**Measurement basis:** Source-level inspection. Each `page.tsx` opens with `await adminFetch(...)` at top level; no `<Suspense>` exists anywhere in `admin/`.
**Recommendation:**
- Wrap the heavy data section of each page in a `<Suspense>` boundary with a `<Skeleton>` fallback (the `om-skeleton` CSS class already exists in `globals.css:472`).
- Extract the awaited fetch into a child async server component so the page shell streams immediately.
- Keep `dynamic = "force-dynamic"` and `no-store` — they're correct under PRD §11.3. Streaming is independent of caching.
- For pages with 2+ unrelated fetches (`/users/[id]`, `/health`, `/conversations/[id]`), stream each section independently.

**Risk:** Low. Adding Suspense is purely additive; PRD's "no caching" rule is about HTTP response caching, not streaming render.

---

### PERF-A2 — Sequential "oldest" panel fetches on `/reports` and `/photos`

**Severity / expected gain:** `medium` (one extra Postgres round-trip on every page load — ~80-300 ms in `iad1` → Neon)
**Location:**
- `admin/app/(app)/reports/page.tsx:31-35`
- `admin/app/(app)/photos/page.tsx:27-32`
**Description:** Both pages do:
```ts
const res = await adminFetch("/api/v1/admin/reports", { ... });
// ...then, only after that resolves:
const oldestRes = res.ok ? await adminFetch("/api/v1/admin/reports", { query: { status: "open", limit: 5 } }) : null;
```
The "oldest" panel doesn't depend on the main list — it's a fixed `{ status: "open", limit: 5 }` query. Chaining wastes a round-trip serially.
**Measurement basis:** Code inspection; both calls hit the same backend endpoint with independent filters.
**Recommendation:** Use `Promise.all([mainRes, oldestRes])`. Or — better — add a single backend endpoint `/api/v1/admin/reports/dashboard` that returns both shapes in one query (the "oldest" panel only changes when the report set changes, so caching it inside the backend for ~10 s is also fine).
**Risk:** Low. Pure parallelization.

---

### PERF-A3 — `/conversations/[id]` does `convo → messages` sequentially

**Severity / expected gain:** `medium` (one round-trip — same 80-300 ms)
**Location:** `admin/app/(app)/conversations/[conversationId]/page.tsx:38-69`
**Description:** Conversation metadata and the message list are fetched serially. They're independent (both keyed by `conversationId`). The serial pattern only makes sense because of the 412 access-reason gate, but `Promise.allSettled` would resolve both in one round-trip and still let the page render the gate when `msgsRes.status === 412`.
**Recommendation:**
```ts
const [convoRes, msgsRes] = await Promise.all([
  adminFetch<ConversationResponse>(`/api/v1/admin/conversations/${conversationId}`),
  adminFetch<MessagesResponse>(`/api/v1/admin/conversations/${conversationId}/messages`,
    { query: { accessGrantId: sp.accessGrantId, limit: 200 } }),
]);
```
**Risk:** Low. The 412 path still works; if `convoRes` 404s, the existing branch handles it before the messages render.

---

### PERF-A4 — `/analytics` blocks every tab on the cohort dropdown fetch

**Severity / expected gain:** `medium` (a 200-item invite list fetched on every page load just to populate a `<select>`)
**Location:** `admin/app/(app)/analytics/page.tsx:59-66`
**Description:** Before any tab renders, the page awaits `/api/v1/admin/invites?limit=200` to build the cohort dropdown. The dropdown is a UI affordance that almost no operator interacts with; making it a render blocker on every tab visit is expensive. Worse, the engagement tab then issues 3 more sequential-then-parallel fetches after this one resolves.
**Recommendation:** Move the cohort dropdown into a `<Suspense>` boundary (or compute cohorts from the data the tab itself returns). Run the tab fetch and the cohort fetch in `Promise.all`.
**Risk:** Low.

---

### PERF-A5 — Photo grids serve full-resolution blob URLs into 160 × 160 boxes

**Severity / expected gain:** `medium` (page-weight reduction: potentially 5-50 MB on `/photos` with 50 photos at full res; LCP improvement on /photos)
**Location:**
- `admin/app/(app)/photos/page.tsx:110`
- `admin/app/(app)/users/[userId]/photos/page.tsx:34`
- CSS: `admin/app/globals.css:407-423`
**Description:** Both pages render `<img src={p.url}>` with no width/height/sizes and the photos are sized via `.photo-grid .photo img { height: 160px; object-fit: cover }`. `p.url` is a `@vercel/blob` public URL (see `backend/src/lib/media.ts`), unmodified. There's no `next/image` (which would auto-resize via Vercel's image optimizer), no backend-side thumbnailing, no `?w=160` URL param, no `loading="lazy"`.

On a moderation page with 50 photos at 1024-2048 px source, this is megabytes per scroll, and **billable Vercel image-optimization bandwidth is being left on the table** — even if you avoided `next/image` you'd want a `thumbUrl` on the DTO.

**Measurement basis:** CSS rule fixes display at 160 × 160; `<img>` has no `sizes`/`srcset`; backend `PhotoDTO.url` is the raw blob URL.
**Recommendation:**
- Backend: emit a `thumbUrl` (or `url + ?w=320&q=70` if your blob backend supports query transforms) on `PhotoDTO`. Pre-bake 320×320 thumbs on upload via `sharp`.
- Admin: switch to `next/image` with `width={160} height={160}` and add the blob host to `images.remotePatterns` in `next.config.ts`. Vercel's image optimizer will then cache resized variants.
- Add `loading="lazy"` to off-screen photos (`next/image` does this automatically).
- Add `decoding="async"`.

**Risk:** Low. Backend change is additive (`thumbUrl` field); admin change is local.

---

### PERF-A6 — `next.config.ts` has no `images` config, no `experimental.optimizePackageImports`, no `output: "standalone"`, no `compress` toggle

**Severity / expected gain:** `small` (locks you out of `next/image`, the optimizePackageImports tree-shaker, and any Docker self-host path)
**Location:** `admin/next.config.ts` (whole file: 22 lines)
**Description:** The config is minimal — `reactStrictMode`, `poweredByHeader: false`, and the security-header `headers()` block. There is:
- No `images.remotePatterns` (required to use `next/image` with the Vercel blob host, see PERF-A5).
- No `experimental.optimizePackageImports` (the admin doesn't currently use any large barrel-import package, but if you add `lucide-react`, `date-fns`, or `radix-ui` later it's a free win).
- No `experimental.serverActions.bodySizeLimit` (defaults are fine, just calling it out).
- No `compiler.removeConsole` for prod (you have `console.error` calls in server actions; not critical but noisy in Vercel logs).

**Recommendation:** When PERF-A5 is implemented, add:
```ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
  ],
  formats: ["image/avif", "image/webp"],
},
```
**Risk:** None.

---

### PERF-A7 — `next.config.ts` sets blanket `Cache-Control: no-store` on **every** path including `/_next/static/*` and `/favicon.*`

**Severity / expected gain:** `medium` (every page navigation re-downloads JS/CSS chunks, fonts, and the favicon; full Web Vitals hit on repeat visits)
**Location:** `admin/next.config.ts:8-18`
**Description:**
```ts
async headers() {
  return [{ source: "/(.*)", headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate" }, ...] }];
}
```
The `source: "/(.*)"` matcher catches **everything Next serves**, including:
- `/_next/static/chunks/*.js`, `/_next/static/css/*.css` (content-hashed; safe to cache for a year)
- `/_next/static/media/*-<hash>.woff2` (next/font output, content-hashed)
- `/favicon.svg`, `/favicon.png`, `/om-mark.svg`

Hashed assets carry `immutable` semantics by definition — slapping `no-store` on them defeats Next's whole asset-versioning model. Every navigation re-fetches every chunk.

This was almost certainly intended to apply to **admin route documents only** (PRD §11.3), not to static assets.

**Measurement basis:** Code inspection. The matcher has no exclusion for `_next/static`, `_next/image`, or anything else.
**Recommendation:** Scope the `no-store` header to non-static paths only. Either:
```ts
{
  source: "/((?!_next/static|_next/image|favicon|om-mark).*)",
  headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate" }, ...],
},
```
or, more robust, add a second rule with `immutable` caching for `_next/static/(.*)`:
```ts
{ source: "/_next/static/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
```
**Risk:** Low — the security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) should remain on **all** paths; only the `Cache-Control` should be scoped.

---

### PERF-A8 — Two unused font weights shipped: Fraunces Light (300), Geist Black (900)

**Severity / expected gain:** `small` (~190 KB total: 64 KB Fraunces Light + 130 KB Geist Black — both subset by next/font/local but still in the bundle)
**Location:** `admin/app/layout.tsx:11,28`; `admin/app/fonts/Fraunces9pt-Light.ttf`, `Geist-Black.ttf`
**Description:** A repo-wide grep for explicit `font-weight: 300` / `font-weight: 900` (and the inline-style and CSS forms) finds **exactly one consumer**: `admin/components/nav/Sidebar.tsx:125` uses `fontWeight: 900` on the "om" wordmark. That's served by **Fraunces Black (900)** which is correctly used.

**Fraunces Light (300)** is loaded but referenced nowhere — the Phase B comment in `layout.tsx` says "Light (for delicate editorial moments)" but no rule, inline style, or component reads it. **Geist Black (900)** is similarly unreferenced. Geist Light (300) is also unused — `globals.css` only sets weights `500`-`600` and the default `400`.

**Measurement basis:** Repo-wide grep for `font-weight: 9*`, `font-weight: 3*`, `fontWeight: 900`, `fontWeight: 300`. Only one hit (Sidebar, Fraunces Black via `var(--font-fraunces)`).

**Recommendation:**
- Drop Fraunces Light (300), Geist Light (300), Geist Black (900) from `layout.tsx` unless there's an inbound design system requirement. Currently the SemiBold/Bold cuts cover all in-use weights.
- The two `.ttf` files can stay in `app/fonts/` for future use, but should not be loaded.
- Bonus: `.ttf` is 30-50 % larger than `.woff2`. `next/font/local` does subset the .ttf into `woff2` at build time, so on-the-wire size is OK; but **dropping unused weights from `localFont({ src: [...] })` is a pure win**.

**Risk:** None.

---

### PERF-A9 — Vercel function pinned to `iad1` only; no documented Neon region pin

**Severity / expected gain:** `medium` (every Postgres query is a cross-region round-trip if Neon is not also in `us-east-1` — typically 30-80 ms per query on warm connection)
**Location:** root `vercel.json:13` (`"regions": ["iad1"]`), `admin/vercel.json:6` (also `"iad1"`)
**Description:** Both projects are pinned to `iad1` (US East / Virginia). This is correct **only if** the Neon Postgres branch is also in `aws-us-east-1`. There's no documented region in `backend/src/env.ts` or `vercel.json`, and no comment explaining the choice.

Multi-region considerations:
- Fluid Compute (the new default) reuses instances per region; cold start in `iad1` is fine.
- The cron jobs run from the same region; if Neon is in another region every cron tick adds latency.
- The admin and api both pin `iad1` separately — they're independent projects; if one moves the other will silently misalign.

**Recommendation:**
- Add a comment in `vercel.json` linking the region choice to the Neon DB region.
- Confirm Neon branch region is `aws-us-east-1` (closest to `iad1`).
- Consider whether the admin app needs to be regional at all — it's HTML only, mostly. The admin app could go multi-region (default) and only the backend pin to the DB region. Right now they're both `iad1`, which means an admin user in Europe pays 100-150 ms RTT to receive HTML that itself blocks on more DB hits.
- (Future) Once Vercel AI Gateway / Edge Config land in the architecture, RBAC permission lookups would benefit from Edge Config (sub-10 ms global reads).

**Risk:** Low. Just verify Neon region.

---

### PERF-A10 — Backend Function memory + timeout: 1024 MB / 60 s — overkill for most calls

**Severity / expected gain:** `small` (cost — Active CPU + provisioned memory pricing)
**Location:** `vercel.json:7-11`
**Description:** `api/index.ts` is the single Fastify entry for the entire backend (including the admin API). The function is configured `memory: 1024 MB, maxDuration: 60 s`. Admin calls are sub-second; the cron jobs may legitimately need 60 s (deletion purge, daily digest), but the long timeout applies to **every** invocation including a 50 ms `/admin/metrics/overview` hit.

Under Vercel's Active CPU pricing (post-2024), idle time is not billed, but **provisioned memory** is billed for the duration of the request. 1024 MB × 60 s vs 1024 MB × 0.05 s makes no real difference; the gain here is mostly capping worst case.

**Recommendation:**
- Consider splitting the cron routes onto a separate Function with longer `maxDuration` (300 s is now the platform default), leaving the user-facing `api/index.ts` with `maxDuration: 15-30 s`. This gives you blast-radius isolation (a stuck cron can't pin a memory slot for admin).
- 1024 MB is fine for Prisma (Prisma alone is 80-150 MB resident); don't drop below 512 MB.
- Fluid Compute reuses instances, so memory isn't really the lever; it's CPU.

**Risk:** Low.

---

### PERF-A11 — Six cron jobs run from a single Function; `*/5` overlap during admin peak hours

**Severity / expected gain:** `small` (latency tail on admin endpoints when cron is mid-flight)
**Location:** `vercel.json:14-21`
**Description:** Six crons share the same Function instance pool with admin and user traffic:
- `*/5 * * * *` — `run-push-retry`
- `*/5 * * * *` — `run-alert-check`
- `*/5 * * * *` — `run-synthetic-check`
- `*/15 * * * *` — `run-deletion-purge`
- `0 * * * *` — `run-dsa-sla-check`
- `0 16 * * *` — `run-daily-digest`

Three `*/5` schedules **fire on the same wall-clock minute** (`:00`, `:05`, `:10`, …). At those minutes the function pool is processing three concurrent cron requests plus any user requests. The synthetic check is exactly the moment admins are most likely to be hitting `/health`.

**Recommendation:**
- Stagger the `*/5` crons (`0,5,10,…`, `1,6,11,…`, `2,7,12,…`) so they round-robin instead of stacking.
- Or move all crons onto a dedicated `api/cron.ts` function (separate function = separate concurrency budget on Fluid Compute).
- Consider Vercel Queues (public beta) for the retry/alert workloads — push from the originating Function instead of polling on a cron.

**Risk:** Low — pure scheduling tweak.

---

### PERF-A12 — Admin CI does not run `next build`, only lint + typecheck + vitest

**Severity / expected gain:** `medium` (build failures only surface on Vercel preview deploys; bundle regressions are invisible to PR review)
**Location:** `.github/workflows/ci.yml:151-206` (the `admin-dashboard` job)
**Description:** The admin job runs typecheck, lint, and `vitest run --coverage`, but **does not** run `npm run build -w @openmatch/admin`. Several classes of failure are therefore not caught in CI:
- "Module not found" in production-only code paths
- React Server Component boundary violations not caught by typecheck (e.g. importing `next/headers` in a `'use client'` file)
- Bundle-budget regressions
- Tree-shaking failures
- Failed font subsetting

Vercel preview builds catch all of these, but the feedback loop is 60-180 s slower than CI and shows up as a deploy failure rather than a PR check.

**Recommendation:** Add a `Build admin` step after typecheck:
```yaml
- name: Build admin dashboard
  run: npm run build -w @openmatch/admin
  env:
    ADMIN_API_BASE_URL: http://localhost:0
    ADMIN_SESSION_SECRET: ci-only-secret-not-real
```
(The build doesn't need a live backend — `next build` only needs env vars that the admin code reads at build time.)

Bonus: gate bundle size with `@next/bundle-analyzer` or a hand-rolled `du -sh admin/.next` check.

**Risk:** Low. Adds ~30-60 s to the admin CI job.

---

### PERF-A13 — Every admin server fetch is `cache: "no-store"`; no `unstable_cache` / `revalidateTag` for slow-moving data

**Severity / expected gain:** `small` (some endpoints — roles catalog, cohort labels, admin user list — change daily, not per-request)
**Location:** `admin/lib/api/admin-client.ts:198`; usage across `app/(app)/**/page.tsx`
**Description:** `adminFetch` hardcodes `cache: "no-store"`. This is the right default for sensitive admin data (PRD §11.3) but it forecloses on legitimate caching for:
- `/api/v1/admin/roles` (`/settings/admins` — changes only when role catalog is edited)
- The cohort label list in `/analytics` (changes only when invites are issued)
- Geography metro list (`/geography` — static for weeks)

For these, `unstable_cache` + a `revalidateTag` call from the admin mutation server action would cut TTFB by a fetch round-trip without compromising security.

**Recommendation:**
- Add a second helper `adminFetchCached<T>(path, opts, { tags, revalidate })` that uses `next: { tags, revalidate }` instead of `cache: "no-store"`.
- Use only for whitelisted non-PII endpoints.
- Wire the corresponding `revalidateTag` calls into the relevant server actions (`admins.ts`, `flags.ts`, `invites.ts`).

**Risk:** Medium — every endpoint added to the cache list needs a security review (don't cache anything user-specific or sensitive). Whitelist-style.

---

### PERF-A14 — `usersList` and `audit` pages render 50-100 row tables in one shot with no skeleton

**Severity / expected gain:** `small` (perceived performance — CLS-equivalent on slow connections)
**Location:** `admin/app/(app)/users/page.tsx`, `admin/app/(app)/audit/page.tsx`
**Description:** The `/users` and `/audit` pages render 50-100 row tables. With `force-dynamic` + no `<Suspense>`, the user sees a blank header until the table is ready. The `om-skeleton` CSS class already exists in `globals.css:472` and `Skeleton.tsx` is a 30-line component — but they're not used by any page.
**Recommendation:** With PERF-A1, wrap the table in `<Suspense fallback={<TableSkeleton rows={25} />}>`. Even a static-shell render with a skeleton is a substantial perceived-perf upgrade.
**Risk:** None.

---

### PERF-A15 — `DataTable` is client-side sort + pagination over the entire response payload

**Severity / expected gain:** `small` (only used in `/analytics` and `/geography`; row counts are small (~25), so impact is minor today)
**Location:** `admin/components/ui/DataTable.tsx:46-181`
**Description:** `DataTable` is a `'use client'` component that takes the full data array as a prop and sorts/pages client-side. For the current usage (funnel = ~10 rows; geography = ~30 rows), this is fine. **But** every usage:
- Serializes the entire dataset over the wire from server → client (RSC props serialization).
- Re-runs `[...data].sort()` on every prop change.
- Loses sort/page state on every server-action that triggers a re-render.

This won't scale — if `/audit` (which renders 100-row pages) were ever switched to `DataTable`, you'd serialize 100 cuid + timestamp + JSON-snapshot rows on every request. The `useMemo` keyed on `data` means a refresh wipes sort state.
**Recommendation:**
- Document that `DataTable` is for <100-row datasets only.
- Push pagination + sort to the backend for any table that can grow beyond a single page (audit, users, reports). The existing cursor-based pagination already does this for those tables — they intentionally do **not** use `DataTable` (good).
- Optional: switch to controlled state stored in URL search params so a hard refresh preserves sort/page.

**Risk:** None — informational guardrail.

---

### PERF-A16 — `TimeSeriesChart` hover handler is on the SVG root, not throttled; potential INP regression on engagement tab

**Severity / expected gain:** `small` (INP on the engagement tab — three charts with mouse-move handlers)
**Location:** `admin/components/ui/TimeSeriesChart.tsx:133-146,156`
**Description:** `handleMove` is on `onMouseMove` (fires every mouse event, often 60-120 Hz on a trackpad) and triggers two `useState` setters per event. With three chart instances on the engagement tab, that's up to 360 state updates per second across the page during a horizontal mouse drag.

React 19 batches these, but each one still re-renders the whole `<svg>` tree (path strings recomputed via `useMemo`, but everything else recomputes). This is the most likely INP regression in the entire admin.
**Recommendation:**
- Throttle / `rAF` the hover handler: store the latest event in a ref, update state in `requestAnimationFrame`.
- Or use `onPointerMove` with passive event behavior (browser default for SVG is non-blocking).
- The early-return when `px < PAD_L || px > width - PAD_R` is good — keep it.

**Risk:** Low — change is local to one component.

---

### PERF-A17 — Plain `<img src="/om-mark.svg">` in the sidebar is rendered into every admin route document

**Severity / expected gain:** `informational` (the file is 1 KB SVG; comment in code explains why `next/image` is intentionally not used)
**Location:** `admin/components/nav/Sidebar.tsx:75-79`
**Description:** Already documented in the source comment — SVG with embedded font data, `next/image` would require `dangerouslyAllowSVG`. Correct decision. **Just add `decoding="async"` and `width`/`height` are already set, which is correct.**
**Recommendation:** No change. Documenting as confirmed.
**Risk:** None.

---

## Bonus: things the team got right (intentionally informational)

1. **Zero chart library, zero UI framework.** Hand-rolled SVG everywhere (`Sparkline`, `TimeSeriesChart`, scatter plot, funnel bars). This is the single largest reason the admin bundle is small.
2. **Disciplined `'use client'` split.** Every client component is a real interactivity surface (`useState`, `useTransition`, `usePathname`). The audit found zero false-positives.
3. **Server actions used consistently** for mutations with `revalidatePath` invalidation — exactly the App Router idiom.
4. **`Promise.all` already used** on the multi-fetch pages that matter most: `/users/[id]`, `/health`, `/settings/admins`, the engagement tab's three timeseries.
5. **Security headers + middleware** are properly scoped (modulo PERF-A7's over-broad cache header).
6. **`next/font/local`** with `display: "swap"` — correct setup; the only issue is unused weights (PERF-A8).
7. **No `<Image>` proxy leak.** Because the admin doesn't use `next/image`, there's no risk of the admin session cookie leaking to a third-party CDN via `next/image` rewrites — but this is currently incidental, not by design. Once PERF-A5 lands and `next/image` is enabled, verify `images.loader` stays on Vercel's default (no third-party loader).

---

## Suggested priority queue

| # | Finding | Effort | Gain |
| - | ------- | ------ | ---- |
| 1 | PERF-A7 — fix `no-store` on `_next/static` | XS (5-line config change) | medium |
| 2 | PERF-A1 — add `<Suspense>` to multi-fetch pages | M | large |
| 3 | PERF-A5 — backend thumb URL + `next/image` for photos | M | medium |
| 4 | PERF-A12 — run `next build` in CI | XS | medium |
| 5 | PERF-A2 / PERF-A3 / PERF-A4 — parallelize sequential fetches | S | medium |
| 6 | PERF-A9 — document Neon region pin | XS | medium |
| 7 | PERF-A8 — drop unused font weights | XS | small |
| 8 | PERF-A11 — stagger cron schedules | XS | small |
| 9 | PERF-A16 — throttle chart hover | XS | small |
| 10| PERF-A13 — `unstable_cache` whitelist | M | small |
