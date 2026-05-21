import { z } from "zod";

// Platform configuration schema (backend in-tree copy).
//
// The repo-root `openmatch.config.schema.ts` is the source of truth for
// forkers reading the documentation. This file mirrors it so backend
// compilation doesn't have to reach outside `backend/src` (Vercel's
// build step ignores files outside the workspace root). Keep these two
// files in sync — the spec at backend/test/openmatch-config.spec.ts
// validates that the in-tree default round-trips through the schema.

export type OpenMatchVariant = "dating" | "mentorship" | "roommates" | "sports" | "custom";

export interface OpenMatchFeatures {
  requireGenderPreferences: boolean;
  requireAgeWindow: boolean;
  requirePhotos: boolean;
  minPhotos: number;
  maxPhotos: number;
  enableMatchOverlay: boolean;
  enableSwipeDeck: boolean;
  enableBoosts: boolean;
  enableVerification: boolean;
  enableVoiceNotes: boolean;
  enableVideoNotes: boolean;
}

export interface OpenMatchCopy {
  appName: string;
  matchVerb: string;
  swipeRightVerb: string;
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

export function parseOpenMatchConfig(value: unknown): OpenMatchConfig {
  return openMatchConfigSchema.parse(value) as OpenMatchConfig;
}
