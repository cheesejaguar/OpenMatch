import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, stubBackend } from "./backend";
import { render } from "./helpers";

// The real page + admin client run against a stubbed backend HTTP hop.
vi.mock("next/headers", async () => (await import("./backend")).nextHeaders);

describe("Health page", () => {
  let result: ReturnType<typeof render> | null = null;

  beforeEach(async () => {
    await signIn();
  });

  afterEach(() => {
    result?.unmount();
    result = null;
    vi.unstubAllGlobals();
  });

  it("renders a danger badge when a service is down", async () => {
    // First call: snapshot. Second call: timeseries.
    const requests = stubBackend((req) => {
      if (req.url.pathname === "/api/v1/admin/health/snapshot") {
        return {
          body: {
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
        body: {
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
    const series = requests.find((r) => r.url.pathname === "/api/v1/admin/metrics/timeseries");
    expect(series?.url.searchParams.get("metric")).toBe("requests");
    expect(series?.url.searchParams.get("granularity")).toBe("hour");
    const from = Date.parse(series!.url.searchParams.get("from")!);
    const to = Date.parse(series!.url.searchParams.get("to")!);
    expect(to - from).toBe(24 * 60 * 60 * 1000);
    // The 'danger' Badge variant maps to the 'removed' class in our
    // existing CSS palette.
    expect(downBadge?.classList.contains("removed")).toBe(true);
    expect(result.container.textContent).toContain("Redis");
  });

  it("renders the not-deployed empty state when the snapshot returns 404", async () => {
    stubBackend(() => ({ status: 404, body: { error: "not_found" } }));

    const HealthPage = (await import("../app/(app)/health/page")).default;
    const element = await HealthPage();
    result = render(element);

    expect(result.container.textContent).toContain("Backend health endpoints not deployed yet");
  });
});
