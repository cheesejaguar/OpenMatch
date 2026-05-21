import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_DATING_CONFIG,
  type OpenMatchConfig,
  parseOpenMatchConfig,
} from "./config-schema.js";

// Admin (Next.js) platform-config loader.
//
// Server-only — the schema includes branding tokens that are safe to
// surface to the browser but the resolution logic uses node:fs and so
// must stay on the server. Re-export `config` from a server component
// or pass the typed object down via props.

let cached: OpenMatchConfig = DEFAULT_DATING_CONFIG;
let resolved = false;

async function loadFromPath(path: string): Promise<OpenMatchConfig> {
  if (path.endsWith(".json")) {
    const raw = await readFile(path, "utf8");
    return parseOpenMatchConfig(JSON.parse(raw));
  }
  const moduleUrl = pathToFileURL(path).href;
  const mod = (await import(/* webpackIgnore: true */ moduleUrl)) as {
    default?: unknown;
    config?: unknown;
  };
  return parseOpenMatchConfig(mod.default ?? mod.config);
}

/**
 * Resolve the active platform config. Idempotent; subsequent calls
 * return the cached value unless `force` is set. Call once from the
 * admin server entry point.
 */
export async function getConfig(opts: { force?: boolean } = {}): Promise<OpenMatchConfig> {
  if (resolved && !opts.force) return cached;
  const envPath = process.env.OPENMATCH_CONFIG_PATH;
  if (envPath && envPath.length > 0) {
    cached = await loadFromPath(envPath);
  } else {
    cached = parseOpenMatchConfig(DEFAULT_DATING_CONFIG);
  }
  resolved = true;
  return cached;
}

/**
 * Synchronous accessor — returns the last-resolved config, or the
 * baked-in default if `getConfig()` hasn't been awaited yet. Useful
 * for client components that receive a server-rendered snapshot via
 * `<Provider value={getConfigSync()}>`.
 */
export function getConfigSync(): OpenMatchConfig {
  return cached;
}

export type { OpenMatchConfig } from "./config-schema.js";
