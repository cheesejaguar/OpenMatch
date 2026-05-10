import { describe, expect, it } from "vitest";
import { currentConfig } from "../src/config.js";
import { explain } from "../src/explain.js";
import { makeCandidates, makeViewer } from "./helpers.js";

describe("explain", () => {
  it("mentions distance when within range", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const nearby = candidates.find(
      (c) =>
        c.profile.gender === "Man" &&
        c.distanceKm < 5 &&
        c.profile.userId !== "u019",
    )!;
    const e = explain(viewer, nearby, currentConfig);
    expect(e.keys).toContain("withinDistance");
    expect(e.summary).toMatch(/distance range/i);
  });

  it("mentions shared interests when present", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const sharing = candidates.find(
      (c) =>
        c.profile.userId === "u002" /* shares hiking & cooking with u001 */,
    )!;
    const e = explain(viewer, sharing, currentConfig);
    expect(e.keys).toContain("sharedInterests");
    expect(e.summary).toMatch(/share \d+ interest/i);
  });

  it("never quotes the raw score", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    for (const c of candidates) {
      const e = explain(viewer, c, currentConfig);
      // No floating-point numbers in user-facing copy except the
      // "you share N interests" count, which is an integer.
      expect(e.summary).not.toMatch(/0\.\d+/);
    }
  });

  it("never mentions fairness rotation or randomization", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    for (const c of candidates) {
      const e = explain(viewer, c, currentConfig);
      expect(e.summary).not.toMatch(/fairness/i);
      expect(e.summary).not.toMatch(/random/i);
      expect(e.summary).not.toMatch(/rotation/i);
    }
  });
});
