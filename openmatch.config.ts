import { DEFAULT_DATING_CONFIG, type OpenMatchConfig } from "./openmatch.config.schema.js";

// Default OpenMatch deployment config — the dating variant.
//
// To run a different product variant, copy one of the
// examples/configs/{mentorship,roommates,sports}.config.ts files into
// place (or override OPENMATCH_CONFIG_PATH to point at it).
//
// See docs/configuration.md for what each toggle does.
const config: OpenMatchConfig = DEFAULT_DATING_CONFIG;

export default config;
