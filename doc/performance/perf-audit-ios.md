# iOS performance audit — OpenMatch

Scope: read-only static analysis of `ios/OpenMatch/` on branch
`audit/perf-ios-readonly`. No code was modified.

Methodology: file-level review of the App entry point, state graph,
networking layer, swipe / chat / likes flows, photo pipeline, animation
hot spots, and bundled assets. Findings are static-analysis-grade —
Instruments (App Launch template, Time Profiler, Allocations, Animation
Hitches, Network) would confirm the magnitude of each estimate.

Severity legend:
- `large`        — > 100 ms launch / > 16 ms frame regressions, or > 5 MB
  memory.
- `medium`       — 30-100 ms / 4-16 ms frame, or 1-5 MB memory.
- `small`        — < 30 ms / < 4 ms frame; polish gain.
- `informational` — no measurable user impact today; documented for
  future-proofing.

---

## Summary

The single most impactful change is to **stop creating a brand-new
`APIClient` inside `LikesView.init`** (PERF-I3); right behind it sit
the **`AsyncImage`-only photo pipeline** (PERF-I4 — no cache, no
thumbnail, full-res decoded on the main thread) and the
**main-thread keychain reads inside `APIClient.init`, which is itself
called inside `AppState()` on the App `init`** (PERF-I2). After those
three, the **120-particle Canvas in `MatchCelebrationView`** (PERF-I7)
and the **per-character spring storm in `MatchOverlayView`** (PERF-I8)
are the only animations that realistically risk dropped frames on iPhone
12 / iPhone SE. Bundle weight is healthy (~1.4 MB fonts, 68 KB AppIcon);
the one easy bundle win is removing the unused `Fraunces9pt-Light` and
`Geist-Light` cuts (PERF-I12, ~190 KB).

The structural finding that runs through several entries is the absence
of a real image-loading library. `AsyncImage` has no on-disk cache, no
memory cache after view dismissal, no thumbnail sizing, and decodes on
the main thread on first display. Every photo-heavy surface in the app —
swipe deck, profile preview, edit profile, onboarding, likes (once
likes-avatars are wired up) — pays this cost on every appearance.

---

## Findings

### PERF-I1 — `OMFont.debugDumpAvailableFamilies()` runs on every launch

- Severity / expected gain: **small** (DEBUG only; ~10-30 ms first
  launch).
- Location: `ios/OpenMatch/OpenMatchApp.swift:16`,
  `ios/OpenMatch/DesignSystem/OMTypography.swift:88-103`.
- Description: `OpenMatchApp.init` calls
  `OMFont.debugDumpAvailableFamilies()` synchronously before `body` is
  constructed. The body of that function is wrapped in `#if DEBUG` so
  Release builds are unaffected, but DEBUG launches pay three
  `UIFont.fontNames(forFamilyName:)` calls plus three `print(...)`
  invocations on the main thread. `UIFont.fontNames(forFamilyName:)`
  triggers the lazy font-registry scan; on a cold launch this is on the
  critical path to first frame. Production-mode launches are unaffected.
- Measurement basis: static analysis. Instruments App Launch on a DEBUG
  build would show ~10-30 ms attributable to `UIFontDescriptor` loads
  on the first call.
- Recommendation: defer behind
  `DispatchQueue.main.async` or call from `Task.detached(priority: .utility)`
  so it doesn't block first-frame measurement during DEBUG. Even better:
  gate it behind a launch arg (`-OMDumpFonts`) so it only runs when the
  designer is debugging missing fonts.
- Risk: none — DEBUG only.

### PERF-I2 — `AppState` init does synchronous Keychain reads + fan-out on the main actor before first frame

- Severity / expected gain: **medium** (50-150 ms typical, longer
  immediately after device unlock when SEP is warming up).
- Location: `ios/OpenMatch/State/AppState.swift:24-66`,
  `ios/OpenMatch/Networking/APIClient.swift:344-372`,
  `ios/OpenMatch/Persistence/Keychain.swift:51-72`.
- Description: `OpenMatchApp.init` constructs `AppState()` via
  `@StateObject`. `AppState.init` is `@MainActor` and does, on the main
  thread, in order: build `APIClient`, which itself reads three keychain
  items (`accessToken`, `refreshToken`, `userId`) via
  `SecItemCopyMatching`; the `read` path also detects legacy attribute
  classes and synchronously rewrites them (PERF-I2a) via
  `SecItemAdd` + `SecItemDelete`; then constructs a `URLSession` with a
  custom delegate, sets a closure on `AppDelegate.shared`, fires three
  `Task { ... }` blocks (handedness refresh, analytics attach, optional
  realtime connect), and pulls `Bundle.main.object(forInfoDictionaryKey:)`
  inside `CertPinning.configuredPins`. `SecItemCopyMatching` is
  documented as potentially blocking on Secure-Enclave-resident items.
  Three of them, plus a same-pass rewrite, on the main thread, before
  the first `body` evaluation, is on the critical path.
- Measurement basis: static analysis; Instruments Time Profiler with
  "Heaviest Stack Trace" filtered to the main thread on launch will
  show `SecItemCopyMatching` and `SecItemAdd` in the stack between
  `OpenMatchApp.init` and `RootView.body`.
- Recommendation:
  1. Keep `APIClient.init` synchronous but move the keychain reads into a
     `loadSession()` method called from a `.task` on `RootView`. Show the
     `.loading` `ProgressView` (already present in `RootView.swift:44`)
     for the ~50 ms it takes.
  2. Have `AppState.auth` default to `.loading` and let
     `RootView.task` flip it once the keychain probe completes off-main
     via `Task.detached`.
- Risk: low; the `RootView` already has a `.loading` branch that returns
  `ProgressView`. The behavioural contract changes only in that the
  loading spinner is shown ~50 ms longer on cold launch.

### PERF-I2a — Keychain `read` performs a write-through migration on every cold-start read

- Severity / expected gain: **small** (one-shot per upgrade — but the
  check itself runs every read).
- Location: `ios/OpenMatch/Persistence/Keychain.swift:65-71`.
- Description: every successful `read()` inspects
  `kSecAttrAccessible` + `kSecAttrSynchronizable` and, if either
  differs from the hardened target, calls `write(key, value)` — which
  in turn does `SecItemDelete` + `SecItemAdd`. For users on the
  hardened storage path the comparison is always false, but the cost
  of fetching the attributes (`kSecReturnAttributes = true`) is non-zero
  and Swift's `as? [CFString: Any]` cast happens on every call.
- Measurement basis: static analysis.
- Recommendation: cache a boolean flag in `UserDefaults`
  (`openmatch.keychain_migrated_v1`); skip the attribute fetch and the
  rewrite once it's set.
- Risk: low — the migration semantics are preserved by an explicit
  one-shot.

### PERF-I3 — `LikesView` constructs a fresh `APIClient` inside its `@StateObject` initializer

- Severity / expected gain: **large** (one extra `URLSession` per
  user session, plus duplicate keychain reads on first navigation to
  Likes; also masks auth issues by using a non-shared session).
- Location: `ios/OpenMatch/Features/Likes/LikesView.swift:29-31`.
- Description:

  ```swift
  init() {
      _vm = StateObject(wrappedValue: LikesViewModel(api: APIClient(baseURL: APIConfig.defaultBaseURL)))
  }
  ```

  This allocates an entirely new `APIClient` (with its own URLSession,
  pinning delegate, JSONDecoder / JSONEncoder, and three keychain
  reads) instead of using the one in `appState.api` that's already
  injected via the environment. The session pool is not shared with the
  swipe / chat code paths, so HTTP/2 connection coalescing is lost; the
  PinningSessionDelegate is instantiated a second time; and the
  keychain reads (PERF-I2a) repeat on the main thread the first time
  the Likes tab is opened.

  As a side-effect, `LikesViewModel.api` is the *new* client, not the
  one observing token refreshes for the rest of the app, so a token
  rotation that the main client performs will not be reflected here
  until the view is recreated.
- Measurement basis: static analysis. Confirmed by comparing the
  pattern to `ChatListView` (`ChatListView.swift:20`) and
  `SwipeDeckView` (`SwipeDeckView.swift:5-22`), which both use
  `vm.api = api` from `.task { … }` against the env-injected client.
- Recommendation: mirror the swipe / chat pattern. Initialize
  `LikesViewModel()` with no API, expose `var api: APIClient?`, and
  wire it inside `.task { vm.api = api; await vm.load() }`.
- Risk: trivial; behaviourally identical, and brings Likes onto the
  same session pool as the rest of the app.

### PERF-I4 — Photos use `AsyncImage` (no cache, no thumbnail, main-thread decode)

- Severity / expected gain: **large** (highest-traffic flow; 16-50 ms
  hitches on first display, repeated download on every swipe).
- Location: `ios/OpenMatch/Features/Swipe/PhotoCarouselView.swift:13-26`,
  `ios/OpenMatch/Features/Profile/ProfileHomeView.swift:356-367,398-403`,
  `ios/OpenMatch/Features/Onboarding/OnboardingFlowView.swift:194-205`.
- Description: every photo surface in the app uses SwiftUI's
  `AsyncImage`. SwiftUI's `AsyncImage`:
  1. Has no on-disk cache. The URL is re-downloaded every time the
     view is re-instantiated. The swipe deck reinstantiates the top
     `ProfileCardView` every swipe (the `.id(top.profileId)` on
     `SwipeDeckView.swift:142` forces this), so each new card pays a
     fresh round-trip even if the same profile is shown again after an
     undo.
  2. Has no memory cache shared across views. Switching tabs and
     coming back re-downloads.
  3. Has no thumbnail size negotiation. The server returns
     `photo.cdnUrl` (Vercel Blob, presumably full-resolution — the
     uploader resizes the longest edge to 1600 pt; the swipe-card
     thumbnail is at most ~390 pt wide on an iPhone 15 Pro). Every
     swipe pays ~5-8× the bytes it needs.
  4. Decodes on the main thread. The decoded `CGImage` is materialised
     when SwiftUI commits the `Image` to the render tree.
  5. The `PhotoCarouselView` keeps only the current photo in the
     hierarchy (good — see PERF-I5), but each navigation discards the
     decoded image of the previous photo, so swiping back through a
     carousel re-downloads + re-decodes.
- Measurement basis: static analysis; cross-referenced with the
  `cdnUrl` field on `APIModels.swift:83`. The known performance shape
  of SwiftUI `AsyncImage` is documented by Apple (no cache) and widely
  discussed in WWDC sessions. Instruments Animation Hitches on a cold
  swipe-tab open would attribute frame drops to the photo-decode
  pipeline.
- Recommendation: adopt Nuke (small, MIT, single dependency) or
  Kingfisher. Both give: bounded memory + disk LRU caches, background
  decompression, thumbnail size resolution (Nuke
  `ImageProcessors.Resize`), and per-request `priority` so off-screen
  carousel photos can fetch at `.low`. If a third-party dep is
  unwanted, write a 100-line wrapper over `URLCache` +
  `CGImageSourceCreateThumbnailAtIndex` + an `OSCache`-style memory
  store; this is the minimum viable photo pipeline for a dating-app
  swipe surface.

  Also add a `size=` (or `w=`) query string on `cdnUrl` so the backend
  can return a 600 pt CDN-served thumbnail for swipe cards. The
  current Vercel Blob URL has no transform hint.
- Risk: medium. Image-library choice has long-term implications; we
  recommend Nuke for footprint. A wrapper-based approach is fine for
  V1 but should be re-evaluated once retention metrics push photo
  fetches above ~10 per session.

### PERF-I5 — `PhotoCarouselView` is not pre-fetched

- Severity / expected gain: **medium** (every swipe-to-next inside a
  carousel hitches for the duration of the network fetch — typically
  150-400 ms on LTE).
- Location: `ios/OpenMatch/Features/Swipe/PhotoCarouselView.swift:7-27`.
- Description: The carousel renders only `photos[clampedIndex]` in
  the hierarchy — virtualization is correct — but there is no
  pre-fetch of `photos[clampedIndex + 1]`. Tapping forward shows the
  `BotanicPlaceholder` + `ProgressView` until the next photo is
  downloaded. On a swipe-deck card the user typically taps through
  all 4-6 photos quickly; the first tap is the only one that should
  ever spin.
- Measurement basis: static analysis.
- Recommendation: once you adopt a real image loader (PERF-I4), call
  its prefetcher with the next two photo URLs in `onChange(of: index)`.
  Nuke ships `ImagePrefetcher`; URLSession has
  `URLSessionTask.priority`.
- Risk: none; pre-fetched photos count against the LRU cache budget,
  which is the loader's problem.

### PERF-I6 — `ProfileCardView` re-renders on every drag offset change

- Severity / expected gain: **medium** (4-8 ms per drag-update frame
  on iPhone 12-class hardware; perceptible as a less-than-buttery
  drag on older devices).
- Location: `ios/OpenMatch/Features/Swipe/SwipeDeckView.swift:129-143`,
  `ios/OpenMatch/Features/Swipe/ProfileCardView.swift:18-95`.
- Description: `SwipeDeckView` passes `dragOffset` directly into
  `ProfileCardView` as a stored property. Every drag update modifies
  `@State var dragOffset` → SwiftUI re-evaluates the body of
  `cardStack` → `ProfileCardView` is reconstructed with the new
  `dragOffset` → the body of `ProfileCardView` re-runs end-to-end,
  including the `intent` derived property and the `edgeGlow`
  RadialGradient ZStack. The back-card `ProfileCardView` is
  pre-positioned (PERF-good — `dragOffset: .zero`, `displayMode:
  .preview`) but is still recomposed each time because the parent
  body re-runs.

  The `.animation(.interactiveSpring, value: dragOffset)` modifier
  is on the outermost `.offset` of the top card, which is correct,
  but doesn't help the back card.
- Measurement basis: static analysis. SwiftUI Instruments would show
  the diff cost: confirm with the "View Body" lane.
- Recommendation:
  1. Move the back-card render to a sibling that doesn't take
     `dragOffset`. Currently the back card is *inside* the same
     `cardStack` function whose enclosing view depends on
     `dragOffset`, so it re-runs alongside. Hoist the back card into
     a `@ViewBuilder` that only depends on `vm.cards`.
  2. Split `ProfileCardView` so the photo-stack (the expensive
     `PhotoCarouselView`) is in a child that doesn't depend on
     `dragOffset`. Only the `edgeGlow` + `CornerBadge` overlays need
     the drag intent.
- Risk: low; correctness-preserving refactor.

### PERF-I7 — `MatchCelebrationView` runs 120 particles via `Canvas + TimelineView(.animation, minimumInterval: 1/60)`

- Severity / expected gain: **medium** (1.8 s of 60 fps Canvas drawing;
  iPhone 12 and below may drop frames during this burst; reduceMotion
  path is correct).
- Location: `ios/OpenMatch/Features/Swipe/MatchCelebrationView.swift:32-129`.
- Description: 120 particles, each drawn either as a circle or as a
  six-vertex sparkle path, every frame. `Canvas` is unaccelerated for
  small primitive batches; it executes on the main thread because
  `TimelineView(.animation)` ticks on the main render loop. Per-frame
  cost on iPhone 12 hardware is bounded by Path construction and a
  per-particle `GraphicsContext.Shading.color` allocation:
  `120 × 60 = 7200 path constructions per second`. The burst lasts
  1.8 s, so we're talking ~13K path constructions over the
  celebration. Newer hardware (A15+) absorbs this. iPhone 12 / A14
  may drop 2-4 frames at the start of the burst (peak particle
  density).

  The radial pulse on top of the particles uses
  `GraphicsContext.addFilter(.blur(radius: 8))` (line 78) — `Canvas`
  filters are not GPU-accelerated the way `.blur` on a regular view
  is; this is a real cost.
- Measurement basis: static analysis. Confirmable with Instruments
  Animation Hitches against a deployed build on an iPhone 12 device.
- Recommendation: gate particle count by `ProcessInfo.processInfo
  .thermalState != .nominal` → 60 particles, otherwise 120.
  Alternatively, replace the per-frame `Canvas` particles with a
  pre-rendered `SpriteKit` SKEmitter (much cheaper per particle), or
  drop the `.blur(radius: 8)` filter on the pulse — it's barely
  perceptible at the alpha level used (0.55 × (1-p)). The simplest
  win is making the second-stage particle count adaptive to device
  class.
- Risk: low for the device-tier gating; medium for swapping to
  SpriteKit (introduces a framework dependency).

### PERF-I8 — `MatchOverlayView` runs 12 simultaneous per-character spring animations

- Severity / expected gain: **small** (each `.animation` registers a
  separate SwiftUI animation node; 12 of them resolve simultaneously
  and the `ForEach(Array(...enumerated()))` constructs a new array on
  every body call).
- Location: `ios/OpenMatch/Features/Swipe/MatchOverlayView.swift:114-134`.
- Description: `"It's a match"` is exploded into 12 `Text` views, each
  with its own `.animation(.spring(...).delay(0.06 * index), value:
  titleAppeared)`. SwiftUI handles each modifier as an independent
  implicit-animation node. The cost is bounded — 12 spring evaluations
  per frame for ~600 ms — and is far below the threshold of a hitch,
  but it also exposes one subtle issue: `Self.titleCharacters` is
  declared `static let` (good), but the `ForEach` wraps it in
  `Array(...enumerated())` (line 116), which constructs a new
  `[(Int, Character)]` array on every body call. The body of
  `MatchOverlayView` re-evaluates on `titleAppeared` toggle and on
  every layout pass while the spring is in flight.
- Measurement basis: static analysis.
- Recommendation:
  1. Hoist
     `private static let indexedTitle: [(Int, Character)] = Array("It's a match".enumerated())`
     so the array isn't reallocated per body call.
  2. Optionally collapse 12 individual `.animation()` modifiers into a
     single `withAnimation` block driven by a `Timer` that flips a
     `revealedIndex: Int` state; this halves the animation-graph
     node count but is more code. The current implementation is fine
     in practice on A14+ devices.
- Risk: trivial.

### PERF-I9 — `URLSession` config does not raise `httpMaximumConnectionsPerHost` and uses default request timeouts

- Severity / expected gain: **medium** (parallel signed-photo URL
  fetches serialize through HTTP/2 head-of-line by default; on a
  cold backend the default 60 s timeout can blackhole the UI).
- Location: `ios/OpenMatch/Networking/APIClient.swift:344-372`.
- Description:

  ```swift
  let cfg = URLSessionConfiguration.default
  cfg.waitsForConnectivity = true
  ```

  — that's the whole configuration. The defaults are
  `httpMaximumConnectionsPerHost = 6` (good for HTTP/1.1, irrelevant
  for HTTP/2 which multiplexes on a single connection),
  `timeoutIntervalForRequest = 60`, `timeoutIntervalForResource =
  604800`. The 60 s request timeout is too generous for an interactive
  swipe app — a user who sees no response in 8-10 s will manually
  retry; the in-flight request is still consuming a slot.
  `waitsForConnectivity = true` is correct for an in-progress upload,
  but for a `loadDeck` call we'd rather fail fast and let the UI
  re-issue.

  The session does not configure
  `urlCache`, so the OS-managed `URLCache.shared` is used. Combined
  with the absence of `Cache-Control` headers on the backend, no
  responses are actually cached on disk.

  The session does not configure `httpAdditionalHeaders` for
  per-request acceptance encoding (the OS adds gzip by default, which
  is fine), but it also means there's no `User-Agent` set, which
  hurts server-side observability.
- Measurement basis: static analysis.
- Recommendation: set `cfg.timeoutIntervalForRequest = 15`,
  `cfg.timeoutIntervalForResource = 60`,
  `cfg.httpMaximumConnectionsPerHost = 8` (covers HTTP/1.1 fallback
  paths), `cfg.requestCachePolicy = .useProtocolCachePolicy`, and
  emit a versioned `User-Agent` via `httpAdditionalHeaders`. Switch
  `waitsForConnectivity` to `false` for read-only requests and keep
  `true` only on the multipart upload path
  (`uploadMultipartInner`).
- Risk: low.

### PERF-I10 — JSONDecoder and JSONEncoder are reused, but every `request<B, T>` constructs a new generic specialization

- Severity / expected gain: **informational**.
- Location: `ios/OpenMatch/Networking/APIClient.swift:335,363-366`.
- Description: `decoder` and `encoder` are stored on `APIClient`, so
  no per-request allocation — good. The generic `request<B: Encodable,
  T: Decodable>(...)` is specialized per `(B, T)` pair at compile time;
  that's not a perf bug, just a metadata cost. No action required.

### PERF-I11 — No request de-duplication for concurrent fetches of the same path

- Severity / expected gain: **small** (rarely triggered, but the
  pattern is fragile — see `ProfileHomeView` / `LookingForView`
  parallel `getProfile()` calls during view switches).
- Location: `ios/OpenMatch/Networking/APIClient.swift:739-756` and
  call sites.
- Description: there is a `refreshTask` coalescing only the
  `/api/v1/auth/refresh` call (lines 926-956). All other endpoints
  are unprotected — two views racing to call `loadDeck` /
  `getProfile` / `incomingLikes` on tab-switch in the first second
  will fire duplicate requests. None of the current call sites
  appear to race in practice (each view's `.task` runs once on
  appearance), but the swipe-tab `vm.cards.removeAll(...)` +
  `await vm.load()` pattern at `SwipeDeckView.swift:62-65` will
  duplicate the deck fetch if the tab is rapidly switched away and
  back during a refresh.
- Measurement basis: static analysis.
- Recommendation: add a small in-flight task map keyed by
  `(method, path, body-hash)` for idempotent GETs; coalesce duplicates.
  Defer until product analytics confirm tab-thrash is a real pattern.
- Risk: none today.

### PERF-I12 — Unused font cuts are shipped in the bundle

- Severity / expected gain: **small** (bundle size, ~190 KB saved).
- Location: `ios/OpenMatch/Resources/Fonts/`,
  `ios/OpenMatch/DesignSystem/OMTypography.swift:23-53`.
- Description: the typography mapping at
  `OMTypography.swift:21-39` maps `DisplayWeight.light` and `.medium`
  to other cuts (Regular and SemiBold respectively) because the
  9 pt static range doesn't ship Light or Medium italics. However,
  `Fraunces9pt-Light.ttf` (64 KB) is still bundled and never used
  via `Font.custom("Fraunces9pt-Light", ...)` outside the dump
  helper. `Geist-Light.ttf` (124 KB) is bundled but only referenced
  from `OMFont.body(_, weight: .light)`, which has no call sites in
  the audited code (grepped `.light` weight on `OMFont.body`; zero
  hits in `Features/`).
- Measurement basis: static analysis; the find above lists the
  files, the grep below confirms zero call sites for the `.light`
  body weight in feature code:
  - `Fraunces9pt-Light.ttf`: only the `.light` case in `postscript`
    references it.
  - `Geist-Light.ttf`: only `OMFont.body(... weight: .light)`
    references it; no feature code calls `.light` on body.
- Recommendation: remove `Fraunces9pt-Light.ttf` and
  `Geist-Light.ttf` from `Info.plist`'s `UIAppFonts` and from the
  app target. Or use a font subsetter (pyftsubset) to strip
  unused glyphs from the cuts you do keep — Fraunces has a wide
  language range (~3000 glyphs); restricting to Latin Extended
  drops ~50 % per file.
- Risk: trivial; if the design system ever re-introduces a Light
  cut you re-add the file. Subsetting needs visual verification.

### PERF-I13 — `MessageQueue.save` is synchronous on the main actor on every enqueue / deliver / failure

- Severity / expected gain: **small** (~1-3 ms per message
  enqueue on flash storage; multiplied by message volume).
- Location: `ios/OpenMatch/Features/Chat/MessageQueue.swift:147-149,276-297`.
- Description: `MessageQueue` is `@MainActor`. Every state change
  (`enqueue`, `retry`, `discard`, `deliver` success or failure)
  calls `persist()` → `storage.save(items)` → JSON-encode + atomic
  write on the main thread. For typical chat volume this is fine,
  but a user typing 5-10 messages in quick succession during a
  flaky network burst pays 5-10 main-thread writes.
- Measurement basis: static analysis.
- Recommendation: move `FileMessageQueueStorage.save` off the main
  actor: declare `MessageQueueStorage` as a non-isolated protocol
  (it already is — `protocol MessageQueueStorage: AnyObject` at
  line 162), and dispatch `save` to a serial background queue
  (`DispatchQueue(label: "openmatch.queue.save")`). The encoder is
  already stored on the storage object, so no per-call allocation.
- Risk: low; the queue must persist in causal order. A serial
  background queue preserves that.

### PERF-I14 — `Analytics.flushTask` retains the actor via a strong `self` in the timer loop

- Severity / expected gain: **informational** (Analytics is `shared`
  / global, so it lives forever; the loop's `[weak self]` is
  defensive and correct).
- Location: `ios/OpenMatch/Observability/Analytics.swift:27-34`.
- Description: `flushTask = Task { [weak self] in while !Task.isCancelled
  { try? await Task.sleep(...); await self?.flush() } }`. Correct.
  But the sleep uses `self?.flushIntervalSeconds ?? 5` — a guard against
  the actor having been deallocated; since `Analytics.shared` is a
  singleton, this branch is never taken in production. No bug, just
  noise.
- Recommendation: none.
- Risk: none.

### PERF-I15 — `ConversationView` polls the queue every 10 s with `Task.sleep` even when no pending messages exist

- Severity / expected gain: **small** (one timer wakeup every 10 s
  while a chat is foregrounded; battery cost negligible but
  non-zero).
- Location: `ios/OpenMatch/Features/Chat/ConversationView.swift:283-292,131-136`,
  `ios/OpenMatch/Features/Chat/MessageQueue.swift:92-100`.
- Description: a `Task` loop sleeps 10 s then calls `vm?.tick()`,
  which always calls `queue.attemptDeliver(api:)`. `attemptDeliver`
  early-exits when `due` is empty, but the wake-up still happens.
  Since the queue is also driven by `openMatchDidForeground`
  notifications + explicit user retry, the poller is mostly belt-
  and-braces. With Ably delivering server-acks via realtime, the
  poller's job is to retry pending sends.
- Measurement basis: static analysis.
- Recommendation: gate the poll on `vm.pending.isEmpty == false`.
  If the queue is empty, suspend the poll until `enqueueDraft()`
  is called. Marginal gain; consider only if power audits flag it.
- Risk: low.

### PERF-I16 — `LikesView` does not paginate

- Severity / expected gain: **medium** (only material for users
  with > 100 incoming likes; the response also includes the
  liker's bio inline, so payload grows linearly).
- Location: `ios/OpenMatch/Features/Likes/LikesView.swift:13-22,70-78`.
- Description: `incomingLikes()` returns the full list; the view
  renders `vm.likes` in a `LazyVStack`. The list is virtualised
  (`LazyVStack` is correct), but the network fetch is not paginated.
  A power user with 500 likes pays the full deserialisation on
  every Likes-tab visit.
- Measurement basis: static analysis.
- Recommendation: add cursor pagination on the server (already
  supported by Prisma) and a "Load more" sentinel `onAppear` in
  the `LazyVStack`. Out of scope for V1 if the average user has
  < 50 incoming likes; revisit when product analytics indicate
  otherwise.
- Risk: low.

### PERF-I17 — `MatchOverlayView.onAppear` uses `DispatchQueue.main.asyncAfter` instead of `Task`

- Severity / expected gain: **informational**.
- Location: `ios/OpenMatch/Features/Swipe/MatchOverlayView.swift:95-105`.
- Description: cosmetic; no real cost. Listed for tidy-up.
- Recommendation: replace with
  `Task { @MainActor in try? await Task.sleep(for: .milliseconds(100));
  titleAppeared = true }`.
- Risk: none.

### PERF-I18 — `UIImage(data:)` is used to materialise picked photos on the main thread

- Severity / expected gain: **medium** (one-shot per photo
  upload, but the picked photo can be ~12 MB raw — decode is
  visible to the user).
- Location: `ios/OpenMatch/Features/Profile/ProfileHomeView.swift:276-285`,
  `ios/OpenMatch/Features/Onboarding/OnboardingFlowView.swift:125-134`.
- Description: `pickedItem.loadTransferable(type: Data.self)` is
  awaited on the MainActor (the view's `.onChange` closure runs
  there), and the immediately following `UIImage(data: data)`
  decodes the JPEG on the main thread. For a typical iPhone photo
  this is 30-80 ms.
- Measurement basis: static analysis.
- Recommendation: move the `UIImage(data:)` and the subsequent
  `ImageUploader.compressForUpload` call into a detached task
  (`await Task.detached(priority: .userInitiated) { ... }.value`),
  then hop back to MainActor to call `vm.upload(image)`.
  `ImageUploader.compressForUpload` itself uses
  `UIGraphicsImageRenderer` which is safe off-main as long as the
  caller doesn't touch UIView.
- Risk: low; UIImage decoded off-main is well-supported.

### PERF-I19 — `PinningSessionDelegate` runs on `URLSession`'s default `delegateQueue: nil` (a synthetic serial queue)

- Severity / expected gain: **informational**.
- Location: `ios/OpenMatch/Networking/APIClient.swift:362`,
  `ios/OpenMatch/Networking/CertPinning.swift:135-152`.
- Description: passing `delegateQueue: nil` to URLSession means the
  delegate callbacks dispatch onto a system-provided serial queue.
  This is correct; the pinning evaluation never touches MainActor.
  No action.
- Recommendation: none.
- Risk: none.

### PERF-I20 — `RealtimeService` decode path round-trips `[String: Any]` → `JSONSerialization` → `Data` → `JSONDecoder`

- Severity / expected gain: **small** (per inbound realtime
  message; 1-2 ms each on iPhone 12-class hardware).
- Location: `ios/OpenMatch/Networking/RealtimeService.swift:81-93`.
- Description: Ably returns `[String: Any]`; the code re-serializes
  to `Data` and then `JSONDecoder.decode`. The decoder is `static
  let` (good — no per-call allocation), but the round-trip
  serialise-then-decode allocates the intermediate `Data`. For
  typical message volume (a few per second peak), this is
  negligible. Documented for context.
- Recommendation: if message volume grows beyond ~10/s, build the
  `MessageDTO` directly from `[String: Any]` without round-tripping.
  Not worth doing today.
- Risk: none.

### PERF-I21 — `SwipeDeckView.task` runs `vm.cards.removeAll(keepingCapacity: true)` on every appearance

- Severity / expected gain: **small** (wipes cached cards every
  time the swipe tab is reselected; user pays the network round-trip
  on tab-switch back).
- Location: `ios/OpenMatch/Features/Swipe/SwipeDeckView.swift:60-65`.
- Description: switching to the Likes tab and back forces a fresh
  `loadDeck` because `.task` clears the array. This is a deliberate
  product choice (always fresh deck), but it amplifies PERF-I4 (no
  image cache → re-download of the same photos).
- Recommendation: optional — guard the wipe on a freshness window
  (`if vm.cards.isEmpty || Date().timeIntervalSince(vm.lastLoaded) > 60`).
  Defer until product confirms.
- Risk: none.

### PERF-I22 — `HandednessStore.refreshFromServer` runs on every `AppState.init` and `didSignIn`

- Severity / expected gain: **informational**.
- Location: `ios/OpenMatch/State/AppState.swift:33-36,71-74`,
  `ios/OpenMatch/State/HandednessStore.swift:49-65`.
- Description: a `Task { await store.refreshFromServer() }` is
  fired on launch (line 35) and again on `didSignIn`. The server
  call (`preferences()`) is small but is on top of the deck-load
  call that the SwipeDeckView's `.task` also fires immediately.
  Two near-simultaneous requests at launch.
- Recommendation: none (low cost, justified by the documented
  "server wins" semantics).
- Risk: none.

---

## Out of scope but flagged

- Retain cycles: APIClient uses `[weak self]` in `refreshIfNeeded`
  (`APIClient.swift:930`); `MessageQueue` callbacks use `[weak self]`
  (`ConversationView.swift:77,84`); `Analytics.flushTask` uses
  `[weak self]`. `AppState`'s `AppDelegate.shared.onDeviceToken =
  { [weak self] ... }` (line 44) is correct. No retain cycles
  observed in the audited files.
- Memory: largest in-memory collections are `vm.cards` (cap ~20),
  `vm.messages` (per-conversation, unbounded — see PERF-I16
  pagination note), and `MessageQueue.pending` (bounded by retry
  schedule). None of these are concerning at expected V1 volumes.
- Crash bootstrap timing: `Crash.bootstrap()` at
  `OpenMatchApp.swift:15` is fast when the DSN is empty (early-
  return on line 59-60). With a configured DSN, `SentrySDK.start`
  is documented to do a small amount of synchronous work and then
  spawn a worker queue; this is acceptable on the launch path.
  No change recommended.
