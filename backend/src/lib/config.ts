import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_DATING_CONFIG,
  type OpenMatchConfig,
  parseOpenMatchConfig,
} from "./config-schema.js";

// Backend platform-config loader.
//
// Resolution order:
//   1. Caller-provided `OPENMATCH_CONFIG_PATH` env var. Either:
//        • a .json file — read synchronously, JSON.parse, Zod validate.
//        • a .js / .mjs / .ts module — dynamic import, `default` export
//          is the config object. The module is evaluated under the
//          host's resolver (tsx in dev, plain node in prod).
//   2. `DEFAULT_DATING_CONFIG` baked into the schema module.
//
// Synchronous `config` export reflects the default at module-load time
// so any module that imports `{ config }` works without awaiting boot.
// At server boot, call `await initConfig()` once to swap in a fork's
// overrides; the same `config` reference is mutated in place so all
// later callers see the resolved values.
//
// This keeps the existing single-tenant deployments behaviour-identical
// (no env var set → default config → today's dating-app behaviour) and
// unblocks forks without forcing every callsite to thread the config
// through.

const internalConfig: { current: OpenMatchConfig } = {
  current: DEFAULT_DATING_CONFIG,
};

/**
 * Live platform config. Read-only to consumers; mutated only by
 * `initConfig()` at boot or `__setConfigForTests()` from spec files.
 */
export const config: Readonly<OpenMatchConfig> = new Proxy(internalConfig.current, {
  get(_target, prop, receiver) {
    return Reflect.get(internalConfig.current, prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(internalConfig.current, prop);
  },
  ownKeys() {
    return Reflect.ownKeys(internalConfig.current);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(internalConfig.current, prop);
  },
}) as Readonly<OpenMatchConfig>;

async function loadConfigFromPath(path: string): Promise<OpenMatchConfig> {
  if (path.endsWith(".json")) {
    const raw = await readFile(path, "utf8");
    return parseOpenMatchConfig(JSON.parse(raw));
  }
  const moduleUrl = pathToFileURL(path).href;
  const mod = (await import(/* @vite-ignore */ moduleUrl)) as {
    default?: unknown;
    config?: unknown;
  };
  return parseOpenMatchConfig(mod.default ?? mod.config);
}

/**
 * Resolve the active platform config. Idempotent; subsequent calls
 * return the cached resolution unless `force` is set.
 */
export async function initConfig(opts: { force?: boolean } = {}): Promise<OpenMatchConfig> {
  if (!opts.force && initConfig.cached) return initConfig.cached;
  const envPath = process.env.OPENMATCH_CONFIG_PATH;
  if (envPath && envPath.length > 0) {
    const loaded = await loadConfigFromPath(envPath);
    internalConfig.current = loaded;
    initConfig.cached = loaded;
    return loaded;
  }
  // No override — keep the baked-in default but still pass it through
  // the Zod schema so a forker who edited the default in source can't
  // ship a malformed shape.
  const validated = parseOpenMatchConfig(internalConfig.current);
  internalConfig.current = validated;
  initConfig.cached = validated;
  return validated;
}
initConfig.cached = null as OpenMatchConfig | null;

/**
 * Replace the active config from a spec file. NEVER call from
 * production code paths — exists so tests can probe alternate
 * variants without touching env vars across the suite.
 */
export function __setConfigForTests(next: OpenMatchConfig): void {
  internalConfig.current = parseOpenMatchConfig(next);
  initConfig.cached = internalConfig.current;
}

/** Reset to the baked-in default. Used by spec `afterEach` hooks. */
export function __resetConfigForTests(): void {
  internalConfig.current = DEFAULT_DATING_CONFIG;
  initConfig.cached = null;
}

export type { OpenMatchConfig } from "./config-schema.js";
