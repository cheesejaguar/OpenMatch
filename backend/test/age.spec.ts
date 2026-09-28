import { describe, expect, it } from "vitest";
import { ageOnDate } from "../src/lib/age.js";

describe("calendar age", () => {
  it.each([
    ["2008-09-27", "2026-09-26T23:59:59Z", 17],
    ["2008-09-27", "2026-09-27T00:00:00Z", 18],
    ["2000-02-29", "2026-02-28T23:59:59Z", 25],
    ["2000-02-29", "2026-03-01T00:00:00Z", 26],
    ["2000-02-29", "2024-02-29T00:00:00Z", 24],
    ["1989-09-19", "2026-09-27T00:00:00Z", 37],
  ])("%s at %s is %i", (dob, now, age) => {
    expect(ageOnDate(new Date(dob), new Date(now))).toBe(age);
  });
  it("rejects invalid dates", () =>
    expect(() => ageOnDate(new Date("invalid"))).toThrow(RangeError));
});
