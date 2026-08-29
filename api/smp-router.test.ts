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
    expect(source).toContain("deletePrepare: authedQuery");
    expect(source).toContain("deleteConfirm: authedQuery");
    // No single-shot destructive delete procedure remains.
    expect(source).not.toMatch(/delete:\s+authedQuery/);
  });

  it("never accepts file payloads on metadata mutations", () => {
    const source = smpRouterSource();
    const createRoute = source.slice(source.indexOf("create: authedQuery"), source.indexOf("/* ── Update metadata"));
    const updateRoute = source.slice(source.indexOf("update: authedQuery"), source.indexOf("/* ── Staged deletion"));
    for (const route of [createRoute, updateRoute]) {
      expect(route).not.toContain("fileData");
      expect(route).not.toContain("fileName");
      expect(route).not.toContain("fileType");
      expect(route).not.toContain("file_size");
      expect(route).not.toContain("storagePath");
    }
  });

  it("enforces reference-number uniqueness through the normalized identity key", () => {
    const source = smpRouterSource();
    expect(source).toContain("codeKey");
    expect(source).toContain("normalizeSmpCodeKey");
    expect(source).toContain("An SMP with reference number");
    expect(source.match(/already exists\./g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps literal family text separate from the canonical family relation", () => {
    const source = smpRouterSource();
    expect(source).toContain("smpFamily");
    expect(source).toContain("familyId");
    expect(source).toContain("canonicalFamily");
    expect(source).toMatch(/[Ll]iteral family text/);
  });

  it("does not create the table at runtime (replaced by migrations)", () => {
    const source = smpRouterSource();
    expect(source).not.toContain("ensureSmpTable");
    expect(source).not.toContain("CREATE TABLE IF NOT EXISTS smp_documents");
  });

  it("scopes structured procedure data to a resolved revision in the detail API", () => {
    const source = smpRouterSource();
    expect(source).toContain("revisionId: z.number().int().positive().optional()");
    expect(source).toContain("resolveSmpDetailRevision");
    expect(source).toContain("resolvedRevisionId");
    expect(source).toContain("eq(smpSections.revisionId, resolvedRevision.id)");
    expect(source).toContain("eq(smpTasks.revisionId, resolvedRevision.id)");
  });

  it("returns document series with revision summaries and data-driven filters", () => {
    const source = smpRouterSource();
    expect(source).toContain("revisionCount");
    expect(source).toContain("hasCurrentRevision");
    expect(source).toContain("filters");
    expect(source).toContain("current");
    expect(source).toContain("superseded");
  });

  it("implements staged deletion with a ledger and idempotent confirmation", () => {
    const source = smpRouterSource();
    const deletion = source.slice(source.indexOf("deletePrepare: authedQuery"));
    expect(deletion).toContain("smpDeletionRecords");
    expect(deletion).toContain("storage_failed");
    expect(deletion).toContain("db_failed");
    expect(deletion).toContain("completed");
    expect(deletion).toMatch(/[Rr]etry/);
    // Deletion never claims atomicity across storage and database.
    expect(deletion).not.toContain("db.transaction");
  });
});
