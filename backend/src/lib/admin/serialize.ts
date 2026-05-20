import type { Preferences, Profile, ProfilePhoto, User, UserBan } from "@prisma/client";
import { maskEmail } from "./hash.js";
import { PERMISSIONS, type Permission } from "./permissions.js";

export interface PermissionSet {
  has(p: Permission): boolean;
}

export function permsFrom(list: string[]): PermissionSet {
  const set = new Set(list);
  return { has: (p) => set.has(p) };
}

export interface UserSummaryDTO {
  userId: string;
  displayName: string | null;
  age: number | null;
  status: User["status"];
  isBanned: boolean;
  profileStatus: Profile["visibilityStatus"] | null;
  moderationStatus: Profile["moderationStatus"] | null;
  verificationStatus: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  reportCount: number;
  /**
   * SEV-M12 — `true` when the userId / displayName have been replaced
   * with a per-report pseudonym because the calling admin does not
   * hold `report.read.reporter_identity`. The admin UI uses this flag
   * to render a "Reveal reporter" button that POSTs to the explicit
   * reveal endpoint (which audit-logs the unmask).
   */
  redactedIdentity?: boolean;
}

/**
 * SEV-M12 — Build an opaque, per-report pseudonym for a reporter whose
 * identity should not be visible to the calling admin. Deterministic
 * per (reportId, userId) so the same admin sees the same handle across
 * page reloads, but two reports about the same person yield different
 * handles — preventing cross-report correlation by a triager who lacks
 * the identity permission.
 */
export function reporterPseudonym(reportId: string, userId: string): string {
  // Lightweight FNV-style mix; doesn't need to be cryptographically
  // strong because the real user id never leaves the server.
  let h = 0x811c9dc5;
  const input = `${reportId}:${userId}`;
  for (let i = 0; i < input.length; i += 1) {
    h = (h ^ input.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `reporter:${h.toString(16).padStart(8, "0")}`;
}

/**
 * SEV-M12 — Project a reporter into a fully-redacted summary. We keep
 * the *aggregate* signals the triager genuinely needs (account status,
 * verification, prior-report count for context) and zero out anything
 * that could identify the human behind the report.
 */
export function serializeRedactedReporter(
  reportId: string,
  user: User & { profile?: Profile | null; _count?: { reportsAbout: number } },
): UserSummaryDTO {
  return {
    userId: reporterPseudonym(reportId, user.id),
    displayName: null,
    age: null,
    status: user.status,
    isBanned: user.isBanned,
    profileStatus: null,
    moderationStatus: null,
    verificationStatus: user.profile?.verificationStatus ?? null,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: null,
    reportCount: user._count?.reportsAbout ?? 0,
    redactedIdentity: true,
  };
}

export interface UserDetailDTO extends UserSummaryDTO {
  email: string | null;
  emailMasked: string | null;
  dateOfBirth?: string | null;
  profile: ProfileDetailDTO | null;
  bans: BanSummaryDTO[];
  /** Per-user swipe-deck thumb-reach preference (Phase E). Null when the
   * user has no Preferences row yet. */
  handedness: "right" | "left" | "center" | null;
}

export interface ProfileDetailDTO {
  id: string;
  displayName: string;
  bio: string;
  gender: Profile["gender"];
  pronouns: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  heightCm: number | null;
  educationLevel: string | null;
  college: string | null;
  jobTitle: string | null;
  company: string | null;
  relationshipGoal: Profile["relationshipGoal"];
  childrenStatus: string | null;
  familyPlans: string | null;
  drinking: string | null;
  smoking: string | null;
  cannabis: string | null;
  exercise: string | null;
  diet: string | null;
  religion: string | null;
  politics: string | null;
  languages: string[];
  interests: string[];
  verificationStatus: string;
  visibilityStatus: Profile["visibilityStatus"];
  moderationStatus: Profile["moderationStatus"];
  prompts: unknown;
}

export interface BanSummaryDTO {
  id: string;
  banType: UserBan["banType"];
  status: UserBan["status"];
  reasonCode: UserBan["reasonCode"];
  bannedAt: string;
  expiresAt: string | null;
  unbannedAt: string | null;
}

export interface PhotoDTO {
  id: string;
  storageKey: string;
  url: string | null;
  sortOrder: number;
  moderationStatus: ProfilePhoto["moderationStatus"];
  width: number | null;
  height: number | null;
  blurhash: string | null;
  createdAt: string;
}

export function ageFromDob(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

export function serializeUserSummary(
  user: User & { profile?: Profile | null; _count?: { reportsAbout: number } },
  perms: PermissionSet,
): UserSummaryDTO {
  return {
    userId: user.id,
    displayName: perms.has(PERMISSIONS.USER_READ_FULL_PROFILE)
      ? (user.profile?.displayName ?? null)
      : user.profile?.displayName?.slice(0, 1)
        ? `${user.profile.displayName.slice(0, 1)}.`
        : null,
    age: ageFromDob(user.dateOfBirth),
    status: user.status,
    isBanned: user.isBanned,
    profileStatus: user.profile?.visibilityStatus ?? null,
    moderationStatus: user.profile?.moderationStatus ?? null,
    verificationStatus: user.profile?.verificationStatus ?? null,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.profile?.lastActiveAt?.toISOString() ?? null,
    reportCount: user._count?.reportsAbout ?? 0,
  };
}

export function serializeUserDetail(
  user: User & {
    profile: (Profile & { photos?: ProfilePhoto[] }) | null;
    bans?: UserBan[];
    preferences?: Preferences | null;
    _count?: { reportsAbout: number };
  },
  perms: PermissionSet,
): UserDetailDTO {
  const base = serializeUserSummary(user, perms);
  const profileDto: ProfileDetailDTO | null = user.profile
    ? {
        id: user.profile.id,
        displayName: user.profile.displayName,
        bio: user.profile.bio,
        gender: user.profile.gender,
        pronouns: user.profile.pronouns,
        city: user.profile.city,
        region: user.profile.region,
        country: user.profile.country,
        heightCm: user.profile.heightCm,
        educationLevel: user.profile.educationLevel,
        college: user.profile.college,
        jobTitle: user.profile.jobTitle,
        company: user.profile.company,
        relationshipGoal: user.profile.relationshipGoal,
        childrenStatus: user.profile.childrenStatus,
        familyPlans: user.profile.familyPlans,
        drinking: user.profile.drinking,
        smoking: user.profile.smoking,
        cannabis: user.profile.cannabis,
        exercise: user.profile.exercise,
        diet: user.profile.diet,
        religion: user.profile.religion,
        politics: user.profile.politics,
        languages: user.profile.languages,
        interests: user.profile.interests,
        verificationStatus: user.profile.verificationStatus,
        visibilityStatus: user.profile.visibilityStatus,
        moderationStatus: user.profile.moderationStatus,
        prompts: user.profile.prompts,
      }
    : null;
  return {
    ...base,
    email: perms.has(PERMISSIONS.USER_READ_PRIVATE_FIELDS) ? user.emailHash : null,
    emailMasked: maskEmail(user.emailHash),
    dateOfBirth: perms.has(PERMISSIONS.USER_READ_PRIVATE_FIELDS)
      ? user.dateOfBirth.toISOString()
      : null,
    profile: profileDto,
    bans:
      user.bans?.map((b) => ({
        id: b.id,
        banType: b.banType,
        status: b.status,
        reasonCode: b.reasonCode,
        bannedAt: b.bannedAt.toISOString(),
        expiresAt: b.expiresAt?.toISOString() ?? null,
        unbannedAt: b.unbannedAt?.toISOString() ?? null,
      })) ?? [],
    handedness: user.preferences?.handedness ?? null,
  };
}

export function serializePhoto(p: ProfilePhoto, signedUrl: string | null): PhotoDTO {
  return {
    id: p.id,
    storageKey: p.storageKey,
    url: signedUrl,
    sortOrder: p.sortOrder,
    moderationStatus: p.moderationStatus,
    width: p.width,
    height: p.height,
    blurhash: p.blurhash,
    createdAt: p.createdAt.toISOString(),
  };
}
