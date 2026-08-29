import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function smpRouterSource() {
  return readFileSync(join(root, "api/smp-router.ts"), "utf8");
}

describe("SMP controlled-document router", () => {
  it("removes the demo-data seed procedure entirely", () => {
    const source = smpRouterSource();
    expect(source).not.toContain("seed:");
    expect(source).not.toContain("Demo data loaded");
    expect(source).not.toContain("SMP-EQP-001");
    expect(source).not.toContain("Load Demo");
  });

  it("keeps reads public and every mutation authenticated", () => {
    const source = smpRouterSource();
    expect(source).toContain("list: publicQuery");
    expect(source).toContain("get: publicQuery");
    expect(source).toContain("families: publicQuery");
    expect(source).toContain("create: authedQuery");
    expect(source).toContain("update: authedQuery");
    expect(source).toContain("delete: authedQuery");
  });

  it("never accepts file payloads on metadata mutations", () => {
    const source = smpRouterSource();
    const createRoute = source.slice(source.indexOf("create: authedQuery"), source.indexOf("/* ── Update metadata"));
    const updateRoute = source.slice(source.indexOf("update: authedQuery"), source.indexOf("/* ── Delete a document series"));
    for (const route of [createRoute, updateRoute]) {
      expect(route).not.toContain("fileData");
      expect(route).not.toContain("fileName");
      expect(route).not.toContain("fileType");
      expect(route).not.toContain("file_size");
      expect(route).not.toContain("storagePath");
    }
  });

  it("enforces unique reference numbers on create and update", () => {
    const source = smpRouterSource();
    expect(source).toContain("An SMP with reference number");
    expect(source.match(/already exists\./g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("does not create the table at runtime (replaced by migration 0033)", () => {
    const source = smpRouterSource();
    expect(source).not.toContain("ensureSmpTable");
    expect(source).not.toContain("CREATE TABLE IF NOT EXISTS smp_documents");
  });

  it("returns document series with revision summaries and data-driven filters", () => {
    const source = smpRouterSource();
    expect(source).toContain("revisionCount");
    expect(source).toContain("hasCurrentRevision");
    expect(source).toContain("filters");
    expect(source).toContain("current");
    expect(source).toContain("superseded");
  });
});
