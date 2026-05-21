import { describe, expect, it } from "vitest";
import { evaluateHeuristics, HeuristicTextModerator } from "../src/lib/moderation-heuristics.js";

// Trust & safety automation — heuristic moderator coverage. Each rule
// has at least one positive (the rule fires) and one negative (a
// look-alike that must NOT fire) case so we catch over-triggering
// regressions in code review.

describe("evaluateHeuristics — clean inputs", () => {
  it("returns allow + no signals for an empty string", () => {
    const r = evaluateHeuristics({ surface: "message", text: "" });
    expect(r.decision).toBe("allow");
    expect(r.signals).toEqual([]);
  });

  it("returns allow for an ordinary conversational message", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "hey, want to grab coffee on saturday?",
    });
    expect(r.decision).toBe("allow");
    expect(r.signals).toEqual([]);
  });

  it("returns allow for a bio talking about general interests", () => {
    const r = evaluateHeuristics({
      surface: "bio",
      text: "I love hiking, books, and bad puns. Looking for someone with a similar wavelength.",
    });
    expect(r.decision).toBe("allow");
    expect(r.signals).toEqual([]);
  });
});

describe("URL detection", () => {
  it("flags an off-platform URL in a message", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "check out my page at someshady.example",
    });
    expect(r.signals.some((s) => s.reasonCode === "url_in_text")).toBe(true);
    expect(r.decision).toBe("flag");
  });

  it("ignores a whitelisted dating-friendly social domain", () => {
    const r = evaluateHeuristics({
      surface: "bio",
      text: "instagram.com/username",
    });
    expect(r.signals).toEqual([]);
    expect(r.decision).toBe("allow");
  });

  it("does not fire on a version-style numeric token", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "running v1.2.3 of the app",
    });
    expect(r.signals.find((s) => s.reasonCode === "url_in_text")).toBeUndefined();
  });
});

describe("phone number detection", () => {
  it("blocks a phone number in a message", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "text me at +1 415-555-2671 anytime",
    });
    expect(r.signals.some((s) => s.reasonCode === "phone_number")).toBe(true);
    expect(r.decision).toBe("block");
  });

  it("flags a phone number in a bio (less aggressive)", () => {
    const r = evaluateHeuristics({
      surface: "bio",
      text: "DM only — backup contact +44 20 7946 0958",
    });
    expect(r.signals.some((s) => s.reasonCode === "phone_number")).toBe(true);
    expect(r.decision).toBe("flag");
  });

  it("does not fire on a short numeric sequence (zip code)", () => {
    const r = evaluateHeuristics({ surface: "message", text: "in zip 94103" });
    expect(r.signals.find((s) => s.reasonCode === "phone_number")).toBeUndefined();
  });
});

describe("off-platform handle detection", () => {
  it("blocks 'DM me on @handle' in a message", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "lol DM me at @cooluser_99 and we'll chat there",
    });
    expect(r.decision).toBe("block");
    expect(r.signals.some((s) => s.reasonCode === "offplatform_invite")).toBe(true);
  });

  it("blocks a 'telegram @handle' message", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "find me on telegram @realuser",
    });
    expect(r.decision).toBe("block");
    expect(r.signals.some((s) => s.reasonCode === "offplatform_platform")).toBe(true);
  });

  it("only flags an isolated @handle in a bio", () => {
    const r = evaluateHeuristics({
      surface: "bio",
      text: "add me on snapchat @cooluser",
    });
    expect(r.decision).toBe("flag");
  });
});

describe("crypto / scam keyword detection", () => {
  it("flags crypto investment language in a message", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "I run a side gig with guaranteed returns on a usdt wallet",
    });
    expect(r.signals.some((s) => s.reasonCode === "crypto_keyword")).toBe(true);
  });

  it("does not fire on the bare word 'bitcoin' without scam framing", () => {
    const r = evaluateHeuristics({
      surface: "bio",
      text: "I'm curious about bitcoin and tech in general",
    });
    expect(r.signals.find((s) => s.reasonCode === "crypto_keyword")).toBeUndefined();
  });
});

describe("all-caps spam", () => {
  it("flags a message that is mostly uppercase", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "HELLO BEAUTIFUL HOW ARE YOU TODAY MY DEAR",
    });
    expect(r.signals.some((s) => s.reasonCode === "all_caps_spam")).toBe(true);
  });

  it("ignores all-caps in short greetings", () => {
    const r = evaluateHeuristics({ surface: "message", text: "OK!" });
    expect(r.signals).toEqual([]);
  });
});

describe("repeated character flood", () => {
  it("blocks a message with a 10+ char flood", () => {
    const r = evaluateHeuristics({
      surface: "message",
      text: "haaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(r.decision).toBe("block");
    expect(r.signals.some((s) => s.reasonCode === "char_flood")).toBe(true);
  });
});

describe("HeuristicTextModerator class", () => {
  it("delegates to evaluateHeuristics", () => {
    const m = new HeuristicTextModerator();
    expect(m.name).toBe("heuristic");
    const r = m.moderate({ surface: "message", text: "hi there!" });
    expect(r.decision).toBe("allow");
  });
});
