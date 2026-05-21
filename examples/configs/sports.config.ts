import type { OpenMatchConfig } from "../../openmatch.config.schema.js";

// Sports variant.
//
// Optimised for finding pickup partners / training buddies. Age windows
// aren't enforced (anyone can play); gender preferences are optional;
// photos are required but only one is needed (just enough to recognise
// each other at the field). The match overlay stays on — it's a fun
// moment when two players' availabilities align.
const config: OpenMatchConfig = {
  variant: "sports",
  features: {
    requireGenderPreferences: false,
    requireAgeWindow: false,
    requirePhotos: true,
    minPhotos: 1,
    maxPhotos: 6,
    enableMatchOverlay: true,
    enableSwipeDeck: true,
    enableBoosts: false,
    enableVerification: false,
    enableVoiceNotes: true,
    enableVideoNotes: false,
  },
  copy: {
    appName: "OpenCourt",
    matchVerb: "paired",
    swipeRightVerb: "interested",
    profilePrompt: "What sport do you play and how often?",
  },
  branding: {
    primaryColorLight: "#EA580C",
    primaryColorDark: "#FB923C",
    accentColorLight: "#7C2D12",
    accentColorDark: "#FED7AA",
  },
};

export default config;
