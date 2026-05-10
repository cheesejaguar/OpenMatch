# OpenMatch — Open Source iOS Dating App Design Document

> This document is the canonical product specification. Any code, API, or UI in this repository should be traceable back to a section here. Algorithm changes additionally follow `docs/algorithm/versioning.md`.

## 1. Document Overview

### 1.1 Working Title

OpenMatch is a placeholder product name for an open-source, swipe-based dating app for iOS. The name is not final, but it captures the core premise: transparent matching, no paid scarcity mechanics, and auditable software.

### 1.2 Product Premise

Most mainstream dating apps monetize scarcity. Features such as seeing who liked you, undoing a mistaken swipe, setting detailed filters, sending higher-priority likes, or getting basic transparency into ranking are often gated behind subscriptions, boosts, or consumable purchases.

This app takes the opposite position:

The app is open source. The matching algorithm is auditable. The core dating experience is free. There are no paid boosts, no super likes, no paywalled visibility, and no monetized manipulation of attention.

The core interaction is familiar and simple:

- Swipe left to reject.
- Swipe right to like.
- Undo recent decisions for free.
- Tap the left or right side of a profile photo to cycle through that person's gallery.
- Use bottom navigation to move between Swipe, Likes, Chat, and Profile.
- Choose whether incoming likes are always visible or hidden.

The app should feel modern, polished, and safe, while making the matching system unusually transparent compared with the rest of the dating-app market.

### 1.3 Intended Audience

Adults who want a dating app that is free from artificial paywalls, clear about how recommendations are ranked, respectful of privacy and safety, comfortable for people who dislike manipulative engagement mechanics, inclusive across gender identities and orientations, and trustworthy enough that technically inclined users can inspect the code and algorithm.

### 1.4 Scope

Product goals and non-goals; UX and interaction design; profile and preference design; swipe deck behavior; likes/chat/profile areas; matching algorithm principles and pseudocode; iOS technical architecture; backend system architecture; data model; privacy, safety, moderation, and abuse prevention; open-source governance; MVP scope and phased roadmap; testing strategy; operational considerations.

## 2. Product Vision

### 2.1 Vision Statement

Build a dating app where the user can trust the product because the product does not need to deceive them to make money.

### 2.2 Core Philosophy

1. **No paid advantage** — users cannot buy visibility, ranking priority, super likes, read receipts, unlimited basic access, or access to people who already liked them.
2. **Transparent matching** — the algorithm is open, documented, versioned, and testable against synthetic datasets. Users can see plain-language explanations.
3. **User agency** — clear controls over who they see, who can see them, what they disclose, and whether likes are visible.
4. **Safety without opacity** — anti-abuse systems may include private enforcement signals, but the general rules and policy framework are public.
5. **Calm design** — no casino mechanics, countdowns, manipulative scarcity, or artificial urgency.

### 2.3 Positioning

Not "free Tinder." A dating app with a different social contract:

- Open-source iOS client, open-source backend and matching service where practical, public matching algorithm.
- Free incoming-like visibility (user's choice). Free undo. Free detailed filters.
- No super like, no paid boosts, no subscription tier, no ad tracking, no hidden attractiveness score, no paywall between mutual interest and conversation.

## 3. Goals and Non-Goals

### 3.1 Goals

- **G1** Provide a familiar, high-quality swipe experience.
- **G2** Make high-value features free (undo, incoming likes, detailed filters, browsing matches, chat, algorithm explanations).
- **G3** Make the matching algorithm auditable (eligibility rules, ranking factors, weights, fairness constraints, change history, synthetic test cases, user-facing explanations).
- **G4** Preserve user privacy (no unnecessary exact location, birthdate, contact, or internal safety signals).
- **G5** Create a safer dating environment (report, block, unmatch, photo moderation, profile moderation, message reporting, anti-spam, verification, ban and appeal workflows).
- **G6** Support inclusive profile and preference design.

### 3.2 Non-Goals

- **NG1** No paid monetization through dating mechanics.
- **NG2** Not a social network. No Instagram/TikTok feed.
- **NG3** No public follower graph or popularity metrics.
- **NG4** No black-box ML ranking for MVP. (May be revisited only if interpretable, documented, user-respecting, and auditable.)
- **NG5** Not a promise to eliminate all abuse — minimize harm with thoughtful defaults and responsive enforcement.

## 4. User Roles

### 4.1 Guest

Installed the app, no account. Can read about the product, source code, and safety; can start signup. Cannot browse, like, chat.

### 4.2 Registered User

Active profile. Full app access: profile, photos, preferences, swipe, like/reject, undo, view likes (if enabled), match, chat, report/block/unmatch, export/delete data.

### 4.3 Hidden Profile User

Paused discovery or hidden profile. Existing chats continue; can edit profile, settings, export/delete data. Does not appear in others' decks and receives no new likes from discovery. MVP rule: if discovery is paused, both inbound and outbound discovery pause.

### 4.4 Moderator

Reviews reports, profiles, and queues. Can remove photos or profile text, suspend, ban, resolve appeals. Cannot access private user data without an auditable moderation reason; cannot change ranking for individuals; cannot sell or grant ranking advantages.

### 4.5 Open-Source Contributor

Inspects code, runs synthetic tests, submits issues/PRs. No access to production user data, no production algorithm-weight changes without governance approval, no access to secrets, infra credentials, or private moderation queues.

## 5. Core User Journeys

### 5.1 Onboarding

Install → value prop (open source, free, auditable, no paid boosts) → age requirement and community guidelines → signup (phone, email, Apple) → profile basics → "Looking for" preferences → privacy settings → Swipe tab.

### 5.2 Swiping

Open Swipe → card appears → drag left/right or tap reject/like; tap undo; tap left/right photo for gallery; scroll for details. Reciprocal like creates a match with a confirmation that offers message or keep swiping.

### 5.3 Undo

Swipe → tap undo → most recent card restored, action reverted if allowed → free, no paid limit. Integrity exceptions: undo may be limited after a block or moderation action.

### 5.4 Incoming Likes

Open Likes. Visible: see profiles, like back or reject, full profile access, report/block. Hidden: privacy-respecting state, toggle anytime; never paywalled.

### 5.5 Match and Chat

A likes B; B likes A → match → Chat tab → either can send first message → either can unmatch, report, or block.

### 5.6 Edit Profile

Profile tab → photos, bio, gender, height, education, job, location, lifestyle, goals, visibility, looking-for. Some changes trigger moderation review.

### 5.7 Report/Block

Concerning profile or message → report or block → reason + optional details → block immediate; report enters moderation queue; reported user not shown again to reporter.

## 6. Information Architecture

### 6.1 Bottom Navigation

Four tabs, left to right: **Swipe**, **Likes**, **Chat**, **Profile**. Visible on main authenticated screens; modal flows may temporarily hide.

### 6.2 Tab Responsibilities

- **Swipe** — discovery cards, reject/like/undo, photo navigation.
- **Likes** — visible or hidden incoming likes.
- **Chat** — matches and conversations.
- **Profile** — self, preferences, settings, privacy, safety, transparency.

### 6.3 Secondary areas (under Profile)

Settings, Looking-for, Privacy, Safety center, Blocked users, Reports/appeals, Open-source info, Algorithm transparency, Data export, Account deletion.

## 7. Visual & Interaction Design

### 7.1 Tone

Modern, calm, trustworthy, human, lightweight, **not gamified**. No casino bursts, no manipulative urgency.

### 7.2 Design language

Native iOS, SwiftUI-first, large profile photography, soft rounded cards, clear bottom nav, high-contrast actions, accessible labels, subtle haptics, smooth card physics, minimal clutter on the primary swipe screen.

### 7.3 Color semantics

Like / Reject / Undo / Safety / Verified each have a semantic color. Do not rely on color alone — icons + labels everywhere.

### 7.4 Motion

Card follows finger; slight rotation; like/reject indicator fades in with drag; threshold exit with velocity; next card scales in; undo reverses where possible. Respect Reduce Motion.

### 7.5 Haptics

Light on threshold cross; success on match; warning on invalid undo; selection on photo cycle. User-configurable / follows system.

## 8. Swipe Tab

### 8.1 Layout

Top safe area, optional compact header, card stack with visible primary card, in-card bottom action row, app bottom-nav row.

### 8.2 Profile card

Photo gallery, photo progress indicator, photo tap zones, gradient overlay, profile summary, action buttons, expandable details. Minimum visible: display name, age, approximate location, primary photo, short bio/prompt, action buttons.

### 8.3 Action row

Left → right: **Undo**, **Reject**, **Like**. **No super-like.**

### 8.4 Swipe gesture

Horizontal drag → card tracks finger; rotation proportional to translation; ignore vertical unless details are expanded and scrollable.

Thresholds (starting values): distance ≥ 35% of card width or velocity ≥ decisive flick.

Commit: animate off-screen, optimistic local action, async backend update, advance card. Cancel: spring back, fade cues, no action recorded.

### 8.5 Photo tap zones

Left 25% → previous photo (no-op on first). Right 25% → next photo (no-op on last). Center reserved for profile expansion. Buttons take priority over tap zones.

### 8.6 Photo progress indicator

Segmented at top, current photo highlighted, visible over varied backgrounds.

### 8.7 Profile detail expansion

Tap center, tap summary, drag up, or "View profile". Sheet shows full bio, photos, height, education, work, goals, lifestyle, prompts, safety actions, **"Why am I seeing this profile?"**. MVP: bottom sheet over the card.

### 8.8 Empty deck

Friendly, never pressure to pay. Suggest broadening filters or checking back later.

> "No profiles match your current preferences right now. You can broaden your filters or check back later."

### 8.9 Match confirmation

Both photos, two actions: **Send message** / **Keep swiping**. Pleasant but not excessive.

## 9. Likes Tab

### 9.1 Purpose

View incoming likes. Free. Visibility is a user choice, not a paywall.

### 9.2 Visibility setting

- **Visible** — full profiles in tab.
- **Count only** — count shown, profiles hidden.
- **Hidden** — nothing shown.

Default: **Visible** (with onboarding confirmation).

### 9.3–9.6

Visible state: count, grid/list, full profile access, like-back/reject/report/block. Hidden state: explanation and toggle. Card interactions identical to Swipe; rejecting an incoming like never notifies the other user. MVP sorting: most recent first.

## 10. Chat Tab

Mutual matches only. List shows new matches without messages, active conversations, latest preview, timestamp, unread count.

Conversation: text + emoji, timestamps, delivery status, optional read status, report/unmatch/block. MVP: **text-only**. Media added later after safety workflows mature.

Unmatch closes conversation and prevents immediate rediscovery; block is separate and stronger. Prior messages retained for the report retention window.

## 11. Profile Tab

Home: photo, display name, age, profile-completion indicator, edit, looking-for, visibility, settings, safety, open-source/transparency links.

Edit grouped: Basics, Photos, Bio/prompts, Identity, Location, Work/Edu, Lifestyle, Goals, Privacy/visibility.

Preview shows the profile as others see it. Settings cover account, notifications, privacy, discovery visibility, likes visibility, safety, data export, delete account, open-source licenses, algorithm transparency, community guidelines.

## 12. Profile Data

### 12.1 Philosophy

Expressive but not invasive. Every optional field truly optional. Separate: account data, public data, matching data, safety data, never-shown data.

### 12.2 Required fields

Display name, date of birth (private — only age shown), gender, interested-in / orientation field, location, ≥1 photo, basic relationship intent.

### 12.3 Standard public fields

Display name, age, gender, pronouns, bio, location/distance, height, college, education level, job title, employer (optional), hometown, languages, relationship goals, dating intentions, children status, family plans, pets, drinking, smoking, cannabis, exercise, diet, religion, politics, ethnicity (legally/ethically gated, optional), zodiac (optional), prompts, interests, verification status. Sensitive fields are region-configurable.

### 12.4 Photos

Min 1 (MVP minimum 2). Max 6–9. First is primary; reorderable, croppable, deletable. Automated moderation + human queue for flags.

### 12.5 Bio

Plain text, length-limited (500 chars MVP), no external links by default, moderated.

### 12.6 Prompts

20–40 prompts; user picks up to 3.

### 12.7 Location

Approximate only. Device location or manual city. Distance display avoids precision suggesting stalking-grade accuracy. Backend stores PostGIS-precision internally; surface as bucketed text only.

### 12.8 Gender & identity

Inclusive list: Woman, Man, Non-binary, Trans woman, Trans man, Genderqueer, Agender, Questioning, Self-describe, Prefer not to say. Separate gender identity, pronouns, who-you-want-to-see, who-can-see-you.

### 12.9 Age

18+ only. DOB required, age computed server-side, exact birthdate private.

### 12.10–12.13

Height in ft/in or cm; Education with optional grad year and field; Work with optional company/industry (company optional to reduce stalking risk); Lifestyle fields all optional and region-configurable.

## 13. "Looking For" Preferences and Filters

### 13.1 Purpose

Define who the user wants to see and, where applicable, who should see them.

### 13.2 Philosophy

Powerful filters for free. Distinguish hard filters, soft preferences, visibility constraints, and missing-data behavior.

### 13.3 Required

Age range, distance range, gender preferences, relationship goal.

### 13.4 Distance

1 / 5 / 10 / 25 / 50 / 100 miles / Anywhere.

### 13.5 Age range

Min/Max, 18+, local-law-respecting, sensible defaults from onboarding.

### 13.6 Gender preferences

Mutual preference compatibility — users appear only where mutual preference is satisfied.

### 13.7 Relationship goals

Long-term, life partner, short-term, casual, friendship, figuring it out, marriage-minded, non-monogamy, open. Filter as: only / prefer / hide incompatible.

### 13.8 Profile field filters

Height, education, college, location/city, languages, religion, politics, drinking/smoking/cannabis, exercise, diet, children, family plans, pets, interests, verification, profile completeness — each marked hard / soft / advanced / regionally-disabled.

### 13.9 Sensitive filters

Three policy modes per sensitive field: display-only-no-filtering, opt-in filtering, disabled. Final configuration via legal + T&S review.

### 13.10 Missing data

MVP: hard filters apply only to users with known matching values. User chooses whether unanswered profiles are included.

### 13.11–13.12

Filter UI grouped: Basics, Distance, Gender, Goals, Lifestyle, Education/Work, Identity/Values, Advanced. Each row shows name, current value, hard/soft, reset. Transparency: tell users when filters reduce the pool; never pressure them to lower standards.

## 14. Matching and Discovery Algorithm

### 14.1 Goals

Open source, auditable, deterministic enough to test, personalized enough to be useful, simple enough to explain, fair enough to avoid extreme visibility concentration, abuse-resistant, not monetized.

### 14.2 Non-goals

No hidden attractiveness score, no suppression for paid conversion, no priority for paying users, no engagement dark patterns, not optimizing for session length, not hiding likes to drive subscription.

### 14.3 Candidate generation

Active, visible, moderation-clean, not blocked (either direction), not already acted on, satisfies viewer's hard filters and candidate's visibility, satisfies age/legal, within distance.

### 14.4 Ranking inputs

Distance, recent activity, preference compatibility, relationship-goal compatibility, shared interests, profile completeness, fairness rotation, randomization seed, safety/integrity eligibility.

**Never:** paid status, revenue likelihood, hidden beauty score, device value, income inference, psychological vulnerability inference, manipulative engagement prediction.

### 14.5 Formula (MVP)

```
score =
  0.25 * distance_score +
  0.20 * activity_score +
  0.20 * preference_overlap_score +
  0.15 * relationship_goal_score +
  0.10 * profile_completeness_score +
  0.05 * fairness_rotation_score +
  0.05 * randomization_score
```

If a candidate has already liked the viewer, MVP shows them in **Likes** tab only — no secret boost in Swipe.

### 14.6 Components

- **distance_score** = `max(0.25, 1 - distance / max_distance)`; ineligible if `distance > max_distance`.
- **activity_score** = `1.0 / 0.8 / 0.5 / 0.2` for active within 24h / 7d / 30d / older.
- **preference_overlap_score** = `matched_soft / total_soft`; neutral 0.5 when none.
- **relationship_goal_score** = `1.0` same / `0.7` compatible / `0.5` unclear/open / ineligible-or-0 incompatible (user-controlled).
- **profile_completeness_score** = `completed_public / recommended_public`; capped so it doesn't dominate.
- **fairness_rotation_score** = boost users with fewer recent impressions; never a hidden desirability rank.
- **randomization_score** = deterministic-random via `(viewer_id, candidate_id, algorithm_version, day_seed)`.

### 14.7 Pseudocode

```
function getDiscoveryDeck(viewer, limit):
    preferences = loadPreferences(viewer.id)
    candidates = loadActiveVisibleProfilesNear(viewer.location, preferences.maxDistance)
    eligible = []
    for candidate in candidates:
        if candidate.id == viewer.id: continue
        if isBlocked(viewer.id, candidate.id) or isBlocked(candidate.id, viewer.id): continue
        if hasOpenModerationRestriction(candidate.id): continue
        if alreadyActed(viewer.id, candidate.id): continue
        if not passesHardFilters(viewer, candidate, preferences): continue
        if not passesCandidateVisibility(candidate, viewer): continue
        if not satisfiesLegalAndAgeRules(viewer, candidate): continue
        eligible.append((candidate, scoreCandidate(viewer, candidate, preferences)))
    ranked = sortByScoreDescending(eligible)
    return applyFairnessAndDiversityRules(ranked).take(limit)
```

### 14.8 Explainability

Each shown profile has an optional explanation: distance, gender preference match, relationship goal alignment, shared interests, recent activity. Never expose raw score; never leak private fields.

### 14.9 Versioning

Every deck response includes `algorithmVersion`, `rankingConfigVersion`, timestamp, feature flags used.

### 14.10 Repository

```
/matching
  README.md
  algorithm_config.json
  src/
  fixtures/
  test/
  CHANGELOG.md
```

### 14.11 Auditing without exposing user data

Synthetic datasets, aggregated metrics, reproducible local simulations, public test cases. Private data stays private.

### 14.12 Governance

PR + human-readable rationale + before/after on synthetic tests + safety review + product review + public changelog + version bump. Emergency abuse fixes may land first and be documented after.

## 15. Free Features and Monetization Policy

### 15.1 No paid features

No paid likes, boosts, super likes, undo, visibility, read receipts, advanced filters, priority, messaging gate, or profile-detail unlocks.

### 15.2 No super like.

### 15.3 Possible funding

Donations, grants, nonprofit, supporter badge without ranking effect, paid self-hosted enterprise/community support, public-benefit company. Rule: nobody can buy better romantic visibility.

### 15.4 Anti-spam ≠ paid limits

Allowed: velocity limits, messaging limits for suspicious accounts, cooldowns, verification prompts. **Never** "out of likes, pay to continue."

## 16. Privacy

### 16.1 Principles

Minimize collection; separate public/private; avoid exact location; no data sales; no ad tracking; provide export and deletion; understandable data use; do not use private data for manipulative ranking.

### 16.2 Public vs private

Public: display name, age, public gender, photos, bio, public fields, approximate distance, verification badge. Private: exact DOB, email, phone, exact coordinates, device IDs, moderation history, internal safety scores, auth IDs, block/report detail.

### 16.3 Location

Never exact. Avoid tiny distances. Manual city allowed. Pause possible. Storage with precision limits. Consider fuzzing / grid matching.

### 16.4–16.5

Export profile/photos-meta/preferences/matches; messages and likes per policy. Delete: immediate discovery removal, anonymize/delete, retain only minimum needed for legal and fraud per policy.

### 16.6 Analytics privacy

No third-party ad SDKs, no cross-app, first-party only, aggregate metrics, no message content in analytics, no exact location.

### 16.7 Privacy settings

Discovery visibility, incoming-likes visibility, approximate location display, notification previews, read receipts toggle, online status toggle, profile-field visibility.

## 17. Safety, Moderation, Abuse Prevention

### 17.1 Baseline

Report profile/message, block, unmatch, photo moderation, profile text moderation, spam detection, suspension, appeals, community guidelines.

### 17.2 Report reasons

Harassment, hate, threats/violence, sexual content/nudity, scam/spam, fake profile, underage, impersonation, offensive profile, off-platform solicitation, other. Optional free text.

### 17.3 Block

Immediate two-way invisibility, remove matches, stop messages, prevent rediscovery, no notification to blocked user.

### 17.4 Unmatch

Close conversation, stop messages, no automatic report, optional report flow.

### 17.5 Photo moderation

Nudity, violence, hate symbols, spam/ads, impersonation cues, minors per policy, non-human per profile rules. Automated + human queue.

### 17.6 Text moderation

Harassment, hate, threats, spam, scams, contact-info spam, illegal solicitation. Balance privacy and safety; review reported messages under policy.

### 17.7 Verification

Email/phone required (MVP); optional selfie verification with badge.

### 17.8 Anti-spam

Rate limit likes and messages, detect repeated identical messages and external link spam, suspicious-account heuristics, device/IP risk, friction not paywall.

### 17.9 Safety Center

How to report, blocking, dating safety tips, privacy tips, guidelines, crisis resources, open-source safety policy.

### 17.10 Moderation transparency

Public guidelines, enforcement categories, appeal process, aggregate transparency reports.

## 18. iOS Technical Architecture

### 18.1 Platform

iOS native, Swift, SwiftUI-first, iOS 17+ MVP.

### 18.2 Pattern

MVVM + Services for MVP. Reducer architecture is fine if the team prefers it.

### 18.3 Modules

`OpenMatchApp`, `AuthModule`, `ProfileModule`, `DiscoveryModule`, `SwipeDeckModule`, `LikesModule`, `ChatModule`, `SettingsModule`, `SafetyModule`, `MediaModule`, `NetworkingModule`, `PersistenceModule`, `DesignSystem`, `MatchingTransparencyModule`.

### 18.4 Key components

`SwipeDeckView`, `ProfileCardView`, `PhotoCarouselView`, `LikesView`, `ChatListView`, `ConversationView`, `ProfileHomeView`.

### 18.5 Swipe deck state

```
struct SwipeDeckState {
    var cards: [ProfileCardModel]
    var activeIndex: Int
    var undoStack: [SwipeAction]
    var isLoading: Bool
    var pendingActions: [PendingSwipeAction]
    var error: SwipeDeckError?
}
```

### 18.6 Swipe action

```
enum SwipeDecision: String, Codable { case like, reject }
struct SwipeAction: Codable, Identifiable {
    let id: UUID
    let viewerId: UserID
    let targetProfileId: ProfileID
    let decision: SwipeDecision
    let createdAt: Date
    let algorithmVersion: String
    let deckSessionId: UUID
}
```

### 18.7 Optimistic swiping

Animate immediately, queue locally, send async, retry recoverable failures, reconcile permanent ones with a non-intrusive error.

### 18.8 Undo

Cancel pending or send undo request; restore card; record undo for audit.

### 18.9 Persistence

SwiftData or SQLite for cache and queues. Keychain for tokens.

### 18.10 Networking

URLSession + async/await + Codable + typed client + token refresh + retry + correlation IDs.

### 18.11 Images

Progressive load, memory + disk cache, preload next, cancel on dismiss, signed URLs, placeholders, optional blurhash.

### 18.12 Push

Matches, messages, likes (opt-in), safety updates. Settings per category. Previews respect privacy.

### 18.13 Accessibility

Buttons always available; VoiceOver labels for everything; Dynamic Type; contrast; Reduce Motion; large tap targets; clear focus order; button alternatives for photo navigation.

## 19. Backend Architecture

Auth, Profile, Media, Discovery, Swipe, Match, Likes, Chat, Notification, Moderation, Transparency. MVP: modular monolith; split later.

Stack: API server, PostgreSQL with PostGIS, Redis, object storage, CDN, WebSocket service, APNs, background worker, moderation queue.

Open-source backend OK; secrets and prod config remain private. REST + WebSocket + OpenAPI for MVP; `/api/v1/...`.

## 20. Data Model

See Prisma schema for the source of truth. Entities: `User`, `Profile`, `ProfilePhoto`, `Preferences`, `SwipeAction`, `Like`, `Match`, `Conversation`, `Message`, `Block`, `Report`, `AlgorithmAuditRecord`.

## 21. API Design

See `docs/api/openapi.yaml` (generated from backend route schemas). Endpoint groups: auth, profile, preferences, discovery, swipes, likes, matches, chat (REST + `/ws/v1/chat`), safety, transparency.

## 22. Open-Source Strategy

### 22.1 Open source

iOS client, matching algorithm, backend code, API schemas, migrations, local dev env, docs, synthetic fixtures, transparency reports.

### 22.2 Not public

Production user data, secrets, private keys, moderation staff tools with live access credentials, internal abuse signatures that would aid evasion, security-sensitive operational details.

### 22.3 License

Apache 2.0 for the whole repo (per project choice).

### 22.4 Repo structure

See top-level `README.md`.

### 22.5 Governance

Maintainers, review requirements, security reporting path, code of conduct, product decision process, algorithm change process, community moderation process.

### 22.6 Algorithm change policy

Summary, motivation, user impact, test results, fairness analysis, abuse considerations, rollout plan, changelog entry.

### 22.7 Public roadmap

Features, safety, algorithm, known limits, "help wanted".

## 23. Security

Protect identity, location, messages, media, tokens; least-privilege internal access; logging; abuse-ready.

Auth: Keychain, short access tokens, refresh rotation, session management, logout-all, suspicious-login detection. HTTPS-only. Signed media URLs with expiration. Chat: encrypted in transit and at rest for MVP; future E2E with selective-disclosure reporting.

Threats: harassment, stalking, location inference, catfishing, scraping, bots, credential theft, insider misuse, algorithm gaming, breach. Mitigations: approximate location, rate limits, moderation, verification, block/report, bot detection, secure auth, audit logs, open security policy.

## 24. Performance and Reliability

Swipe drag 60+ FPS, button under 100 ms perceived, deck < 2s, chat send optimistic. Backend p95: deck 500 ms, swipe 250 ms, message 300 ms, likes 500 ms. Cache candidates/summaries/media URLs/preferences/transparency. Never stale: blocks, reports, bans, unmatches, privacy. Graceful offline; never indefinite without reconciliation. Block/report flows prioritized over engagement features.

## 25. Observability

Aggregate product, safety, and algorithm metrics. No message content, no exact location, no sensitive-field tracking unless aggregated and policy-approved.

## 26. Testing

iOS: unit (deck transitions, undo, carousel, validation, decoding, persistence), UI (signup, swipes, undo, tap zones, likes states, chat, report/block), snapshot (cards, empty deck, match modal, likes states, chat list, edit, dark mode, Dynamic Type). Backend: candidate eligibility, filters, ranking, swipe, match, undo, blocks, reports, chat permissions, moderation. Algorithm: public, reproducible, synthetic — distance/age/gender/goals/missing fields/fairness/randomization/versioning. Abuse: mass like/message, fakes, scraping, location inference, block evasion, report abuse, harassment patterns. Accessibility: VoiceOver, Dynamic Type, Reduce Motion, contrast, button-only, one-handed.

## 27. MVP Scope

### 27.1 Include

Account creation, age gate, profile, photo upload, profile moderation basics, looking-for preferences, swipe deck, dragging animation, undo, reject, like, photo tap zones, Likes tab with visibility setting, mutual matches, text chat, profile editing, block, report, open-source algorithm docs, transparent ranking, data deletion.

### 27.2 Exclude

Super likes, paid subscriptions, paid boosts, media messaging, video profiles, events, social feed, complex ML, E2E chat (unless capacity), web, Android.

### 27.3 Success

Reliable creation/swipe/match/chat; visible incoming likes free when enabled; reliable undo; documented testable algorithm; safety flows work; polished enough for early beta.

## 28. Post-MVP Roadmap

Phase 2 trust/quality; Phase 3 privacy/security (E2E chat, fuzzing, reproducible builds); Phase 4 community/governance; Phase 5 platform expansion (Android, web, self-hosting, federation exploration).

## 29. Key Decisions

- **Default likes visibility:** visible, with onboarding choice.
- **Unlimited likes:** free but rate-limited for abuse; never paywalled.
- **Incoming likes in swipe ranking:** MVP keeps them in Likes only; if ever changed, both UI and docs must say so.
- **Show raw scores:** no — plain-language explanations only.
- **All fields filterable:** general fields yes; sensitive fields policy-gated.

## 30. Risks and Mitigations

- **Algorithm gaming** — bounded scores, fairness rotation, abuse detection, deterministic randomization, publish principles not abuse signatures.
- **No paid features → sustainability** — donations, grants, supporter (no advantage), efficient infra, PBC.
- **Moderation burden** — invest early, rate limits, verification, automation, strong block.
- **Privacy incidents** — minimization, encryption, access control, security reviews, responsible disclosure, location privacy.
- **Cold start** — city-by-city, transparency-aligned communities, OSS-community growth, no spam referrals.
- **Forks** — trademark policy, official identity, governance, license, safety docs.

## 31. App Store / Policy

18+; UGC implications (report/block/moderation/TOS/guidelines/removal); accurate Privacy Nutrition Label; OSS-compatible distribution and CLA strategy.

## 32. Example Screens

Welcome, Signup, Profile basics, Photos, Bio/prompts, Looking for, Likes visibility, Swipe, Likes (visible/hidden), Chat, Profile.

## 33. Example SwiftUI Sketch (illustrative)

```swift
struct SwipeCardView: View {
    let profile: ProfileCardModel
    let onLike: () -> Void
    let onReject: () -> Void
    let onUndo: () -> Void
    @State private var offset: CGSize = .zero
    var body: some View {
        ZStack(alignment: .bottom) {
            PhotoCarouselView(photos: profile.photos)
            LinearGradientOverlay()
            VStack {
                Spacer()
                ProfileSummaryView(profile: profile)
                ActionRow(onUndo: onUndo, onReject: commitReject, onLike: commitLike)
            }
            .padding()
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .offset(offset)
        .rotationEffect(.degrees(Double(offset.width / 20)))
        .gesture(DragGesture()
            .onChanged { value in offset = value.translation }
            .onEnded { handleDragEnd($0) })
        .animation(.spring(response: 0.32, dampingFraction: 0.82), value: offset)
    }
    private func handleDragEnd(_ value: DragGesture.Value) {
        let t: CGFloat = 140
        if value.translation.width > t { commitLike() }
        else if value.translation.width < -t { commitReject() }
        else { offset = .zero }
    }
    private func commitLike() { offset = CGSize(width: 1000, height: 0); onLike() }
    private func commitReject() { offset = CGSize(width: -1000, height: 0); onReject() }
}
```

Production code must split animation, side effects, accessibility, haptics, pending actions, and reconciliation.

## 34. Example Matching Config

```json
{
  "algorithmVersion": "discovery-v1.0.0",
  "weights": {
    "distance": 0.25,
    "activity": 0.20,
    "preferenceOverlap": 0.20,
    "relationshipGoal": 0.15,
    "profileCompleteness": 0.10,
    "fairnessRotation": 0.05,
    "randomization": 0.05
  },
  "constraints": {
    "minimumAge": 18,
    "excludeBlockedUsers": true,
    "excludeModerationRestrictedUsers": true,
    "respectMutualGenderPreferences": true,
    "respectHardFilters": true
  },
  "randomization": {
    "method": "deterministic_daily_seed",
    "seedInputs": ["viewer_id", "candidate_id", "algorithm_version", "date"]
  }
}
```

## 35. Open Questions

Verification depth; chat encryption timing; regional policy differences; self-hosting; algorithm personalization depth.

## 36. Summary

OpenMatch is a swipe-based iOS dating app built around an unusually clear promise: no paid dating advantage, no super likes, no paywalled incoming likes, and an auditable matching algorithm.

The defining commitment: a user's dating visibility should be determined by their preferences, eligibility, safety, activity, and transparent ranking rules — never by whether they paid.
