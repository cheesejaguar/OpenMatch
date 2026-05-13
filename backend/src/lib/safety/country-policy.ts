// Country-level access policy.
//
// We restrict OpenMatch's availability for two reasons:
//
//   1. SANCTIONS: United States, EU, and UK comprehensive-sanctions
//      countries cannot lawfully be served, and US OFAC SDN-listed
//      jurisdictions require specific licences we do not hold.
//
//   2. SAFETY: In a non-trivial set of countries, same-sex matching
//      is criminalised — sometimes with penalties up to and including
//      death. Hosting LGBTQ+ users from those geographies puts them
//      at risk we cannot mitigate (lawful-process disclosure, in-app
//      data, photos, location). We therefore decline to offer the
//      service rather than create a deniable safety hazard.
//
// Both lists are reviewed quarterly with counsel of record; changes
// land in this module + a privacy-notice supplement and a compliance-
// roadmap note.

export type CountryDecision =
  | { allow: true; reason?: string }
  | { allow: false; reason: "sanctions" | "lgbtq_criminalised" | "unsupported"; note: string };

// US / EU / UK comprehensive sanctions overlap. ISO-3166 alpha-2.
// Crimea / DNR / LNR are not separate country codes; we block them
// via subdivision checks in the calling middleware (out of scope here).
const SANCTIONED_COUNTRIES: ReadonlySet<string> = new Set([
  "CU", // Cuba
  "IR", // Iran
  "KP", // North Korea
  "SY", // Syria
  // Russia / Belarus are subject to sectoral but not comprehensive
  // consumer sanctions; counsel review pending before launch in those
  // markets.
]);

// Jurisdictions where same-sex sexual activity is criminalised. Source:
// ILGA-World "State-Sponsored Homophobia" report (most recent edition).
// This list is conservative: we include countries where prosecution is
// unlikely but lawful, because *lawful* is what controls our exposure.
// Counsel review every 6 months minimum.
const LGBTQ_CRIMINALISED_COUNTRIES: ReadonlySet<string> = new Set([
  "AF", // Afghanistan
  "DZ", // Algeria
  "BD", // Bangladesh
  "BB", // Barbados
  "BN", // Brunei
  "BI", // Burundi
  "CM", // Cameroon
  "TD", // Chad
  "KM", // Comoros
  "CG", // Republic of the Congo
  "DM", // Dominica
  "EG", // Egypt (interpretation by courts; prosecutions occur)
  "ER", // Eritrea
  "SZ", // Eswatini
  "ET", // Ethiopia
  "GM", // Gambia
  "GH", // Ghana
  "GN", // Guinea
  "GY", // Guyana
  "IR", // Iran
  "IQ", // Iraq
  "JM", // Jamaica
  "KE", // Kenya
  "KW", // Kuwait
  "LB", // Lebanon
  "LR", // Liberia
  "LY", // Libya
  "MW", // Malawi
  "MY", // Malaysia
  "MV", // Maldives
  "MR", // Mauritania
  "MA", // Morocco
  "MM", // Myanmar
  "NA", // Namibia (recent re-criminalisation pending)
  "NG", // Nigeria
  "OM", // Oman
  "PK", // Pakistan
  "PS", // Palestine / Gaza
  "QA", // Qatar
  "SA", // Saudi Arabia
  "SN", // Senegal
  "SL", // Sierra Leone
  "SB", // Solomon Islands
  "SO", // Somalia
  "SS", // South Sudan
  "LK", // Sri Lanka
  "SD", // Sudan
  "SY", // Syria
  "TZ", // Tanzania
  "TG", // Togo
  "TN", // Tunisia
  "TM", // Turkmenistan
  "TV", // Tuvalu
  "UG", // Uganda
  "AE", // United Arab Emirates
  "UZ", // Uzbekistan
  "YE", // Yemen
  "ZM", // Zambia
  "ZW", // Zimbabwe
]);

// MVP launch geography. Anything outside this set is "unsupported"
// today; we route the user to a waitlist instead of allowing them in.
const LAUNCH_GEOGRAPHIES: ReadonlySet<string> = new Set([
  // United States
  "US",
  // United Kingdom
  "GB",
  // European Economic Area (27 EU + Iceland, Liechtenstein, Norway)
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  // Switzerland (revFADP-aligned)
  "CH",
]);

export function decideCountry(code: string | null | undefined): CountryDecision {
  if (!code) {
    return {
      allow: false,
      reason: "unsupported",
      note: "Country could not be determined.",
    };
  }
  const c = code.toUpperCase();
  if (SANCTIONED_COUNTRIES.has(c)) {
    return {
      allow: false,
      reason: "sanctions",
      note: "OpenMatch cannot be offered in this jurisdiction under applicable US/EU/UK sanctions.",
    };
  }
  if (LGBTQ_CRIMINALISED_COUNTRIES.has(c)) {
    return {
      allow: false,
      reason: "lgbtq_criminalised",
      note: "OpenMatch is not currently offered in jurisdictions where same-sex matching is criminalised, because we cannot guarantee user safety against lawful-process disclosure in those jurisdictions.",
    };
  }
  if (!LAUNCH_GEOGRAPHIES.has(c)) {
    return {
      allow: false,
      reason: "unsupported",
      note: "OpenMatch is not yet available in this country. A waitlist sign-up is provided in the app.",
    };
  }
  return { allow: true };
}

export const _countryPolicyLists = {
  SANCTIONED_COUNTRIES,
  LGBTQ_CRIMINALISED_COUNTRIES,
  LAUNCH_GEOGRAPHIES,
} as const;
