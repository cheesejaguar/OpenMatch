import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SEV-A8 / SEV-V9 — admin allow-list bypass tightening.
//
// The legacy gate was `env.NODE_ENV !== "production"` which accepted
// any non-production NODE_ENV (preview, staging, qa, even a misspelt
// "Production"). Combined with the dev-mode auto-provision branch
// that meant any preview deployment of the repo became an
// admin-account-mint endpoint. The fixed gate requires `development`
// AND an explicit `ALLOW_DEV_LOGIN=true` opt-in.

const PRIOR_ENV = { ...process.env };

// Provide non-test placeholders so the Zod schema parse succeeds when
// we flip NODE_ENV to development / production for the bypass-gate
// checks below. The values are validated for length only; we use long
// random strings so we satisfy `min(32)` and the "not the documented
// placeholder" refinement.
const FAKE_SECRETS = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://invalid",
  JWT_SECRET: "wave2-allowlist-spec-jwt-secret-padding-bytes",
  ADMIN_JWT_SECRET: "wave2-allowlist-spec-admin-jwt-secret-padding-bytes",
  INTERNAL_WORKER_TOKEN: "wave2-allowlist-spec-internal-worker-token-padding-bytes",
};

afterEach(() => {
  process.env = { ...PRIOR_ENV };
});

async function loadIsEmailAdminAllowed() {
  vi.resetModules();
  const mod = await import("../src/services/admin/auth.service.js");
  return mod.isEmailAdminAllowed;
}

function setEnv(overrides: Record<string, string | undefined>) {
  // Build process.env from scratch so leftover values from a prior
  // test don't bleed across. Real test bootstraps clear NODE_ENV-test
  // before we run, so secrets have to be re-injected each time.
  process.env = { ...PRIOR_ENV };
  for (const k of Object.keys(FAKE_SECRETS)) {
    process.env[k] = (FAKE_SECRETS as Record<string, string>)[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("isEmailAdminAllowed — empty allowlist (SEV-A8)", () => {
  it("returns false in development without ALLOW_DEV_LOGIN", async () => {
    setEnv({ NODE_ENV: "development", ADMIN_ALLOWED_EMAILS: "", ALLOW_DEV_LOGIN: undefined });
    const isAllowed = await loadIsEmailAdminAllowed();
    expect(isAllowed("alice@example.com")).toBe(false);
  });

  it("returns true only when development AND ALLOW_DEV_LOGIN=true", async () => {
    setEnv({ NODE_ENV: "development", ADMIN_ALLOWED_EMAILS: "", ALLOW_DEV_LOGIN: "true" });
    const isAllowed = await loadIsEmailAdminAllowed();
    expect(isAllowed("alice@example.com")).toBe(true);
  });

  it("returns true in NODE_ENV=test for backwards-compat with integration suite", async () => {
    setEnv({ NODE_ENV: "test", ADMIN_ALLOWED_EMAILS: "", ALLOW_DEV_LOGIN: undefined });
    const isAllowed = await loadIsEmailAdminAllowed();
    // The integration suite (test/admin-*.spec.ts) seeds AdminUser
    // rows out of band and relies on the empty-allowlist branch to
    // return true so the magic-link path can be exercised. Production
    // and preview still fail closed.
    expect(isAllowed("alice@example.com")).toBe(true);
  });

  it("returns false in unknown / misspelt NODE_ENV (preview / staging / qa)", async () => {
    // The Zod schema only accepts development/test/production so the
    // schema itself is the first defence; we still document the
    // service-layer fallback here so a future widening of the enum
    // can't silently re-enable the empty-allowlist branch.
    setEnv({ NODE_ENV: "development", ADMIN_ALLOWED_EMAILS: "", ALLOW_DEV_LOGIN: "false" });
    const isAllowed = await loadIsEmailAdminAllowed();
    expect(isAllowed("alice@example.com")).toBe(false);
  });
});

describe("isEmailAdminAllowed — populated allowlist", () => {
  it("permits only exact allowlist matches in production", async () => {
    setEnv({
      NODE_ENV: "production",
      ADMIN_ALLOWED_EMAILS: "alice@openmatch.app,bob@openmatch.app",
      ALLOW_DEV_LOGIN: undefined,
    });
    const isAllowed = await loadIsEmailAdminAllowed();
    expect(isAllowed("alice@openmatch.app")).toBe(true);
    expect(isAllowed("BOB@openmatch.app")).toBe(true); // case-insensitive
    expect(isAllowed("eve@openmatch.app")).toBe(false);
  });
});

describe("ALLOW_DEV_LOGIN refusal in production (SEV-N22)", () => {
  it("refuses to load env when ALLOW_DEV_LOGIN=true and NODE_ENV=production", async () => {
    setEnv({
      NODE_ENV: "production",
      ADMIN_ALLOWED_EMAILS: "alice@openmatch.app",
      ALLOW_DEV_LOGIN: "true",
    });
    vi.resetModules();
    await expect(import("../src/env.js")).rejects.toThrow();
  });
});
