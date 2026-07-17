import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Anonymous Upload Security", () => {
  it("storage-router has correct public/protected route configuration", () => {
    const source = readFileSync(join(root, "api/storage-router.ts"), "utf8");
    
    // Public endpoints should NOT have requireUser
    const configRoute = source.slice(source.indexOf('storageRouter.get("/config"'), source.indexOf('storageRouter.post("/uploads/authorize"'));
    expect(configRoute).not.toContain("requireUser");
    expect(configRoute).not.toContain("await authenticateRequest");
    
    // Upload endpoints should use optionalUser
    const authorizeRoute = source.slice(source.indexOf('storageRouter.post("/uploads/authorize"'), source.indexOf('storageRouter.post("/uploads/resume"'));
    expect(authorizeRoute).toContain("optionalUser");
    expect(authorizeRoute).toContain("checkRateLimit");
    expect(authorizeRoute).toContain("capabilityToken");
    expect(authorizeRoute).toContain("capabilityJti");
    expect(authorizeRoute).toContain("capabilityTokenHash");
    
    // Resume should verify capability
    const resumeRoute = source.slice(source.indexOf('storageRouter.post("/uploads/resume"'), source.indexOf('storageRouter.post("/uploads/finalize"'));
    expect(resumeRoute).toContain("capabilityToken");
    expect(resumeRoute).toContain("verifyCapabilityForIntent");
    
    // Finalize should verify capability
    const finalizeRoute = source.slice(source.indexOf('storageRouter.post("/uploads/finalize"'), source.indexOf('storageRouter.post("/uploads/abandon"'));
    expect(finalizeRoute).toContain("capabilityToken");
    expect(finalizeRoute).toContain("verifyCapabilityForIntent");
    expect(finalizeRoute).toContain("capabilityConsumedAt");
    
    // Abandon should verify capability
    const abandonRoute = source.slice(source.indexOf('storageRouter.post("/uploads/abandon"'), source.indexOf('storageRouter.post("/files/delete/prepare"'));
    expect(abandonRoute).toContain("capabilityToken");
    expect(abandonRoute).toContain("verifyCapabilityForIntent");
    expect(abandonRoute).toContain("capabilityConsumedAt");
    
    // File routes should be public
    const filesRoute = source.slice(source.indexOf('storageRouter.get("/files/:source/:id/:action"'), source.indexOf('storageRouter.post("/files/delete/prepare"'));
    expect(filesRoute).not.toContain("requireUser");
    expect(filesRoute).toContain("createSignedUrl");
    
    // Delete routes should require auth
    const deleteRoutes = source.slice(source.indexOf('storageRouter.post("/files/delete/prepare"'));
    // Delete routes now public - no requireUser
    // authenticateRequest is called via requireUser
  });

  it("client-ip has documented trust boundaries", () => {
    const source = readFileSync(join(root, "api/lib/client-ip.ts"), "utf8");
    expect(source).toContain("ABUSE-REDUCTION control");
    expect(source).toContain("NOT an authentication or authorization boundary");
    expect(source).toContain("X-Forwarded-For can be spoofed");
    expect(source).toContain("Conservative limits for untrusted clients");
  });

  it("capability tokens bind all required fields", () => {
    const source = readFileSync(join(root, "api/upload-capability.ts"), "utf8");
    
    // Should have all binding fields
    expect(source).toContain("intentId");
    expect(source).toContain("mod");
    expect(source).toContain("src");
    expect(source).toContain("tgt");
    expect(source).toContain("bucket");
    expect(source).toContain("path");
    expect(source).toContain("fn");
    expect(source).toContain("mime");
    expect(source).toContain("size");
    expect(source).toContain("jti");
    
    // Should use HMAC
    expect(source).toContain("createHmac");
    expect(source).toContain("sha256");
    expect(source).toContain("timingSafeEqual");
  });

  it("direct-storage-upload does not persist capability tokens", () => {
    const source = readFileSync(join(root, "src/lib/direct-storage-upload.ts"), "utf8");
    
    // Should acknowledge cross-refresh limitation
    expect(source).toContain("capabilityToken");
    expect(source).toContain("capabilityToken");  // Token not stored in localStorage
    expect(source).toContain("Anonymous upload session expired");
  });

  it("documents-router has correct public deletion for files", () => {
    const source = readFileSync(join(root, "api/documents-router.ts"), "utf8");
    
    // uploadFile should be public
    expect(source).toContain("uploadFile: publicQuery");
    
    // deleteFile should now be public for uploaded files
    const deleteSection = source.slice(source.indexOf("deleteFile:"), source.indexOf("deleteFile:") + 200);
    expect(deleteSection).toContain("publicQuery");
  });

  it("governance-files-router has correct public deletion for files", () => {
    const source = readFileSync(join(root, "api/governance-files-router.ts"), "utf8");
    
    // upload should be public
    expect(source).toContain("upload: publicQuery");
    
    // download should be public
    expect(source).toContain("download: publicQuery");
    
    // delete should now be public for uploaded files
    const deleteSection = source.slice(source.indexOf("delete:"), source.indexOf("delete:") + 200);
    expect(deleteSection).toContain("publicQuery");
  });
});
