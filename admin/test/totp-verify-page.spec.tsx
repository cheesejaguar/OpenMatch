import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "./helpers";

vi.mock("../lib/api/admin-client", () => ({
  adminFetch: vi.fn(async () => ({ ok: true, status: 200, data: { ok: true } })),
}));

vi.mock("../lib/auth/session", () => ({
  readSession: vi.fn(async () => ({
    adminUserId: "admin-1",
    email: "admin@openmatch.local",
    roles: [],
    permissions: [],
    accessToken: "tkn",
    refreshToken: "rtkn",
    accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect_called");
  }),
}));

vi.mock("server-only", () => ({}));

describe("TOTP verify page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    result?.unmount();
    result = null;
  });

  it("renders the TOTP entry form by default", async () => {
    const { default: TotpVerifyPage } = await import("../app/(auth)/login/totp-verify/page");
    const element = await TotpVerifyPage({
      searchParams: Promise.resolve({}),
    });
    result = render(element);
    expect(result.container.textContent).toContain("Two-factor verification");
    expect(result.container.textContent).toContain("Open your authenticator app");
    expect(result.container.querySelector("input#code")).not.toBeNull();
    // Recovery link present in default mode.
    expect(result.container.textContent).toContain("Use a recovery code");
  });

  it("renders the recovery-code form when ?recovery=1", async () => {
    const { default: TotpVerifyPage } = await import("../app/(auth)/login/totp-verify/page");
    const element = await TotpVerifyPage({
      searchParams: Promise.resolve({ recovery: "1" }),
    });
    result = render(element);
    expect(result.container.textContent).toContain("Enter one of the recovery codes");
    expect(result.container.querySelector("input#recoveryCode")).not.toBeNull();
    expect(result.container.textContent).toContain("Use the authenticator app instead");
  });

  it("surfaces an error message from the URL", async () => {
    const { default: TotpVerifyPage } = await import("../app/(auth)/login/totp-verify/page");
    const element = await TotpVerifyPage({
      searchParams: Promise.resolve({ error: "invalid_code" }),
    });
    result = render(element);
    expect(result.container.textContent).toContain("invalid_code");
  });

  it("propagates the `next` param through both forms", async () => {
    const { default: TotpVerifyPage } = await import("../app/(auth)/login/totp-verify/page");
    const element = await TotpVerifyPage({
      searchParams: Promise.resolve({ next: "/reports" }),
    });
    result = render(element);
    const hiddenNext = result.container.querySelector(
      "input[type='hidden'][name='next']",
    ) as HTMLInputElement | null;
    expect(hiddenNext?.value).toBe("/reports");
  });
});
