import type { OpenMatchConfig } from "../../openmatch.config.schema.js";

// Mentorship variant.
//
// Optimised for matching mentors with mentees: gender preferences and
// age windows aren't part of the matching loop; photos are optional;
// the celebratory match overlay is muted in favour of a plainer
// connection notification; and the swipe deck is swapped for a grid
// view (the iOS client checks `enableSwipeDeck`).
const config: OpenMatchConfig = {
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
    profilePrompt: "Tell us what you're hoping to learn or share.",
  },
  branding: {
    primaryColorLight: "#2563EB",
    primaryColorDark: "#60A5FA",
    accentColorLight: "#1E1B4B",
    accentColorDark: "#A5B4FC",
  },
};

export default config;
