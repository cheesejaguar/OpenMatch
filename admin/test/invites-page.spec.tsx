import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, findButton, render } from "./helpers";

// We mock the admin-client module so the server component can run
// without a real HTTP backend. The Page itself is an async function;
// we await it to get the JSX tree, then mount that tree under our
// helper. revalidatePath is mocked because next/cache is not
// configured for this minimal vitest harness.

vi.mock("../lib/api/admin-client", () => ({
  adminFetch: vi.fn(async () => ({
    status: 200,
    data: { items: [], nextCursor: null },
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("server-only", () => ({}));

describe("Invites page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    result?.unmount();
    result = null;
  });

  it("renders empty state when there are no invites and opens the modal on click", async () => {
    const { adminFetch } = (await import("../lib/api/admin-client")) as unknown as {
      adminFetch: ReturnType<typeof vi.fn>;
    };
    adminFetch.mockResolvedValueOnce({
      status: 200,
      data: { items: [], nextCursor: null },
    });
    const InvitesPageMod = await import("../app/(app)/invites/page");
    const InvitesPage = InvitesPageMod.default;
    const element = await InvitesPage({ searchParams: Promise.resolve({}) });
    result = render(element);

    expect(result.container.textContent).toContain("Invite codes");
    expect(result.container.textContent).toContain("No invite codes match");

    const generate = findButton(result.container, "Generate batch");
    expect(generate).not.toBeNull();

    // Click the button — modal should mount with the form.
    await act(async () => {
      generate?.click();
    });
    // The form lives in a modal-backdrop element.
    const modal = document.querySelector(".modal");
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain("Generate invite codes");
  });

  it("renders invite rows when the API returns codes", async () => {
    const { adminFetch } = (await import("../lib/api/admin-client")) as unknown as {
      adminFetch: ReturnType<typeof vi.fn>;
    };
    adminFetch.mockResolvedValueOnce({
      status: 200,
      data: {
        items: [
          {
            id: "abc",
            code: "SF-ALPHA-001",
            cohortLabel: "sf-wave-1",
            maxUses: 1,
            usedCount: 0,
            expiresAt: null,
            revokedAt: null,
            notes: null,
            createdAt: "2026-05-18T10:00:00.000Z",
            createdByAdminUserId: "admin-1",
          },
        ],
        nextCursor: null,
      },
    });
    const InvitesPageMod = await import("../app/(app)/invites/page");
    const element = await InvitesPageMod.default({ searchParams: Promise.resolve({}) });
    result = render(element);
    expect(result.container.textContent).toContain("SF-ALPHA-001");
    expect(result.container.textContent).toContain("sf-wave-1");
  });
});
