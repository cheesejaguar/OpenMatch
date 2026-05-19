import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "./helpers";

// We mock both the server action module (toggleFlag) and the
// admin-client module (so the Page's await of adminFetch resolves).
// On toggle, we assert toggleFlag was called with the right key.

const toggleFlagMock = vi.fn(async () => ({ ok: true, status: 200 }));
const createFlagMock = vi.fn(async () => ({ ok: true, status: 200 }));

vi.mock("../server/actions/flags", () => ({
  toggleFlag: toggleFlagMock,
  createFlag: createFlagMock,
}));

vi.mock("../lib/api/admin-client", () => ({
  adminFetch: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

describe("Flags page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    result?.unmount();
    result = null;
  });

  it("PATCHes the backend when a flag toggle is clicked", async () => {
    const { adminFetch } = (await import("../lib/api/admin-client")) as unknown as {
      adminFetch: ReturnType<typeof vi.fn>;
    };
    adminFetch.mockResolvedValueOnce({
      status: 200,
      data: {
        items: [
          {
            id: "f1",
            key: "signups_paused",
            enabled: false,
            description: "Pause new signups",
            variants: null,
            updatedAt: "2026-05-18T10:00:00.000Z",
            updatedByAdminUserId: "admin-1",
            createdAt: "2026-05-01T10:00:00.000Z",
          },
        ],
      },
    });
    const FlagsPage = (await import("../app/(app)/flags/page")).default;
    const element = await FlagsPage();
    result = render(element);

    expect(result.container.textContent).toContain("signups_paused");
    const checkbox = result.container.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(false);

    // Fire the toggle. The component dispatches the action via
    // startTransition; act lets React flush both the state set and
    // the queued microtask before assertions run.
    await act(async () => {
      checkbox?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(toggleFlagMock).toHaveBeenCalledTimes(1);
    expect(toggleFlagMock).toHaveBeenCalledWith("signups_paused", true);
  });
});
