/**
 * Lightweight i18n helper for the admin dashboard.
 *
 * Most admin pages are RSC and the strings are static, so we don't yet
 * need a full `next-intl` bootstrap. This module:
 *
 *   - Resolves the active locale from a per-request header (set in
 *     `middleware.ts` based on `Accept-Language` + `?locale=`).
 *   - Loads the JSON bundle once per locale (module-level cache).
 *   - Falls back to English for any key that's missing or still
 *     carrying the `???key???` stub placeholder. This is the contract:
 *     stub locales render in English until a contributor translates.
 *
 * If we later need per-component dynamic locale switching or pluralization,
 * swap this for `next-intl`. The `t()` API is intentionally a strict
 * subset of next-intl's so the upgrade is a near-mechanical rename.
 */
import { headers } from "next/headers";

import enMessages from "../messages/en.json";

export const SUPPORTED_LOCALES = ["en", "es", "fr", "de", "ja"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const HEADER_NAME = "x-om-locale";

type MessageNode = string | { [k: string]: MessageNode };
type MessageTree = { [k: string]: MessageNode };

const bundles: Partial<Record<Locale, MessageTree>> = {
  en: enMessages as MessageTree,
};

async function loadBundle(locale: Locale): Promise<MessageTree> {
  if (bundles[locale]) return bundles[locale] as MessageTree;
  try {
    // Static imports for the four stub locales. Bundler resolves these
    // at build time so the public/server bundle is identical regardless
    // of which locale a request lands in.
    const mod = await import(`../messages/${locale}.json`);
    bundles[locale] = mod.default as MessageTree;
    return bundles[locale] as MessageTree;
  } catch {
    return bundles.en as MessageTree;
  }
}

function lookup(tree: MessageTree, key: string): string | undefined {
  const parts = key.split(".");
  let cur: MessageNode | undefined = tree;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as MessageTree)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

function isStub(value: string): boolean {
  // Stub values look like `???some.dotted.key???`. We render English
  // instead of leaking the placeholder to the operator.
  return value.startsWith("???") && value.endsWith("???");
}

/**
 * Resolve the locale for the current request.
 *
 * Priority: explicit `x-om-locale` request header (set by middleware
 * from `?locale=` or `Accept-Language`) → DEFAULT_LOCALE.
 */
export async function getLocale(): Promise<Locale> {
  const h = await headers();
  const raw = h.get(HEADER_NAME);
  if (raw && (SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    return raw as Locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Translator factory. Returns a `t(key)` function bound to the active
 * locale. Missing or stubbed keys fall back to English; missing in
 * English too returns the literal key (loud failure mode for a
 * developer who mistyped the key).
 *
 * Usage in an RSC:
 *
 *   const t = await getMessages();
 *   <h1>{t("status.page_title")}</h1>
 */
export async function getMessages(): Promise<(key: string) => string> {
  const locale = await getLocale();
  const bundle = await loadBundle(locale);
  const en = bundles.en as MessageTree;
  return (key: string): string => {
    const v = lookup(bundle, key);
    if (v != null && !isStub(v)) return v;
    return lookup(en, key) ?? key;
  };
}

/**
 * Parse a `?locale=`/`Accept-Language` value into a supported locale.
 * Used by the middleware to normalize before forwarding the request.
 */
export function negotiateLocale(acceptLanguage: string | null, explicit: string | null): Locale {
  if (explicit && (SUPPORTED_LOCALES as readonly string[]).includes(explicit)) {
    return explicit as Locale;
  }
  if (!acceptLanguage) return DEFAULT_LOCALE;
  // Cheap parser: pick the highest-quality token that maps to a
  // supported locale by primary-tag match. We ignore q-weighting nuance
  // beyond "first-match wins after sorting" because the admin
  // dashboard's user surface is single-language per session.
  const tokens = acceptLanguage
    .split(",")
    .map((t) => t.trim().split(";")[0].trim().toLowerCase())
    .filter(Boolean);
  for (const tok of tokens) {
    const primary = tok.split("-")[0];
    if ((SUPPORTED_LOCALES as readonly string[]).includes(primary)) {
      return primary as Locale;
    }
  }
  return DEFAULT_LOCALE;
}

export const _i18nInternals = { lookup, isStub, loadBundle };
