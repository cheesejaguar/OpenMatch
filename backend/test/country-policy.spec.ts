import { describe, expect, it } from "vitest";
import { _countryPolicyLists, decideCountry } from "../src/lib/safety/country-policy.js";

describe("country-policy.decideCountry", () => {
  it("allows MVP launch geographies", () => {
    for (const c of ["US", "GB", "DE", "FR", "IE", "ES", "NL", "CH"]) {
      expect(decideCountry(c).allow, c).toBe(true);
    }
  });

  it("blocks comprehensive-sanctions countries", () => {
    for (const c of ["IR", "KP", "CU", "SY"]) {
      const d = decideCountry(c);
      // IR and SY are also on the LGBTQ-criminalised list; the policy
      // returns "sanctions" first — block reason matters less than the
      // fact of blocking.
      expect(d.allow, c).toBe(false);
      expect(
        ["sanctions", "lgbtq_criminalised"].includes((d as { reason?: string }).reason ?? ""),
      ).toBe(true);
    }
  });

  it("blocks LGBTQ-criminalised jurisdictions even if not sanctioned", () => {
    for (const c of ["NG", "UG", "SA", "AE", "EG", "QA"]) {
      const d = decideCountry(c);
      expect(d.allow, c).toBe(false);
      expect((d as { reason?: string }).reason).toBe("lgbtq_criminalised");
    }
  });

  it("returns unsupported for out-of-launch geographies", () => {
    for (const c of ["JP", "BR", "AU", "IN", "AR", "MX"]) {
      const d = decideCountry(c);
      expect(d.allow, c).toBe(false);
      expect((d as { reason?: string }).reason).toBe("unsupported");
    }
  });

  it("returns unsupported for missing or empty input", () => {
    expect(decideCountry(null).allow).toBe(false);
    expect(decideCountry(undefined).allow).toBe(false);
    expect(decideCountry("").allow).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(decideCountry("us").allow).toBe(true);
    expect(decideCountry("ir").allow).toBe(false);
  });

  it("sanity-checks list disjointness where intended", () => {
    // Launch geographies must not overlap with sanctions or criminalised.
    for (const c of _countryPolicyLists.LAUNCH_GEOGRAPHIES) {
      expect(_countryPolicyLists.SANCTIONED_COUNTRIES.has(c), c).toBe(false);
      expect(_countryPolicyLists.LGBTQ_CRIMINALISED_COUNTRIES.has(c), c).toBe(false);
    }
  });
});
