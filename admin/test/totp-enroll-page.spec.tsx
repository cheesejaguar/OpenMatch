import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "./helpers";

// The enrol page is a Next.js server component. We mock everything it
// touches: the admin API client (we just need it not to throw), the
// session reader, qrcode (we don't render an actual QR), and
// next/navigation (redirect throws — never called in render-only path).

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

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async () => "data:image/png;base64,FAKEQR"),
  },
}));

vi.mock("server-only", () => ({}));

describe("TOTP enroll page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    result?.unmount();
    result = null;
  });

  it("renders the 'generate secret' CTA when no enrolment is in progress", async () => {
    const { default: TotpEnrollPage } = await import("../app/(auth)/login/totp-enroll/page");
    const element = await TotpEnrollPage({
      searchParams: Promise.resolve({}),
    });
    result = render(element);
    expect(result.container.textContent).toContain("Set up two-factor authentication");
    expect(result.container.textContent).toContain("Generate secret");
    // No QR image yet.
    expect(result.container.querySelector("img")).toBeNull();
  });

  it("renders the QR + recovery codes once the URI is present", async () => {
    const { default: TotpEnrollPage } = await import("../app/(auth)/login/totp-enroll/page");
    const codes = ["ABCDE-FGHIJ", "12345-67890", "AAAAA-BBBBB", "CCCCC-DDDDD"];
    const element = await TotpEnrollPage({
      searchParams: Promise.resolve({
        uri: "otpauth://totp/OpenMatch%20Admin:admin@openmatch.local?secret=JBSWY3DPEHPK3PXP&issuer=OpenMatch%20Admin",
        codes: codes.join(","),
        next: "/overview",
      }),
    });
    result = render(element);
    const img = result.container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain("data:image/png;base64,FAKEQR");
    for (const c of codes) {
      expect(result.container.textContent).toContain(c);
    }
    expect(result.container.textContent).toContain("Verify and continue");
    // Inline secret is rendered next to the QR.
    expect(result.container.textContent).toContain("JBSWY3DPEHPK3PXP");
  });

  it("surfaces a server-action error on the page", async () => {
    const { default: TotpEnrollPage } = await import("../app/(auth)/login/totp-enroll/page");
    const element = await TotpEnrollPage({
      searchParams: Promise.resolve({ error: "invalid_code" }),
    });
    result = render(element);
    expect(result.container.textContent).toContain("invalid_code");
  });
});
