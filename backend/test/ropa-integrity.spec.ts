import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// CI invariant: docs/legal/ropa.yaml stays internally consistent.
//
//  - Each `data_classes[].id` is referenced by at least one activity.
//  - Each activity references only known data classes.
//  - Sub-processors list is non-empty (DPAs exist).
//  - Every activity has a lawful_basis.
//
// If you add a new column to schema.prisma that processes user data,
// you should also add (or extend) a data class in ropa.yaml; the
// compliance-roadmap §0.2 calls this out.

const ROPA_PATH = path.resolve(__dirname, "..", "..", "docs", "legal", "ropa.yaml");

interface Ropa {
  controller: { name: string; contact: string };
  policy_version: string;
  activities: Array<{
    id: string;
    purpose: string;
    lawful_basis: Record<string, string>;
    data_classes: string[];
  }>;
  data_classes: Array<{ id: string; description: string; sensitivity: string }>;
  sub_processors: Array<{ name: string; role: string; location: string }>;
}

const ropa: Ropa = parseYaml(fs.readFileSync(ROPA_PATH, "utf-8"));

describe("RoPA integrity (docs/legal/ropa.yaml)", () => {
  it("has a controller, contact, and policy version", () => {
    expect(ropa.controller?.name).toBeTruthy();
    expect(ropa.controller?.contact).toMatch(/@/);
    expect(ropa.policy_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("every activity has a lawful basis and at least one data class", () => {
    for (const a of ropa.activities) {
      expect(a.id, `activity ${a.id} missing lawful_basis`).toBeTruthy();
      expect(a.purpose).toBeTruthy();
      expect(Object.keys(a.lawful_basis ?? {}).length).toBeGreaterThan(0);
      expect(a.data_classes.length).toBeGreaterThan(0);
    }
  });

  it("every data class id is referenced by at least one activity", () => {
    const referenced = new Set<string>();
    for (const a of ropa.activities) for (const c of a.data_classes) referenced.add(c);
    const declared = ropa.data_classes.map((c) => c.id);
    const orphans = declared.filter((id) => !referenced.has(id));
    expect(
      orphans,
      `Orphan data classes (declared but no activity uses them): ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("every data class referenced by an activity is declared", () => {
    const declared = new Set(ropa.data_classes.map((c) => c.id));
    const missing: string[] = [];
    for (const a of ropa.activities) {
      for (const c of a.data_classes) if (!declared.has(c)) missing.push(`${a.id} -> ${c}`);
    }
    expect(missing, `Activities reference undeclared data classes: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("sub-processor list is non-empty (DPAs exist)", () => {
    expect(ropa.sub_processors.length).toBeGreaterThan(0);
    for (const sp of ropa.sub_processors) {
      expect(sp.name).toBeTruthy();
      expect(sp.role).toBeTruthy();
      expect(sp.location).toBeTruthy();
    }
  });

  it("each data class has a sensitivity tag from the controlled vocabulary", () => {
    const allowed = new Set(["pii", "pii-sensitive", "pseudonymous", "aggregate"]);
    for (const c of ropa.data_classes) {
      expect(allowed.has(c.sensitivity), `data class ${c.id} sensitivity=${c.sensitivity}`).toBe(
        true,
      );
    }
  });
});
