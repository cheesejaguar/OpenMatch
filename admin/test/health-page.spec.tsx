import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "./helpers";

vi.mock("../lib/api/admin-client", () => ({
  adminFetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));

describe("Health page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    result?.unmount();
    result = null;
  });

  it("renders a danger badge when a service is down", async () => {
    const { adminFetch } = (await import("../lib/api/admin-client")) as unknown as {
      adminFetch: ReturnType<typeof vi.fn>;
    };
    // First call: snapshot. Second call: timeseries.
    adminFetch.mockImplementation(async (path: string) => {
      if (path.includes("/health/snapshot")) {
        return {
          status: 200,
          data: {
            ready: {
              ok: false,
              checkedAt: "2026-05-18T12:00:00.000Z",
              checks: {
                postgres: { ok: true, configured: true, latencyMs: 8 },
                ably: { ok: true, configured: true, latencyMs: 30 },
                redis: { ok: false, configured: true, latencyMs: 0, error: "timeout" },
              },
            },
            postgres: {
              maxConnections: 100,
              activeConnections: 5,
              idleConnections: 15,
              poolUsage: 0.05,
            },
            errorRate5m: 0.01,
            queueDepths: { reportsOpen: 3, photosPending: 7, dsaNoticesUnack: 1 },
          },
        };
      }
      return {
        status: 200,
        data: {
          metric: "requests",
          granularity: "hour",
          points: Array.from({ length: 5 }, (_, i) => ({
            t: `2026-05-18T${String(i).padStart(2, "0")}:00:00.000Z`,
            v: 100 + i * 10,
          })),
        },
      };
    });

    const HealthPage = (await import("../app/(app)/health/page")).default;
    const element = await HealthPage();
    result = render(element);

    // There should be a Down badge with the danger variant CSS class.
    const downBadge = Array.from(result.container.querySelectorAll(".badge")).find((el) =>
      el.textContent?.includes("Down"),
    );
    expect(downBadge).toBeDefined();
    // The 'danger' Badge variant maps to the 'removed' class in our
    // existing CSS palette.
    expect(downBadge?.classList.contains("removed")).toBe(true);
    expect(result.container.textContent).toContain("Redis");
  });

  it("renders the not-deployed empty state when the snapshot returns 404", async () => {
    const { adminFetch } = (await import("../lib/api/admin-client")) as unknown as {
      adminFetch: ReturnType<typeof vi.fn>;
    };
    adminFetch.mockImplementation(async (path: string) => {
      if (path.includes("/health/snapshot")) {
        return { status: 404, data: {} };
      }
      return { status: 404, data: {} };
    });

    const HealthPage = (await import("../app/(app)/health/page")).default;
    const element = await HealthPage();
    result = render(element);

    expect(result.container.textContent).toContain("Backend health endpoints not deployed yet");
  });
});
