import { describe, it, expect, vi } from "vitest";

// Mock the database and auth before importing routers
vi.mock("./queries/connection", () => ({
  db: {
    delete: () => ({ where: vi.fn() }),
    select: () => ({ from: () => ({ where: vi.fn() }) }),
    insert: () => ({ values: vi.fn() }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@/lib/supabase-storage", () => ({
  getSupabaseStorageAdmin: () => ({ storage: { from: vi.fn(() => ({ remove: vi.fn() })) } }),
  getSupabaseStorage: () => ({ storage: { from: vi.fn(() => ({ remove: vi.fn() })) } }),
}));

vi.mock("./kimi/auth", () => ({
  authenticateRequest: vi.fn(() => Promise.reject(new Error("No auth"))),
  requireUser: vi.fn(() => (req: any, res: any, next: any) => next()),
  optionalUser: vi.fn(() => ({ input: vi.fn(() => ({ mutation: vi.fn() })) })),
}));

// Import after mocks
import { documentsRouter } from "./documents-router";
import { governanceFilesRouter } from "./governance-files-router";
import { governanceRouter } from "./governance-router";
import { smpRouter } from "./smp-router";

describe("Public Deletion Router Definitions", () => {
  it("documentsRouter.deleteFile is defined and uses publicQuery", () => {
    expect(documentsRouter).toBeDefined();
    expect(documentsRouter.deleteFile).toBeDefined();
  });

  it("governanceFilesRouter.delete is defined and uses publicQuery", () => {
    expect(governanceFilesRouter).toBeDefined();
    expect(governanceFilesRouter.delete).toBeDefined();
  });

  it("governanceRouter.deleteUpload is defined and uses publicQuery", () => {
    expect(governanceRouter).toBeDefined();
    expect(governanceRouter.deleteUpload).toBeDefined();
  });

  it("smpRouter.delete is defined and uses publicQuery", () => {
    expect(smpRouter).toBeDefined();
    expect(smpRouter.delete).toBeDefined();
  });
});

describe("Public Deletion Source Verification", () => {
  it("verifies all deletion endpoints are public in source code", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cwd = process.cwd();

    // Check documents-router deleteFile
    const docsSource = fs.readFileSync(
      path.join(cwd, "api/documents-router.ts"), "utf8"
    );
    const deleteFileMatch = docsSource.match(/deleteFile:\s*(\w+)/);
    expect(deleteFileMatch?.[1]).toBe("publicQuery");

    // Check governance-files-router delete
    const govFilesSource = fs.readFileSync(
      path.join(cwd, "api/governance-files-router.ts"), "utf8"
    );
    const govDeleteMatch = govFilesSource.match(/delete:\s*(\w+)/);
    expect(govDeleteMatch?.[1]).toBe("publicQuery");

    // Check governance-router deleteUpload
    const govSource = fs.readFileSync(
      path.join(cwd, "api/governance-router.ts"), "utf8"
    );
    const deleteUploadMatch = govSource.match(/deleteUpload:\s*(\w+)/);
    expect(deleteUploadMatch?.[1]).toBe("publicQuery");

    // Check smp-router delete
    const smpSource = fs.readFileSync(
      path.join(cwd, "api/smp-router.ts"), "utf8"
    );
    const smpDeleteMatch = smpSource.match(/delete:\s*(\w+)/);
    expect(smpDeleteMatch?.[1]).toBe("publicQuery");
  });
});

describe("Storage Router Public Deletion", () => {
  it("verifies storage delete endpoints do not use requireUser", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cwd = process.cwd();

    const storageSource = fs.readFileSync(
      path.join(cwd, "api/storage-router.ts"), "utf8"
    );

    // Extract the delete prepare endpoint section (lines 634-652 approximately)
    const prepareIndex = storageSource.indexOf('storageRouter.post("/files/delete/prepare"');
    expect(prepareIndex).toBeGreaterThan(-1);
    
    const confirmIndex = storageSource.indexOf('storageRouter.post("/files/delete/confirm"');
    expect(confirmIndex).toBeGreaterThan(-1);
    
    // Extract the section between prepare and confirm
    const prepareSection = storageSource.slice(prepareIndex, confirmIndex);
    expect(prepareSection).not.toContain("requireUser");
    expect(prepareSection).not.toContain("authenticateRequest");

    // Extract the confirm section (from confirm to end of file or next major section)
    const confirmSection = storageSource.slice(confirmIndex, confirmIndex + 2000);
    expect(confirmSection).not.toContain("requireUser");
    expect(confirmSection).not.toContain("authenticateRequest");
  });
});

describe("SmpDashboard Deletion Flow", () => {
  it("verifies SmpDashboard calls smp.delete directly without intermediate step", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cwd = process.cwd();

    const smpDashboardSource = fs.readFileSync(
      path.join(cwd, "src/pages/SmpDashboard.tsx"), "utf8"
    );

    // Find the delete handler in the modal
    const deleteModalIndex = smpDashboardSource.indexOf('modalMode === "delete"');
    expect(deleteModalIndex).toBeGreaterThan(-1);
    
    // Extract the onClick handler for the delete button
    const deleteSection = smpDashboardSource.slice(deleteModalIndex, deleteModalIndex + 800);
    
    // Should contain deleteMut.mutate
    expect(deleteSection).toContain("deleteMut.mutate");
    
    // Should NOT call deleteFileWithVerification in the onClick
    const onClickMatch = deleteSection.match(/onClick=\{([^}]+)\}/);
    if (onClickMatch) {
      expect(onClickMatch[1]).not.toContain("deleteFileWithVerification");
    }
  });

  it("verifies SmpDashboard no longer imports deleteFileWithVerification", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cwd = process.cwd();

    const smpDashboardSource = fs.readFileSync(
      path.join(cwd, "src/pages/SmpDashboard.tsx"), "utf8"
    );

    const importLine = smpDashboardSource.split('\n').find(l => 
      l.includes('@/lib/direct-storage-upload')
    );
    expect(importLine).toBeTruthy();
    expect(importLine).not.toContain("deleteFileWithVerification");
  });
});
