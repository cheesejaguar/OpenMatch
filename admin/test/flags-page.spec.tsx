import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BackendHandler, signIn, stubBackend, TEST_SESSION } from "./backend";
import { act, render } from "./helpers";

// The real page, FlagToggle component, toggleFlag server action and
// admin client all run. Only the backend HTTP hop (global fetch), Next's
// cookie store and Next's revalidatePath cache hook are stubbed, so the
// test proves a click really PATCHes the backend with the right body.

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", async () => (await import("./backend")).nextHeaders);

const FLAG = {
  id: "f1",
  key: "signups_paused",
  enabled: false,
  description: "Pause new signups",
  variants: null,
  updatedAt: "2026-05-18T10:00:00.000Z",
  updatedByAdminUserId: "admin-1",
  createdAt: "2026-05-01T10:00:00.000Z",
};

function backend(patchResponse: { status: number; body: unknown }): BackendHandler {
  return (req) => {
    if (req.method === "GET" && req.url.pathname === "/api/v1/admin/flags") {
      return { body: { items: [FLAG] } };
    }
    if (req.method === "PATCH" && req.url.pathname === `/api/v1/admin/flags/${FLAG.key}`) {
      return patchResponse;
    }
    return undefined;
  };
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Flags page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    await signIn();
  });

  afterEach(() => {
    result?.unmount();
    result = null;
    vi.unstubAllGlobals();
  });

  it("PATCHes the backend when a flag toggle is clicked", async () => {
    const requests = stubBackend(backend({ status: 200, body: { ...FLAG, enabled: true } }));
    const FlagsPage = (await import("../app/(app)/flags/page")).default;
    result = render(await FlagsPage());

    expect(result.container.textContent).toContain("signups_paused");
    expect(result.container.textContent).toContain("Pause new signups");
    const checkbox = result.container.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(false);

    await act(async () => {
      checkbox?.click();
    });
    await settle();

    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url.pathname).toBe("/api/v1/admin/flags/signups_paused");
    expect(patches[0]!.body).toEqual({ enabled: true });
    expect(patches[0]!.headers.get("authorization")).toBe(`Bearer ${TEST_SESSION.accessToken}`);
    expect(revalidatePath).toHaveBeenCalledWith("/flags");
    expect(checkbox?.checked).toBe(true);
    expect(result.container.textContent).toContain("Flag enabled");
  });

  it("reverts the toggle and shows the backend error code when the PATCH is rejected", async () => {
    const requests = stubBackend(
      backend({ status: 403, body: { error: "admin_rbac_denied", required: "flag.write" } }),
    );
    const FlagsPage = (await import("../app/(app)/flags/page")).default;
    result = render(await FlagsPage());
    const checkbox = result.container.querySelector<HTMLInputElement>("input[type='checkbox']");

    await act(async () => {
      checkbox?.click();
    });
    await settle();

    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
    expect(checkbox?.checked).toBe(false);
    expect(result.container.textContent).toContain("admin_rbac_denied");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
