import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, signOut } from "./backend";
import { render } from "./helpers";

// The page is a Next.js server component. The real session reader
// (HMAC-verified cookie), qrcode renderer and page code run;
// only Next's cookie store and redirect() are stubbed because they exist
// solely inside a running Next.js server. redirect() throws, as in Next.

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect_called:${to}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", async () => (await import("./backend")).nextHeaders);

describe("TOTP enroll page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    await signIn();
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
    const src = img?.getAttribute("src") ?? "";
    expect(src.startsWith("data:image/png;base64,")).toBe(true);
    // A real PNG: base64 payload decodes to the PNG signature.
    const png = Buffer.from(src.slice("data:image/png;base64,".length), "base64");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
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

  it("redirects to /login when there is no valid session", async () => {
    signOut();
    const { default: TotpEnrollPage } = await import("../app/(auth)/login/totp-enroll/page");
    await expect(TotpEnrollPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect_called:/login",
    );
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
