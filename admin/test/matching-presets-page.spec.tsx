import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, stubBackend, TEST_SESSION } from "./backend";
import { act, render } from "./helpers";

// Mirrors flags-page.spec: the real page, PresetToggle, updatePreset
// server action and admin client run; only the backend HTTP hop, Next's
// cookie store and revalidatePath are stubbed.

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", async () => (await import("./backend")).nextHeaders);

const PRESET = {
  id: "p1",
  key: "balanced",
  label: "Balanced",
  description: "Default blend",
  strategyId: "weighted-sum",
  weights: {},
  enabled: true,
  isDefault: true,
  sortOrder: 0,
  updatedAt: "2026-05-24T10:00:00.000Z",
  updatedByAdminUserId: "admin-1",
  createdAt: "2026-05-24T10:00:00.000Z",
};

describe("Matching presets page", () => {
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

  it("renders presets and PATCHes when the enabled toggle is clicked", async () => {
    const requests = stubBackend((req) => {
      if (req.method === "GET" && req.url.pathname === "/api/v1/admin/matching-presets") {
        return { body: { items: [PRESET] } };
      }
      if (
        req.method === "PATCH" &&
        req.url.pathname === "/api/v1/admin/matching-presets/balanced"
      ) {
        return { body: { ...PRESET, enabled: false } };
      }
      return undefined;
    });
    const Page = (await import("../app/(app)/matching-presets/page")).default;
    result = render(await Page());

    expect(result.container.textContent).toContain("balanced");
    expect(result.container.textContent).toContain("weighted-sum");
    const checkbox = result.container.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox?.checked).toBe(true);

    await act(async () => {
      checkbox?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url.pathname).toBe("/api/v1/admin/matching-presets/balanced");
    expect(patches[0]!.body).toEqual({ enabled: false });
    expect(patches[0]!.headers.get("authorization")).toBe(`Bearer ${TEST_SESSION.accessToken}`);
    expect(revalidatePath).toHaveBeenCalledWith("/matching-presets");
    expect(checkbox?.checked).toBe(false);
  });
});
