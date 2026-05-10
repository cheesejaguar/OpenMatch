import configJson from "../algorithm_config.json" with { type: "json" };
import type { AlgorithmConfig } from "./types.js";

// The config is the source of truth for production weights. We re-export it
// strongly typed so consumers cannot accidentally mutate the runtime value.
export const currentConfig: AlgorithmConfig = Object.freeze(
  configJson as AlgorithmConfig,
) as AlgorithmConfig;
