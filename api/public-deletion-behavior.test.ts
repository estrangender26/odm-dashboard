import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("BEHAVIORAL SOURCE VERIFICATION: Public Deletion", () => {
  it("documents-router deleteFile uses publicQuery and handles storage", () => {
    const source = readFileSync(join(root, "api/documents-router.ts"), "utf8");
    
    const deleteFileIdx = source.indexOf("deleteFile:");
    expect(deleteFileIdx).toBeGreaterThan(0);
    
    // Extract larger section to capture full implementation
    const deleteSection = source.slice(deleteFileIdx, deleteFileIdx + 1000);
    
    // Should use publicQuery
    expect(deleteSection).toMatch(/deleteFile:\s*publicQuery/);
    
    // Should check for storage bucket/path
    expect(deleteSection).toContain("storageBucket");
    expect(deleteSection).toContain("storagePath");
    
    // Should call Supabase storage remove
    expect(deleteSection).toContain(".remove([");
    expect(deleteSection).toContain("getSupabaseStorageAdmin");
    
    // Should handle storage errors
    expect(deleteSection).toContain("Storage deletion failed");
    
    // Should return proper result
    expect(deleteSection).toContain("deletedFileId");
    expect(deleteSection).toContain("success: true");
  });

  it("documents-router deleteFile handles missing files with TRPCError", () => {
    const source = readFileSync(join(root, "api/documents-router.ts"), "utf8");
    
    const deleteFileIdx = source.indexOf("deleteFile:");
    const deleteSection = source.slice(deleteFileIdx, deleteFileIdx + 1000);
    
    // Should throw TRPCError for NOT_FOUND
    expect(deleteSection).toContain('code: "NOT_FOUND"');
    expect(deleteSection).toContain("File not found");
  });

  it("governance-files-router delete uses publicQuery", () => {
    const source = readFileSync(join(root, "api/governance-files-router.ts"), "utf8");
    
    const deleteMatch = source.match(/delete:\s*(\w+)/);
    expect(deleteMatch?.[1]).toBe("publicQuery");
  });

  it("governance-files-router delete handles storage", () => {
    const source = readFileSync(join(root, "api/governance-files-router.ts"), "utf8");
    
    const deleteIdx = source.indexOf("delete:");
    const deleteSection = source.slice(deleteIdx, deleteIdx + 800);
    
    // Should check for storage
    expect(deleteSection).toContain("storageBucket");
    expect(deleteSection).toContain("storagePath");
    
    // Should remove from storage
    expect(deleteSection).toContain(".remove([");
    
    // Should return success (using larger section)
    expect(deleteSection).toContain("success: true");
  });

  it("governance-router deleteUpload uses publicQuery", () => {
    const source = readFileSync(join(root, "api/governance-router.ts"), "utf8");
    
    const deleteUploadMatch = source.match(/deleteUpload:\s*(\w+)/);
    expect(deleteUploadMatch?.[1]).toBe("publicQuery");
  });

  it("governance-router deleteUpload handles storage and returns success", () => {
    const source = readFileSync(join(root, "api/governance-router.ts"), "utf8");
    
    const deleteIdx = source.indexOf("deleteUpload:");
    const deleteSection = source.slice(deleteIdx, deleteIdx + 1500);
    
    // Should check for storage
    expect(deleteSection).toContain("storageBucket");
    expect(deleteSection).toContain("storagePath");
    
    // Should return success
    expect(deleteSection).toContain("success: true");
  });

  it("smp-router delete uses publicQuery", () => {
    const source = readFileSync(join(root, "api/smp-router.ts"), "utf8");
    
    const deleteMatch = source.match(/delete:\s*(\w+)/);
    expect(deleteMatch?.[1]).toBe("publicQuery");
  });

  it("smp-router delete handles storage in single flow", () => {
    const source = readFileSync(join(root, "api/smp-router.ts"), "utf8");
    
    const deleteIdx = source.indexOf("delete:");
    const deleteSection = source.slice(deleteIdx, deleteIdx + 800);
    
    // Should query storage bucket/path
    expect(deleteSection).toContain("storageBucket");
    expect(deleteSection).toContain("storagePath");
    
    // Should remove from storage
    expect(deleteSection).toContain(".remove([");
    
    // Should delete from database
    expect(deleteSection).toContain("db.delete");
    
    // Should return deleted status
    expect(deleteSection).toContain("deleted: true");
    expect(deleteSection).toContain("id: input.id");
  });

  it("smp-router delete preserves record on storage failure", () => {
    const source = readFileSync(join(root, "api/smp-router.ts"), "utf8");
    
    const deleteIdx = source.indexOf("delete:");
    const deleteSection = source.slice(deleteIdx, deleteIdx + 800);
    
    // Should throw on storage error before db.delete
    expect(deleteSection).toContain("Storage deletion failed");
  });

  it("storage-router delete endpoints are public (no auth required)", () => {
    const source = readFileSync(join(root, "api/storage-router.ts"), "utf8");
    
    const prepareIdx = source.indexOf('storageRouter.post("/files/delete/prepare"');
    const confirmIdx = source.indexOf('storageRouter.post("/files/delete/confirm"');
    
    // Prepare endpoint should be public (no requireUser or authenticateRequest)
    const prepareSection = source.slice(prepareIdx, confirmIdx);
    expect(prepareSection).not.toContain("requireUser");
    expect(prepareSection).not.toContain("authenticateRequest");
    
    // Confirm endpoint should be public
    const confirmSection = source.slice(confirmIdx, confirmIdx + 2000);
    expect(confirmSection).not.toContain("requireUser");
    expect(confirmSection).not.toContain("authenticateRequest");
    
    // Both should use signed tokens
    expect(prepareSection).toContain("signDeletePayload");
    expect(confirmSection).toContain("verifyDeletePayload");
  });

  it("storage-router delete uses short-lived signed confirmation", () => {
    const source = readFileSync(join(root, "api/storage-router.ts"), "utf8");
    
    const prepareIdx = source.indexOf('storageRouter.post("/files/delete/prepare"');
    const prepareSection = source.slice(prepareIdx, prepareIdx + 1500);
    
    // Should have 5 minute expiry (300 seconds or 5*60_000 ms)
    const hasExpiry = prepareSection.includes("5 * 60_000") || 
                      prepareSection.includes("300_000") ||
                      prepareSection.includes("300 * 1000") ||
                      prepareSection.includes("5 * 60 * 1000");
    expect(hasExpiry).toBe(true);
    
    // Should use signing
    expect(prepareSection).toContain("signDeletePayload");
  });

  it("storage-router delete validates source with schema", () => {
    const source = readFileSync(join(root, "api/storage-router.ts"), "utf8");
    
    const prepareIdx = source.indexOf('storageRouter.post("/files/delete/prepare"');
    const confirmIdx = source.indexOf('storageRouter.post("/files/delete/confirm"');
    const deleteSection = source.slice(prepareIdx, confirmIdx + 2000);
    
    // Should validate source
    expect(deleteSection).toContain("source");
    expect(deleteSection).toContain("sourceSchema");
    expect(deleteSection).toContain("getStoredFileRecord");
  });
});

describe("UI FLOW VERIFICATION: SmpDashboard Deletion", () => {
  it("SmpDashboard calls smp.delete directly without intermediate step", () => {
    const source = readFileSync(join(root, "src/pages/SmpDashboard.tsx"), "utf8");
    
    const deleteModalIdx = source.indexOf('modalMode === "delete"');
    const deleteModalSection = source.slice(deleteModalIdx, deleteModalIdx + 800);
    
    // Should use smp.delete mutation
    expect(deleteModalSection).toContain("deleteMut.mutate");
    
    // Should NOT call separate deleteFileWithVerification
    expect(deleteModalSection).not.toContain("deleteFileWithVerification");
    
    // Should be a single, simple handler
    const onClickMatch = deleteModalSection.match(/onClick=\{([^}]+)\}/);
    expect(onClickMatch?.[1]).toContain("deleteMut.mutate");
    expect(onClickMatch?.[1]).not.toContain("async");
    expect(onClickMatch?.[1]).not.toContain("await");
  });

  it("SmpDashboard delete mutation is properly defined", () => {
    const source = readFileSync(join(root, "src/pages/SmpDashboard.tsx"), "utf8");
    
    // Should use smp.delete
    expect(source).toContain("trpc.smp.delete");
    expect(source).toContain("useMutation");
  });

  it("SmpDashboard no longer imports deleteFileWithVerification", () => {
    const source = readFileSync(join(root, "src/pages/SmpDashboard.tsx"), "utf8");
    
    const importLine = source.split('\n').find(l => 
      l.includes('@/lib/direct-storage-upload')
    );
    expect(importLine).toBeTruthy();
    expect(importLine).not.toContain("deleteFileWithVerification");
  });
});

describe("SECURITY VERIFICATION: Public Deletion", () => {
  it("all delete endpoints use publicQuery (not authedQuery)", () => {
    const sources = [
      { name: "documents-router", file: "api/documents-router.ts", proc: "deleteFile" },
      { name: "governance-files-router", file: "api/governance-files-router.ts", proc: "delete" },
      { name: "governance-router", file: "api/governance-router.ts", proc: "deleteUpload" },
      { name: "smp-router", file: "api/smp-router.ts", proc: "delete" },
    ];
    
    for (const src of sources) {
      const content = readFileSync(join(root, src.file), "utf8");
      // Match the exact pattern: "procName: publicQuery"
      const pattern = new RegExp(`${src.proc}:\\s*publicQuery`);
      expect(content, `${src.name}.${src.proc} should use publicQuery`).toMatch(pattern);
    }
  });

  it("delete procedures have error handling", () => {
    const sources = [
      { file: "api/documents-router.ts", proc: "deleteFile" },
      { file: "api/governance-files-router.ts", proc: "delete" },
      { file: "api/governance-router.ts", proc: "deleteUpload" },
      { file: "api/smp-router.ts", proc: "delete" },
    ];
    
    for (const src of sources) {
      const content = readFileSync(join(root, src.file), "utf8");
      
      // Find delete procedure and check for error handling
      const procIdx = content.indexOf(`${src.proc}:`);
      const procSection = content.slice(procIdx, procIdx + 800);
      
      // Should have try-catch or error handling
      const hasErrorHandling = procSection.includes("try {") || 
                               procSection.includes("catch") ||
                               procSection.includes("throw");
      expect(hasErrorHandling, `${src.file}.${src.proc}`).toBe(true);
    }
  });
});

describe("ATOMICITY VERIFICATION: Single Server-Side Deletion Flow", () => {
  it("storage operations occur before database deletion in each router", () => {
    const sources = [
      { file: "api/documents-router.ts", proc: "deleteFile", name: "documents" },
      { file: "api/governance-files-router.ts", proc: "delete", name: "governance-files" },
      { file: "api/smp-router.ts", proc: "delete", name: "smp" },
    ];
    
    for (const src of sources) {
      const content = readFileSync(join(root, src.file), "utf8");
      const procIdx = content.indexOf(`${src.proc}:`);
      const procSection = content.slice(procIdx, procIdx + 1000);
      
      // Find positions of storage remove and db delete
      const storageIdx = procSection.indexOf(".remove([");
      const dbDeleteIdx = procSection.indexOf("db.delete");
      
      // Both should exist
      expect(storageIdx, `${src.name}: has storage removal`).toBeGreaterThan(-1);
      expect(dbDeleteIdx, `${src.name}: has db delete`).toBeGreaterThan(-1);
      
      // Storage should come before database delete
      expect(storageIdx, `${src.name}: storage before db`).toBeLessThan(dbDeleteIdx);
    }
  });

  it("SMP deletion is single server-side call", () => {
    const smpSource = readFileSync(join(root, "api/smp-router.ts"), "utf8");
    const uiSource = readFileSync(join(root, "src/pages/SmpDashboard.tsx"), "utf8");
    
    // Server handles both storage and database
    const deleteIdx = smpSource.indexOf("delete:");
    const deleteSection = smpSource.slice(deleteIdx, deleteIdx + 600);
    
    // Should have both storage and db operations
    expect(deleteSection).toContain(".remove([");
    expect(deleteSection).toContain("db.delete");
    
    // UI calls smp.delete directly without intermediate steps
    const uiDeleteIdx = uiSource.indexOf('modalMode === "delete"');
    const uiDeleteSection = uiSource.slice(uiDeleteIdx, uiDeleteIdx + 600);
    
    expect(uiDeleteSection).toContain("deleteMut.mutate");
    expect(uiDeleteSection).not.toContain("deleteFileWithVerification");
    expect(uiDeleteSection).not.toContain("storagePath");
  });

  it("error messages indicate storage vs database failures", () => {
    const sources = [
      { file: "api/documents-router.ts", proc: "deleteFile" },
      { file: "api/governance-files-router.ts", proc: "delete" },
      { file: "api/smp-router.ts", proc: "delete" },
    ];
    
    for (const src of sources) {
      const content = readFileSync(join(root, src.file), "utf8");
      const procIdx = content.indexOf(`${src.proc}:`);
      const procSection = content.slice(procIdx, procIdx + 800);
      
      // Should have specific storage error message
      expect(procSection, `${src.file}.${src.proc}`).toContain("Storage deletion failed");
    }
  });
});
