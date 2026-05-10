import type {
  AlgorithmConfig,
  Block,
  Candidate,
  EligibilityResult,
  PriorSwipe,
  Viewer,
} from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function notSelf(viewer: Viewer, candidate: Candidate): EligibilityResult {
  return viewer.userId === candidate.profile.userId
    ? { ok: false, reason: "self" }
    : { ok: true };
}

function blockedEither(
  viewer: Viewer,
  candidate: Candidate,
  blocks: Block[],
): EligibilityResult {
  const byViewer = blocks.some(
    (b) =>
      b.blockerId === viewer.userId &&
      b.blockedId === candidate.profile.userId,
  );
  if (byViewer) return { ok: false, reason: "blocked_by_viewer" };
  const byCandidate = blocks.some(
    (b) =>
      b.blockerId === candidate.profile.userId &&
      b.blockedId === viewer.userId,
  );
  if (byCandidate) return { ok: false, reason: "blocked_by_candidate" };
  return { ok: true };
}

function candidateAccountActive(candidate: Candidate): EligibilityResult {
  return candidate.profile.accountStatus === "active"
    ? { ok: true }
    : { ok: false, reason: "candidate_not_active" };
}

function candidateVisible(candidate: Candidate): EligibilityResult {
  return candidate.profile.visibilityStatus === "visible"
    ? { ok: true }
    : { ok: false, reason: "candidate_not_visible" };
}

function moderationOk(
  candidate: Candidate,
  config: AlgorithmConfig,
): EligibilityResult {
  if (!config.constraints.excludeModerationRestrictedUsers) return { ok: true };
  const status = candidate.profile.moderationStatus;
  if (status === "clean" || status === "reviewed_ok") return { ok: true };
  return { ok: false, reason: "moderation_restriction" };
}

function withinDistance(
  viewer: Viewer,
  candidate: Candidate,
): EligibilityResult {
  if (candidate.distanceKm > viewer.preferences.maxDistanceKm) {
    return { ok: false, reason: "out_of_distance_range" };
  }
  return { ok: true };
}

function ageInRange(
  viewer: Viewer,
  candidate: Candidate,
  config: AlgorithmConfig,
): EligibilityResult {
  if (
    candidate.profile.age < config.constraints.minimumAge ||
    viewer.profile.age < config.constraints.minimumAge
  ) {
    return { ok: false, reason: "underage" };
  }
  if (
    candidate.profile.age < viewer.preferences.minAge ||
    candidate.profile.age > viewer.preferences.maxAge
  ) {
    return { ok: false, reason: "out_of_age_range" };
  }
  // Mutual: viewer must also be in candidate's preferred age range.
  const [candMin, candMax] = candidate.profile.candidatePreferredAgeRange;
  if (viewer.profile.age < candMin || viewer.profile.age > candMax) {
    return { ok: false, reason: "out_of_age_range" };
  }
  return { ok: true };
}

function genderMutuallyAcceptable(
  viewer: Viewer,
  candidate: Candidate,
  config: AlgorithmConfig,
): EligibilityResult {
  if (!config.constraints.respectMutualGenderPreferences) return { ok: true };
  const viewerInterested = viewer.preferences.interestedGenders;
  if (
    viewerInterested.length > 0 &&
    !viewerInterested.includes(candidate.profile.gender)
  ) {
    return { ok: false, reason: "incompatible_gender_preference" };
  }
  const candidateInterested = candidate.profile.interestedInGenders;
  if (
    candidateInterested.length > 0 &&
    !candidateInterested.includes(viewer.profile.gender)
  ) {
    return { ok: false, reason: "incompatible_gender_preference" };
  }
  return { ok: true };
}

function goalsCompatibleIfRequired(
  viewer: Viewer,
  candidate: Candidate,
): EligibilityResult {
  if (!viewer.preferences.excludeIncompatibleGoals) return { ok: true };
  const wanted = viewer.preferences.relationshipGoals;
  if (wanted.length === 0) return { ok: true };
  const goal = candidate.profile.relationshipGoal;
  if (goal === null) {
    // Missing data — allowed only if the viewer opted in to include
    // unanswered optional fields.
    return viewer.preferences.includeUnansweredOptionalFields
      ? { ok: true }
      : { ok: false, reason: "incompatible_goal_filter" };
  }
  return wanted.includes(goal)
    ? { ok: true }
    : { ok: false, reason: "incompatible_goal_filter" };
}

function notRecentlyActedUpon(
  viewer: Viewer,
  candidate: Candidate,
  priorSwipes: PriorSwipe[],
  now: Date,
  config: AlgorithmConfig,
): EligibilityResult {
  const stickyMs = config.constraints.rejectStickyDays * MS_PER_DAY;
  for (const swipe of priorSwipes) {
    if (swipe.viewerId !== viewer.userId) continue;
    if (swipe.targetUserId !== candidate.profile.userId) continue;
    if (swipe.undoneAt !== null) continue;
    if (swipe.decision === "like") {
      // A standing like means this person should be surfaced via the
      // Likes tab, not redrawn in the deck.
      return { ok: false, reason: "already_acted_recently" };
    }
    if (swipe.decision === "reject") {
      const age = now.getTime() - swipe.createdAt.getTime();
      if (age < stickyMs) {
        return { ok: false, reason: "already_acted_recently" };
      }
    }
  }
  return { ok: true };
}

export interface EligibilityInput {
  viewer: Viewer;
  candidate: Candidate;
  blocks: Block[];
  priorSwipes: PriorSwipe[];
  now: Date;
  config: AlgorithmConfig;
}

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const { viewer, candidate, blocks, priorSwipes, now, config } = input;
  const checks: EligibilityResult[] = [
    notSelf(viewer, candidate),
    blockedEither(viewer, candidate, blocks),
    candidateAccountActive(candidate),
    candidateVisible(candidate),
    moderationOk(candidate, config),
    withinDistance(viewer, candidate),
    ageInRange(viewer, candidate, config),
    genderMutuallyAcceptable(viewer, candidate, config),
    goalsCompatibleIfRequired(viewer, candidate),
    notRecentlyActedUpon(viewer, candidate, priorSwipes, now, config),
  ];
  for (const r of checks) {
    if (!r.ok) return r;
  }
  return { ok: true };
}
