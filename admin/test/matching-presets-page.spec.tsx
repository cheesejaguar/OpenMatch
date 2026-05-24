import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "./helpers";

// Mirrors flags-page.spec: mock the server actions + admin-client so the
// server-component Page resolves, render it, and assert the enabled toggle
// dispatches updatePreset with the right payload.

const updatePresetMock = vi.fn(async () => ({ ok: true, status: 200 }));
const createPresetMock = vi.fn(async () => ({ ok: true, status: 200 }));

vi.mock("../server/actions/matching-presets", () => ({
  updatePreset: updatePresetMock,
  createPreset: createPresetMock,
}));

vi.mock("../lib/api/admin-client", () => ({
  adminFetch: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

describe("Matching presets page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    result?.unmount();
    result = null;
  });

  it("renders presets and PATCHes when the enabled toggle is clicked", async () => {
    const { adminFetch } = (await import("../lib/api/admin-client")) as unknown as {
      adminFetch: ReturnType<typeof vi.fn>;
    };
    adminFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        items: [
          {
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
          },
        ],
      },
    });
    const Page = (await import("../app/(app)/matching-presets/page")).default;
    const element = await Page();
    result = render(element);

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

    expect(updatePresetMock).toHaveBeenCalledTimes(1);
    expect(updatePresetMock).toHaveBeenCalledWith({ key: "balanced", enabled: false });
  });
});
