import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, signOut } from "./backend";
import { render } from "./helpers";

// The page is a Next.js server component. The real session reader
// (HMAC-verified cookie) and page code run;
// only Next's cookie store and redirect() are stubbed because they exist
// solely inside a running Next.js server. redirect() throws, as in Next.

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect_called:${to}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", async () => (await import("./backend")).nextHeaders);

describe("TOTP verify page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    await signIn();
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

  it("redirects to /login when there is no valid session", async () => {
    signOut();
    const { default: TotpVerifyPage } = await import("../app/(auth)/login/totp-verify/page");
    await expect(TotpVerifyPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect_called:/login",
    );
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
