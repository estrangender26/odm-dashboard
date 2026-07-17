import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_FILE_SIZE_BYTES, isUploadFileSizeAllowed } from "@contracts/upload-limits";
import { STORAGE_SIGNED_URL_TTL_SECONDS, TUS_CHUNK_SIZE_BYTES } from "@contracts/storage";
import { getFinalizedStorageSizeError, normalizeGovernanceMilestoneId, validateSupabaseStorageUrls, validateUploadDescriptor } from "./storage-validation";

const root = process.cwd();

describe("direct Storage security boundaries", () => {
  it("accepts exactly 150 MB and rejects 150 MB plus one byte", () => {
    expect(MAX_UPLOAD_FILE_SIZE_BYTES).toBe(157_286_400);
    expect(isUploadFileSizeAllowed(157_286_400)).toBe(true);
    expect(isUploadFileSizeAllowed(157_286_401)).toBe(false);
  });

  it("uses exactly 6 MB TUS chunks", () => {
    expect(TUS_CHUNK_SIZE_BYTES).toBe(6 * 1024 * 1024);
  });

  it("uses Supabase's signed TUS endpoint for authorize and resume", () => {
    const source = readFileSync(join(root, "api/storage-router.ts"), "utf8");
    expect(source).toContain('const SUPABASE_SIGNED_TUS_PATH = "/storage/v1/upload/resumable/sign"');
    expect(source.match(/SUPABASE_SIGNED_TUS_PATH/g)).toHaveLength(3);
    expect(source).not.toContain('directStorageUrl}/storage/v1/upload/resumable`');
  });

  it("keeps signed file URLs short-lived", () => {
    expect(STORAGE_SIGNED_URL_TTL_SECONDS).toBeGreaterThan(0);
    expect(STORAGE_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(5 * 60);
  });

  it("accepts the exact Storage boundary and returns 413 above it", () => {
    expect(getFinalizedStorageSizeError(157_286_400, 157_286_400)).toBeNull();
    expect(getFinalizedStorageSizeError(157_286_401, 157_286_400)).toEqual({
      status: 413,
      error: "Maximum file size is 150 MB.",
    });
  });

  it("validates module extensions, MIME types, and safe filenames", () => {
    expect(validateUploadDescriptor("om", "manual.pdf", "application/pdf")).toEqual({ extension: "pdf", mimeType: "application/pdf" });
    expect(validateUploadDescriptor("governance", "evidence.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toEqual({
      extension: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(() => validateUploadDescriptor("smp", "procedure.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toThrow("extension");
    expect(() => validateUploadDescriptor("smp", "procedure.pdf", "text/plain")).toThrow("MIME");
    expect(() => validateUploadDescriptor("om", "../manual.pdf", "application/pdf")).toThrow("filename");
  });

  it("preserves canonical Governance milestone IDs and rejects unknown contexts", () => {
    expect(normalizeGovernanceMilestoneId("M1")).toBe("M1");
    expect(normalizeGovernanceMilestoneId("M9")).toBe("M9");
    expect(normalizeGovernanceMilestoneId("__deliv")).toBe("__deliv");
    expect(normalizeGovernanceMilestoneId("__ref")).toBe("__ref");
    expect(() => normalizeGovernanceMilestoneId("m1")).toThrow("Invalid milestone");
    expect(() => normalizeGovernanceMilestoneId("M10")).toThrow("Invalid milestone");
  });

  it("accepts only matching HTTPS Supabase API and direct Storage hosts", () => {
    expect(validateSupabaseStorageUrls("https://project-ref.supabase.co", "https://project-ref.storage.supabase.co")).toEqual({
      url: "https://project-ref.supabase.co",
      directStorageUrl: "https://project-ref.storage.supabase.co",
    });
    expect(() => validateSupabaseStorageUrls("https://project-ref.supabase.co", "https://attacker.example.test")).toThrow("same Supabase project");
    expect(() => validateSupabaseStorageUrls("http://project-ref.supabase.co", "https://project-ref.storage.supabase.co")).toThrow("HTTPS");
  });

  it("allows anonymous config access (public endpoint)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_ID", "test-app");
    vi.stubEnv("APP_SECRET", "test-secret");
    vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
    const { storageRouter } = await import("./storage-router");
    const response = await storageRouter.request("http://localhost/config");
    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data.flags).toBeDefined();
  });

  it("allows anonymous access to public routes and requires auth for deletes", async () => {
    const { storageRouter } = await import("./storage-router");
    // Public routes (should NOT be 401)
    const publicRequests = [
      new Request("http://localhost/config"),
      new Request("http://localhost/files/doc_files/1/view"),
      new Request("http://localhost/files/doc_files/1/download"),
    ];
    for (const request of publicRequests) {
      const status = (await storageRouter.request(request)).status;
      expect(status).not.toBe(401);
    }
    
    // Protected delete routes (should be 401)
    const protectedRequests = [
      new Request("http://localhost/files/delete/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "doc_files", id: 1 }) }),
      new Request("http://localhost/files/delete/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationToken: "invalid" }) }),
    ];
    for (const request of protectedRequests) {
      expect((await storageRouter.request(request)).status).toBe(401);
    }
  });

  it("keeps Storage reads and deletes independent from upload rollback flags", () => {
    const source = readFileSync(join(root, "api/storage-router.ts"), "utf8");
    const fileRoutes = source.slice(source.indexOf('storageRouter.get("/files/'));
    expect(fileRoutes).toContain("createSignedUrl");
    expect(fileRoutes).toContain("deleteStoredFileRecord");
    expect(fileRoutes).not.toContain("isStorageUploadEnabled");
  });

  it("makes an SMP legacy replacement authoritative without deleting its old Storage object", () => {
    const source = readFileSync(join(root, "api/smp-router.ts"), "utf8");
    const updateRoute = source.slice(source.indexOf("/* ── 4. UPDATE ── */"), source.indexOf("/* ── 5. DELETE ── */"));
    expect(updateRoute).toContain("if (data.fileData !== undefined)");
    expect(updateRoute).toContain("clean.storagePath = null");
    expect(updateRoute).not.toContain("getSupabaseStorageAdmin");
  });

  it("supports both authenticated and anonymous resume with capability verification", () => {
    const source = readFileSync(join(root, "api/storage-router.ts"), "utf8");
    const resumeRoute = source.slice(source.indexOf('storageRouter.post("/uploads/resume"'), source.indexOf('storageRouter.post("/uploads/finalize"'));
    expect(resumeRoute).toContain("capabilityToken");
    expect(resumeRoute).toContain("verifyCapabilityForIntent");
    expect(resumeRoute).toContain("authenticateRequest"); // For authenticated path
  });

  it("binds delete confirmations to user, source, record, bucket, path, and expiry", () => {
    const source = readFileSync(join(root, "api/storage-router.ts"), "utf8");
    const deleteRoutes = source.slice(source.indexOf('storageRouter.post("/files/delete/prepare"'));
    for (const binding of ["source: input.source", "id: input.id", "userId: user.id", "bucket: record.storageBucket", "path: record.storagePath", "exp: expiresAt"]) {
      expect(deleteRoutes).toContain(binding);
    }
    expect(deleteRoutes).toContain("payload.userId !== user.id");
    expect(deleteRoutes).toContain("record.storageBucket !== payload.bucket");
    expect(deleteRoutes).toContain("record.storagePath !== payload.path");
  });

  it("prevents the legacy Governance REST delete route from bypassing Storage deletion", () => {
    const source = readFileSync(join(root, "api/boot.ts"), "utf8");
    const legacyDelete = source.slice(source.indexOf('app.delete("/api/governance/files/:id"'), source.indexOf('// GET /api/documents/files/:id/view'));
    expect(legacyDelete).toContain("SELECT storage_path FROM governance_uploads");
    expect(legacyDelete).toContain("SELECT storage_path FROM governance_files");
    expect(legacyDelete.match(/Storage-backed files require verified deletion\./g)).toHaveLength(2);
  });

  it("bounds mixed Governance ZIP input memory and keeps file data out of DOM attributes", () => {
    const source = readFileSync(join(root, "public/governance.html"), "utf8");
    expect(source).toContain("MAX_GOVERNANCE_ZIP_INPUT_BYTES");
    expect(source).toContain("readZipBlobWithinLimit");
    expect(source).not.toContain("dataset.fdata");
  });

  it("pins the standalone TUS client with Subresource Integrity", () => {
    const source = readFileSync(join(root, "public/governance.html"), "utf8");
    expect(source).toMatch(/tus-js-client@4\.3\.1[^>]+integrity="sha384-[A-Za-z0-9+/=]+"[^>]+crossorigin="anonymous"/);
  });

  it("does not reference the service-role variable from browser sources", () => {
    const browserFiles = [
      "src/lib/direct-storage-upload.ts",
      "src/pages/OmManualsLibrary.tsx",
      "src/pages/GovernanceDashboard.tsx",
      "src/pages/SmpDashboard.tsx",
      "public/governance-storage-upload.js",
      "public/governance.html",
    ];
    for (const file of browserFiles) {
      expect(readFileSync(join(root, file), "utf8")).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });

  it("keeps the migration additive", () => {
    const sql = readFileSync(join(root, "db/migrations/0011_supabase_storage_metadata.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).toContain("storage_upload_intents");
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql.match(/WHERE "storage_path" IS NOT NULL/g)).toHaveLength(4);
    for (const column of ["storage_provider", "storage_bucket", "storage_path", "storage_size", "storage_mime_type", "storage_etag", "storage_uploaded_at"]) {
      expect(sql).toContain(column);
    }
  });
});
