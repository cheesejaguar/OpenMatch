import type { OpenMatchConfig } from "../../openmatch.config.schema.js";

// Roommates variant.
//
// Two-way match is meaningful (both parties have to be willing) but the
// dating-style celebratory overlay would feel off; we use a plain
// notification instead. Photos are required (one minimum) so prospective
// roommates can see who they're meeting. Gender preferences are still
// available for users who want a same-gender household; the matcher
// honours them when set but doesn't *require* them.
const config: OpenMatchConfig = {
  variant: "roommates",
  features: {
    requireGenderPreferences: false,
    requireAgeWindow: false,
    requirePhotos: true,
    minPhotos: 1,
    maxPhotos: 6,
    enableMatchOverlay: false,
    enableSwipeDeck: true,
    enableBoosts: false,
    enableVerification: true,
    enableVoiceNotes: false,
    enableVideoNotes: false,
  },
  copy: {
    appName: "OpenRoom",
    matchVerb: "paired",
    swipeRightVerb: "interested",
    profilePrompt: "Tell us about the home and what you're looking for in a roommate.",
  },
  branding: {
    primaryColorLight: "#059669",
    primaryColorDark: "#34D399",
    accentColorLight: "#064E3B",
    accentColorDark: "#A7F3D0",
  },
};

export default config;
