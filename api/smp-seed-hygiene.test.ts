import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("SMP dummy-data seed hygiene", () => {
  it("seed-router does not seed any SMP tables", () => {
    const source = readFileSync(join(root, "api/seed-router.ts"), "utf8");
    expect(source).not.toContain("smpDocuments");
    expect(source).not.toContain("smp_document_revisions");
    expect(source).not.toContain("smp_sections");
    expect(source).not.toContain("smp_tasks");
    expect(source).not.toContain("smp_families");
  });

  it("seed data files contain no SMP records", () => {
    const pmData = JSON.parse(readFileSync(join(root, "db/seed-pm.json"), "utf8"));
    const maintData = JSON.parse(readFileSync(join(root, "db/seed-maint.json"), "utf8"));
    const all = [...(Array.isArray(pmData) ? pmData : []), ...(Array.isArray(maintData) ? maintData : [])];
    for (const row of all) {
      const text = JSON.stringify(row).toLowerCase();
      expect(text).not.toMatch(/smp|standard maintenance procedure|system maintenance plan/);
    }
  });
});
