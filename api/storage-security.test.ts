import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_FILE_SIZE_BYTES, isUploadFileSizeAllowed } from "@contracts/upload-limits";
import { TUS_CHUNK_SIZE_BYTES } from "@contracts/storage";
import { getFinalizedStorageSizeError } from "./storage-validation";

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

  it("accepts the exact Storage boundary and returns 413 above it", () => {
    expect(getFinalizedStorageSizeError(157_286_400, 157_286_400)).toBeNull();
    expect(getFinalizedStorageSizeError(157_286_401, 157_286_400)).toEqual({
      status: 413,
      error: "Maximum file size is 150 MB.",
    });
  });

  it("rejects anonymous upload authorization before any Storage call", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_ID", "test-app");
    vi.stubEnv("APP_SECRET", "test-secret");
    vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
    const { storageRouter } = await import("./storage-router");
    const response = await storageRouter.request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "om",
        originalFilename: "test.pdf",
        mimeType: "application/pdf",
        fileSize: 1,
        target: { folderId: 1 },
      }),
    });
    expect(response.status).toBe(401);
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
  });
});
