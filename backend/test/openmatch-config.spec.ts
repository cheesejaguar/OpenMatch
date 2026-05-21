import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATING_CONFIG,
  openMatchConfigSchema,
  parseOpenMatchConfig,
} from "../src/lib/config-schema.js";

// Config schema validation. The runtime loader in backend/src/lib/
// config.ts validates the resolved config through the same Zod
// schema; this spec exercises the schema directly with the canned
// variants and a handful of malformed inputs.

describe("openMatchConfigSchema", () => {
  it("accepts the dating default", () => {
    expect(() => parseOpenMatchConfig(DEFAULT_DATING_CONFIG)).not.toThrow();
  });

  it("rejects features.minPhotos > features.maxPhotos", () => {
    const bad = {
      ...DEFAULT_DATING_CONFIG,
      features: { ...DEFAULT_DATING_CONFIG.features, minPhotos: 5, maxPhotos: 3 },
    };
    expect(() => openMatchConfigSchema.parse(bad)).toThrowError(/minPhotos/);
  });

  it("rejects requirePhotos:true with minPhotos:0", () => {
    const bad = {
      ...DEFAULT_DATING_CONFIG,
      features: { ...DEFAULT_DATING_CONFIG.features, requirePhotos: true, minPhotos: 0 },
    };
    expect(() => openMatchConfigSchema.parse(bad)).toThrowError(/minPhotos/);
  });

  it("rejects malformed branding colours", () => {
    const bad = {
      ...DEFAULT_DATING_CONFIG,
      branding: { ...DEFAULT_DATING_CONFIG.branding, primaryColorLight: "magenta" },
    };
    expect(() => openMatchConfigSchema.parse(bad)).toThrowError();
  });

  it("rejects unknown variant", () => {
    const bad = {
      ...DEFAULT_DATING_CONFIG,
      variant: "speed-dating",
    };
    expect(() => openMatchConfigSchema.parse(bad)).toThrowError();
  });

  it("accepts a mentorship-style config (photos optional, no swipe deck, no overlay)", () => {
    const ok = {
      variant: "mentorship",
      features: {
        requireGenderPreferences: false,
        requireAgeWindow: false,
        requirePhotos: false,
        minPhotos: 0,
        maxPhotos: 4,
        enableMatchOverlay: false,
        enableSwipeDeck: false,
        enableBoosts: false,
        enableVerification: true,
        enableVoiceNotes: false,
        enableVideoNotes: false,
      },
      copy: {
        appName: "OpenMentor",
        matchVerb: "connected",
        swipeRightVerb: "connect",
        profilePrompt: "Tell us what you want to learn.",
      },
      branding: {
        primaryColorLight: "#2563EB",
        primaryColorDark: "#60A5FA",
        accentColorLight: "#1E1B4B",
        accentColorDark: "#A5B4FC",
      },
    };
    expect(() => parseOpenMatchConfig(ok)).not.toThrow();
  });
});
