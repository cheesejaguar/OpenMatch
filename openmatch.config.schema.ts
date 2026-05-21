import { z } from "zod";

// Platform configuration schema.
//
// OpenMatch is a single-tenant codebase but the *product variant* is
// configurable per deployment. This module defines:
//
//   • OpenMatchConfig — the TypeScript interface forkers consume.
//   • openMatchConfigSchema — the Zod schema used to validate the
//     loaded `openmatch.config.ts` at boot.
//   • DEFAULT_DATING_CONFIG — the baseline that reproduces today's
//     dating-app behaviour. The root `openmatch.config.ts` re-exports
//     this so existing deployments keep working unchanged.
//
// Loaders live in backend/src/lib/config.ts and admin/lib/config.ts.
// They share this schema so the same file validates against both
// runtimes.

export type OpenMatchVariant = "dating" | "mentorship" | "roommates" | "sports" | "custom";

export interface OpenMatchFeatures {
  /** Gate the Preferences `interestedGenders` required check. */
  requireGenderPreferences: boolean;
  /** Gate the Preferences `minAge`/`maxAge` required check. */
  requireAgeWindow: boolean;
  /** Require photos at signup. */
  requirePhotos: boolean;
  /** Minimum photo count enforced by signup gating. */
  minPhotos: number;
  /** Hard cap on photos per profile. */
  maxPhotos: number;
  /** Whether to render the celebratory match overlay (vs a plain notification). */
  enableMatchOverlay: boolean;
  /** Render the swipe deck UI. When false, clients may render a grid. */
  enableSwipeDeck: boolean;
  /** Boost / premium-feature surface. Kept off-by-default to honour the no-paid-features stance. */
  enableBoosts: boolean;
  /** ID-document verification surface. */
  enableVerification: boolean;
  /** Voice-note messaging — hook for the Wave 2 communication PR. */
  enableVoiceNotes: boolean;
  /** Video-note messaging — hook for the Wave 2 communication PR. */
  enableVideoNotes: boolean;
}

export interface OpenMatchCopy {
  /** Display name surfaced in iOS chrome, admin banner, and outgoing email. */
  appName: string;
  /** Verb for a confirmed two-way connection. Dating: "matched". Mentorship: "connected". */
  matchVerb: string;
  /** Verb for a unilateral expression of interest. Dating: "like". Roommates: "interested". */
  swipeRightVerb: string;
  /** First prompt the user sees during onboarding. */
  profilePrompt: string;
}

export interface OpenMatchBranding {
  primaryColorLight: string;
  primaryColorDark: string;
  accentColorLight: string;
  accentColorDark: string;
}

export interface OpenMatchConfig {
  variant: OpenMatchVariant;
  features: OpenMatchFeatures;
  copy: OpenMatchCopy;
  branding: OpenMatchBranding;
}

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/, "expected #RRGGBB or #RRGGBBAA hex color");

export const openMatchFeaturesSchema = z.object({
  requireGenderPreferences: z.boolean(),
  requireAgeWindow: z.boolean(),
  requirePhotos: z.boolean(),
  minPhotos: z.number().int().min(0).max(20),
  maxPhotos: z.number().int().min(1).max(20),
  enableMatchOverlay: z.boolean(),
  enableSwipeDeck: z.boolean(),
  enableBoosts: z.boolean(),
  enableVerification: z.boolean(),
  enableVoiceNotes: z.boolean(),
  enableVideoNotes: z.boolean(),
});

export const openMatchCopySchema = z.object({
  appName: z.string().min(1).max(60),
  matchVerb: z.string().min(1).max(40),
  swipeRightVerb: z.string().min(1).max(40),
  profilePrompt: z.string().min(1).max(280),
});

export const openMatchBrandingSchema = z.object({
  primaryColorLight: hexColor,
  primaryColorDark: hexColor,
  accentColorLight: hexColor,
  accentColorDark: hexColor,
});

export const openMatchConfigSchema = z
  .object({
    variant: z.enum(["dating", "mentorship", "roommates", "sports", "custom"]),
    features: openMatchFeaturesSchema,
    copy: openMatchCopySchema,
    branding: openMatchBrandingSchema,
  })
  .superRefine((cfg, ctx) => {
    if (cfg.features.minPhotos > cfg.features.maxPhotos) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["features", "minPhotos"],
        message: "features.minPhotos must not exceed features.maxPhotos",
      });
    }
    if (cfg.features.requirePhotos && cfg.features.minPhotos < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["features", "minPhotos"],
        message: "features.minPhotos must be >= 1 when features.requirePhotos is true",
      });
    }
  });

/**
 * Default configuration. Matches today's behaviour: dating variant with
 * gender / age preferences required, two-photo minimum, swipe deck and
 * celebratory match overlay both on. Verification + boosts + voice/video
 * notes are off by default — they are explicit opt-ins per fork.
 */
export const DEFAULT_DATING_CONFIG: OpenMatchConfig = {
  variant: "dating",
  features: {
    requireGenderPreferences: true,
    requireAgeWindow: true,
    requirePhotos: true,
    minPhotos: 2,
    maxPhotos: 9,
    enableMatchOverlay: true,
    enableSwipeDeck: true,
    enableBoosts: false,
    enableVerification: false,
    enableVoiceNotes: false,
    enableVideoNotes: false,
  },
  copy: {
    appName: "OpenMatch",
    matchVerb: "matched",
    swipeRightVerb: "like",
    profilePrompt: "Tell us the basics. You can change everything later.",
  },
  branding: {
    primaryColorLight: "#C9356E",
    primaryColorDark: "#E45A8E",
    accentColorLight: "#2A1B3D",
    accentColorDark: "#C5A6FF",
  },
};

/**
 * Validate an arbitrary value against `openMatchConfigSchema`. Throws a
 * structured ZodError if invalid, otherwise returns the typed config.
 */
export function parseOpenMatchConfig(value: unknown): OpenMatchConfig {
  return openMatchConfigSchema.parse(value) as OpenMatchConfig;
}
