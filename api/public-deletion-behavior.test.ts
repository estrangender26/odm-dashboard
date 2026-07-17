import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();

// Source code verification tests - verify actual implementation without executing

describe("Source Code Verification - Public Deletion Endpoints", () => {
  it("documents-router deleteFile uses publicQuery", () => {
    const source = readFileSync(join(cwd, "api/documents-router.ts"), "utf8");
    const deleteSection = source.slice(
      source.indexOf("deleteFile:"),
      source.indexOf("deleteFile:") + 50
    );
    expect(deleteSection).toContain("publicQuery");
    expect(deleteSection).not.toContain("authedQuery");
  });

  it("governance-files-router delete uses publicQuery", () => {
    const source = readFileSync(join(cwd, "api/governance-files-router.ts"), "utf8");
    const deleteSection = source.slice(
      source.indexOf("delete:"),
      source.indexOf("delete:") + 50
    );
    expect(deleteSection).toContain("publicQuery");
    expect(deleteSection).not.toContain("authedQuery");
  });

  it("smp-router delete uses publicQuery", () => {
    const source = readFileSync(join(cwd, "api/smp-router.ts"), "utf8");
    const deleteSection = source.slice(
      source.indexOf("delete:"),
      source.indexOf("delete:") + 50
    );
    expect(deleteSection).toContain("publicQuery");
    expect(deleteSection).not.toContain("authedQuery");
  });

  it("governance-router deleteUpload uses publicQuery", () => {
    const source = readFileSync(join(cwd, "api/governance-router.ts"), "utf8");
    const deleteSection = source.slice(
      source.indexOf("deleteUpload:"),
      source.indexOf("deleteUpload:") + 50
    );
    expect(deleteSection).toContain("publicQuery");
    expect(deleteSection).not.toContain("authedQuery");
  });

  it("storage-router delete endpoints do not use requireUser", () => {
    const source = readFileSync(join(cwd, "api/storage-router.ts"), "utf8");
    
    // Check delete/prepare endpoint
    const deletePrepareStart = source.indexOf('storageRouter.post("/files/delete/prepare"');
    const deletePrepareEnd = source.indexOf('storageRouter.post("/files/delete/confirm"');
    const deletePrepareSection = source.slice(deletePrepareStart, deletePrepareEnd);
    expect(deletePrepareSection).not.toContain("requireUser");
    expect(deletePrepareSection).not.toContain("authenticateRequest");

    // Check delete/confirm endpoint
    const deleteConfirmStart = deletePrepareEnd;
    const deleteConfirmEnd = source.indexOf('storageRouter.get("/files/:source/:id/:action"');
    const deleteConfirmSection = source.slice(deleteConfirmStart, deleteConfirmEnd);
    expect(deleteConfirmSection).not.toContain("requireUser");
    expect(deleteConfirmSection).not.toContain("authenticateRequest");
  });
});

// Verify the actual export definitions are accessible
describe("Public Deletion Exports", () => {
  it("documents-router exports deleteFile procedure", async () => {
    const { documentsRouter } = await import("./documents-router");
    expect(documentsRouter).toBeDefined();
    expect(documentsRouter.deleteFile).toBeDefined();
  });

  it("governance-files-router exports delete procedure", async () => {
    const { governanceFilesRouter } = await import("./governance-files-router");
    expect(governanceFilesRouter).toBeDefined();
    expect(governanceFilesRouter.delete).toBeDefined();
  });

  it("smp-router exports delete procedure", async () => {
    const { smpRouter } = await import("./smp-router");
    expect(smpRouter).toBeDefined();
    expect(smpRouter.delete).toBeDefined();
  });

  it("governance-router exports deleteUpload procedure", async () => {
    const { governanceRouter } = await import("./governance-router");
    expect(governanceRouter).toBeDefined();
    expect(governanceRouter.deleteUpload).toBeDefined();
  });

  it("storage-router source contains public delete endpoints", () => {
    const source = readFileSync(join(cwd, "api/storage-router.ts"), "utf8");
    // Verify the router defines delete endpoints
    expect(source).toContain('storageRouter.post("/files/delete/prepare"');
    expect(source).toContain('storageRouter.post("/files/delete/confirm"');
    // These should not require authentication based on our changes
    expect(source).not.toMatch(/storageRouter\.post\("\/files\/delete\/prepare"[\s\S]{0,500}?requireUser/);
    expect(source).not.toMatch(/storageRouter\.post\("\/files\/delete\/confirm"[\s\S]{0,500}?requireUser/);
  });
});
