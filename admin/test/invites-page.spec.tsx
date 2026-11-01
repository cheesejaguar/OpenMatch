import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, stubBackend } from "./backend";
import { act, findButton, render } from "./helpers";

// The real server-component page and admin client run against a stubbed
// backend HTTP hop (global fetch). Next's cookie store and revalidatePath
// are stubbed because they only exist inside a running Next.js server.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", async () => (await import("./backend")).nextHeaders);

describe("Invites page", () => {
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

  it("renders empty state when there are no invites and opens the modal on click", async () => {
    const requests = stubBackend((req) =>
      req.url.pathname === "/api/v1/admin/invites"
        ? { body: { items: [], nextCursor: null } }
        : undefined,
    );
    const InvitesPageMod = await import("../app/(app)/invites/page");
    const InvitesPage = InvitesPageMod.default;
    const element = await InvitesPage({ searchParams: Promise.resolve({}) });
    result = render(element);

    // Default filter: status=all, limit=100, no cohort/cursor params.
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({
      status: "all",
      limit: "100",
    });

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

  it("renders invite rows and forwards the URL filters to the backend", async () => {
    const requests = stubBackend((req) =>
      req.url.pathname === "/api/v1/admin/invites"
        ? {
            body: {
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
          }
        : undefined,
    );
    const InvitesPageMod = await import("../app/(app)/invites/page");
    const element = await InvitesPageMod.default({
      searchParams: Promise.resolve({ cohort: "sf-wave-1", status: "active" }),
    });
    result = render(element);

    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({
      cohort: "sf-wave-1",
      status: "active",
      limit: "100",
    });
    expect(result.container.textContent).toContain("SF-ALPHA-001");
    expect(result.container.textContent).toContain("sf-wave-1");
  });

  it("drops an unknown status filter back to 'all'", async () => {
    const requests = stubBackend(() => ({ body: { items: [], nextCursor: null } }));
    const InvitesPageMod = await import("../app/(app)/invites/page");
    await InvitesPageMod.default({ searchParams: Promise.resolve({ status: "bogus" }) });
    expect(requests[0]!.url.searchParams.get("status")).toBe("all");
  });
});
