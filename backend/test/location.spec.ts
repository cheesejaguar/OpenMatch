import { describe, expect, it } from "vitest";
import { formatDistance, haversineKm } from "../src/lib/location.js";

describe("formatDistance", () => {
  it("returns Nearby for very short distances", () => {
    expect(formatDistance(0.5).text).toBe("Nearby");
  });
  it("never reveals precise sub-mile distances", () => {
    // Critical privacy invariant — exact distances enable triangulation.
    const out = formatDistance(0.32).text;
    expect(out).not.toMatch(/0\.\d/);
    expect(out).toBe("Nearby");
  });
  it("buckets mid-range distances", () => {
    expect(formatDistance(5).text).toMatch(/miles away/);
    expect(formatDistance(7).text).toMatch(/miles away/);
  });
  it("supports metric locale", () => {
    expect(formatDistance(0.5, "metric").text).toBe("Nearby");
    expect(formatDistance(15, "metric").text).toMatch(/km away/);
  });
});

describe("haversineKm", () => {
  it("returns zero for identical points", () => {
    expect(
      haversineKm({ lat: 37.3382, lng: -121.8863 }, { lat: 37.3382, lng: -121.8863 }),
    ).toBeCloseTo(0, 5);
  });
  it("returns a reasonable distance between San Jose and San Francisco", () => {
    const d = haversineKm(
      { lat: 37.3382, lng: -121.8863 },
      { lat: 37.7749, lng: -122.4194 },
    );
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(80);
  });
});
