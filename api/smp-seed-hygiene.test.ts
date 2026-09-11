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

  it("seeds no Maintenance Planning task or equipment data", () => {
    // The Maintenance Planning (Post-PPP) seed payload (db/seed-pm.json,
    // db/seed-maint.json) was removed with that module, so no seed path can
    // reintroduce maintenance task rows.
    const source = readFileSync(join(root, "api/seed-router.ts"), "utf8");
    const schemaImports = source.match(/import \{([^}]*)\} from "@db\/schema";/)?.[1] ?? "";

    expect(source).not.toContain("seed-pm.json");
    expect(source).not.toContain("seed-maint.json");
    expect(schemaImports).toContain("governanceFacilities");
    expect(schemaImports.trim()).toBe("governanceFacilities");
  });
});
