import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  STORAGE_MODULES,
  STORAGE_BUCKET_BY_MODULE,
  type StorageFeatureFlags,
} from "@contracts/storage";
import { MAX_UPLOAD_FILE_SIZE_BYTES } from "@contracts/upload-limits";
import { getStorageFeatureFlags, isStorageUploadEnabled } from "./storage-feature-flags";
import { validateUploadDescriptor } from "./storage-validation";

// ----------------------------------------------------------------------------
// Router dependency mocks
// ----------------------------------------------------------------------------

const routerMocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  storageInfo: vi.fn(),
  storageRemove: vi.fn(),
  createSignedUrl: vi.fn(),
  getStoredFileRecord: vi.fn(),
  deleteStoredFileRecord: vi.fn(),
  intents: new Map<string, Record<string, unknown>>(),
  documentExists: true,
  versionExists: true,
  versionDocumentId: 1,
  updatedVersions: [] as Array<{ id: number; values: Record<string, unknown> }>,
}));

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-app-secret-for-signing-delete-payloads");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");
vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
vi.stubEnv("SUPABASE_STORAGE_URL", "https://test.storage.supabase.co");

vi.mock("./lib/env", () => ({
  env: {
    appId: "test-app",
    appSecret: "test-app-secret-for-signing-delete-payloads",
    supabaseUrl: "https://test.supabase.co",
    supabaseServiceRoleKey: "test-service-role-key",
    supabaseStorageUrl: "https://test.storage.supabase.co",
    kimiAuthUrl: "https://auth.example.test",
  },
}));

vi.mock("./kimi/auth", () => ({
  authenticateRequest: (...args: unknown[]) => routerMocks.authenticateRequest(...args),
}));

vi.mock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: routerMocks.createSignedUploadUrl,
        info: routerMocks.storageInfo,
        remove: routerMocks.storageRemove,
        createSignedUrl: routerMocks.createSignedUrl,
      }),
    },
  }),
  getSupabaseStorageConfig: () => ({
    url: "https://test.supabase.co",
    directStorageUrl: "https://test.storage.supabase.co",
  }),
}));

vi.mock("./storage-files", () => ({
  getStoredFileRecord: routerMocks.getStoredFileRecord,
  deleteStoredFileRecord: routerMocks.deleteStoredFileRecord,
}));

function mockDb() {
  routerMocks.intents.clear();
  routerMocks.updatedVersions = [];
  routerMocks.documentExists = true;
  routerMocks.versionExists = true;
  routerMocks.versionDocumentId = 1;

  return {
    select: vi.fn(() => ({
      from: vi.fn((table: { name?: string }) => ({
        where: vi.fn(() => ({
          limit: vi.fn((count: number) => {
            const name = (table as any)[Symbol.for("drizzle:Name")] ?? (table as any).name ?? "";
            if (name === "lihok_corporate_documents") {
              return routerMocks.documentExists ? [{ id: 1 }] : [];
            }
            if (name === "lihok_corporate_document_versions") {
              return routerMocks.versionExists
                ? [{ id: 2, documentId: routerMocks.versionDocumentId }]
                : [];
            }
            return [];
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        if (typeof values.id === "string") {
          routerMocks.intents.set(values.id, { ...values });
        }
        return {
          returning: vi.fn(() => Promise.resolve([{ id: values.id ?? "intent-id" }])),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => {
            if (values.fileName != null) {
              routerMocks.updatedVersions.push({ id: 2, values });
            }
            return Promise.resolve([{ id: 2 }]);
          }),
        })),
      })),
    })),
    query: {
      storageUploadIntents: {
        findFirst: vi.fn(() => {
          const values = Array.from(routerMocks.intents.values());
          return values.length ? values[values.length - 1] : null;
        }),
      },
    },
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((values: Record<string, unknown>) => ({
            where: vi.fn(() => ({
              returning: vi.fn(() => {
                if (values.fileName != null) {
                  routerMocks.updatedVersions.push({ id: 2, values });
                }
                return Promise.resolve([{ id: 2 }]);
              }),
            })),
          })),
        })),
      };
      return fn(tx);
    }),
  };
}

vi.mock("./queries/connection", async () => {
  const db = mockDb();
  return { db, getDb: () => db };
});

import { storageRouter } from "./storage-router";

// ----------------------------------------------------------------------------
// Static / direct tests
// ----------------------------------------------------------------------------

describe("lihok corporate storage module registration", () => {
  it("registers lihok-corporate as a storage module", () => {
    expect(STORAGE_MODULES).toContain("lihok-corporate");
  });

  it("maps lihok-corporate to the lihok-corporate-library bucket", () => {
    expect(STORAGE_BUCKET_BY_MODULE["lihok-corporate"]).toBe("lihok-corporate-library");
  });

  it("includes lihok_corporate_document_versions as a storage file source", () => {
    const source = readFileSync("./contracts/storage.ts", "utf8");
    expect(source).toContain('"lihok_corporate_document_versions"');
  });
});

describe("lihok corporate storage feature flag", () => {
  it("defaults lihokCorporate to false", () => {
    const flags = getStorageFeatureFlags({} as NodeJS.ProcessEnv);
    expect(flags.lihokCorporate).toBe(false);
  });

  it("reads SUPABASE_STORAGE_LIHOK_CORPORATE_ENABLED", () => {
    const flags = getStorageFeatureFlags({
      SUPABASE_STORAGE_UPLOADS_ENABLED: "true",
      SUPABASE_STORAGE_LIHOK_CORPORATE_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    expect(isStorageUploadEnabled("lihok-corporate", flags)).toBe(true);
  });

  it("requires both global and module flags to enable uploads", () => {
    const onlyGlobal = getStorageFeatureFlags({
      SUPABASE_STORAGE_UPLOADS_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    expect(isStorageUploadEnabled("lihok-corporate", onlyGlobal)).toBe(false);

    const onlyModule = getStorageFeatureFlags({
      SUPABASE_STORAGE_LIHOK_CORPORATE_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    expect(isStorageUploadEnabled("lihok-corporate", onlyModule)).toBe(false);
  });

  it("does not affect legacy module flags", () => {
    const flags = getStorageFeatureFlags({
      SUPABASE_STORAGE_UPLOADS_ENABLED: "true",
      SUPABASE_STORAGE_OM_ENABLED: "true",
      SUPABASE_STORAGE_GOVERNANCE_ENABLED: "true",
      SUPABASE_STORAGE_SMP_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    expect(flags.om).toBe(true);
    expect(flags.governance).toBe(true);
    expect(flags.smp).toBe(true);
    expect(flags.lihokCorporate).toBe(false);
    expect(isStorageUploadEnabled("om", flags)).toBe(true);
    expect(isStorageUploadEnabled("governance", flags)).toBe(true);
    expect(isStorageUploadEnabled("smp", flags)).toBe(true);
    expect(isStorageUploadEnabled("lihok-corporate", flags)).toBe(false);
  });
});

describe("lihok corporate storage validation", () => {
  it("reuses the office-document extension allowlist", () => {
    expect(() =>
      validateUploadDescriptor("lihok-corporate", "manual.pdf", "application/pdf")
    ).not.toThrow();
    expect(() =>
      validateUploadDescriptor("lihok-corporate", "sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    ).not.toThrow();
  });

  it("rejects disallowed extensions", () => {
    expect(() =>
      validateUploadDescriptor("lihok-corporate", "archive.rar", "application/vnd.rar")
    ).toThrow("extension");
  });

  it("rejects mismatched MIME types", () => {
    expect(() =>
      validateUploadDescriptor("lihok-corporate", "document.pdf", "text/plain")
    ).toThrow("MIME");
  });

  it("enforces the 150 MB upload size boundary", () => {
    expect(MAX_UPLOAD_FILE_SIZE_BYTES).toBe(157_286_400);
  });
});

// ----------------------------------------------------------------------------
// Router behavior tests
// ----------------------------------------------------------------------------

describe("lihok corporate storage router behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.authenticateRequest.mockRejectedValue(new Error("No auth"));
    routerMocks.createSignedUploadUrl.mockResolvedValue({
      data: { token: "signed-upload-token" },
      error: null,
    });
    routerMocks.storageInfo.mockResolvedValue({
      data: {
        id: "object-id",
        bucketId: "lihok-corporate-library",
        name: "",
        size: 1024,
        contentType: "application/pdf",
        etag: '"etag-123"',
      },
      error: null,
    });
    routerMocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example.test/file" },
      error: null,
    });
    routerMocks.storageRemove.mockResolvedValue({ data: {}, error: null });
    routerMocks.getStoredFileRecord.mockResolvedValue(null);
    routerMocks.deleteStoredFileRecord.mockResolvedValue({});
  });

  it("rejects anonymous authorize requests for lihok-corporate", async () => {
    routerMocks.authenticateRequest.mockRejectedValue(new Error("No auth"));

    const req = new Request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "lihok-corporate",
        originalFilename: "manual.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        target: { documentId: 1, versionId: 2 },
      }),
    });

    const res = await storageRouter.request(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("Authentication required");
  });

  it("rejects lihok-corporate uploads when the feature flag is disabled", async () => {
    routerMocks.authenticateRequest.mockResolvedValue({ id: 42 });

    const req = new Request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "lihok-corporate",
        originalFilename: "manual.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        target: { documentId: 1, versionId: 2 },
      }),
    });

    const res = await storageRouter.request(req);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { storageEnabled?: boolean; error?: string };
    expect(body.storageEnabled).toBe(false);
  });

  it("authorizes authenticated lihok-corporate uploads against existing document/version rows", async () => {
    vi.stubEnv("SUPABASE_STORAGE_UPLOADS_ENABLED", "true");
    vi.stubEnv("SUPABASE_STORAGE_LIHOK_CORPORATE_ENABLED", "true");
    routerMocks.authenticateRequest.mockResolvedValue({ id: 42 });

    const req = new Request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "lihok-corporate",
        originalFilename: "manual.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        target: { documentId: 1, versionId: 2 },
      }),
    });

    const res = await storageRouter.request(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      storageEnabled?: boolean;
      bucket?: string;
      path?: string;
      capabilityToken?: string;
    };
    expect(body.storageEnabled).toBe(true);
    expect(body.bucket).toBe("lihok-corporate-library");
    expect(body.path).toMatch(/^v1\/1\/2\/[0-9a-f-]+-manual\.pdf$/);
    expect(body.capabilityToken).toBeUndefined();
  });

  it("finalizes authenticated lihok-corporate uploads and updates version storage metadata", async () => {
    vi.stubEnv("SUPABASE_STORAGE_UPLOADS_ENABLED", "true");
    vi.stubEnv("SUPABASE_STORAGE_LIHOK_CORPORATE_ENABLED", "true");
    routerMocks.authenticateRequest.mockResolvedValue({ id: 42 });

    // Authorize
    const authorizeReq = new Request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "lihok-corporate",
        originalFilename: "manual.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        target: { documentId: 1, versionId: 2 },
      }),
    });
    const authorizeRes = await storageRouter.request(authorizeReq);
    const authorizeBody = (await authorizeRes.json()) as { intentId: string; path: string };
    expect(authorizeRes.status).toBe(200);

    // Configure storage info to match the generated path
    routerMocks.storageInfo.mockResolvedValue({
      data: {
        id: "object-id",
        bucketId: "lihok-corporate-library",
        name: authorizeBody.path,
        size: 1024,
        contentType: "application/pdf",
        etag: '"etag-123"',
      },
      error: null,
    });

    // Finalize
    const finalizeReq = new Request("http://localhost/uploads/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId: authorizeBody.intentId }),
    });
    const finalizeRes = await storageRouter.request(finalizeReq);
    expect(finalizeRes.status).toBe(200);
    const finalizeBody = (await finalizeRes.json()) as {
      success?: boolean;
      fileId?: number;
      source?: string;
    };
    expect(finalizeBody.success).toBe(true);
    expect(finalizeBody.source).toBe("lihok_corporate_document_versions");

    // Verify version row was updated with storage metadata
    expect(routerMocks.updatedVersions.length).toBe(1);
    const update = routerMocks.updatedVersions[0].values;
    expect(update.fileName).toBe("manual.pdf");
    expect(update.fileSize).toBe(1024);
    expect(update.mimeType).toBe("application/pdf");
    expect(update.storageProvider).toBe("supabase");
    expect(update.storageBucket).toBe("lihok-corporate-library");
    expect(update.storagePath).toBe(authorizeBody.path);
    expect(update.storageEtag).toBe('"etag-123"');
    expect(update.uploadedBy).toBe(42);
  });

  it("redirects downloads for lihok_corporate_document_versions", async () => {
    routerMocks.getStoredFileRecord.mockResolvedValue({
      id: 2,
      fileName: "manual.pdf",
      storageBucket: "lihok-corporate-library",
      storagePath: "v1/1/2/uuid-manual.pdf",
      legacyData: null,
    });

    const res = await storageRouter.request("http://localhost/files/lihok_corporate_document_versions/2/download");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://signed.example.test/file");
  });

  it("supports delete prepare/confirm for lihok_corporate_document_versions", async () => {
    routerMocks.getStoredFileRecord.mockResolvedValue({
      id: 2,
      fileName: "manual.pdf",
      storageBucket: "lihok-corporate-library",
      storagePath: "v1/1/2/uuid-manual.pdf",
      legacyData: null,
    });

    const prepareReq = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "lihok_corporate_document_versions", id: 2 }),
    });
    const prepareRes = await storageRouter.request(prepareReq);
    expect(prepareRes.status).toBe(200);
    const { confirmationToken } = (await prepareRes.json()) as { confirmationToken: string };
    expect(confirmationToken).toBeDefined();

    const confirmReq = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken }),
    });
    const confirmRes = await storageRouter.request(confirmReq);
    expect(confirmRes.status).toBe(200);
    const confirmBody = (await confirmRes.json()) as { success?: boolean; source?: string };
    expect(confirmBody.success).toBe(true);
    expect(confirmBody.source).toBe("lihok_corporate_document_versions");
    expect(routerMocks.deleteStoredFileRecord).toHaveBeenCalledWith("lihok_corporate_document_versions", 2);
  });
});

// ----------------------------------------------------------------------------
// Regression tests for legacy modules
// ----------------------------------------------------------------------------

describe("lihok corporate storage does not affect legacy modules", () => {
  it("keeps om bucket mapping unchanged", () => {
    expect(STORAGE_BUCKET_BY_MODULE.om).toBe("om-manuals");
  });

  it("keeps governance bucket mapping unchanged", () => {
    expect(STORAGE_BUCKET_BY_MODULE.governance).toBe("om-governance");
  });

  it("keeps smp bucket mapping unchanged", () => {
    expect(STORAGE_BUCKET_BY_MODULE.smp).toBe("smp-library");
  });

  it("keeps legacy module extension allowlists unchanged", () => {
    expect(() => validateUploadDescriptor("om", "manual.pdf", "application/pdf")).not.toThrow();
    expect(() => validateUploadDescriptor("governance", "evidence.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).not.toThrow();
    expect(() => validateUploadDescriptor("smp", "procedure.pdf", "application/pdf")).not.toThrow();
  });

  it("does not expose lihok-corporate in legacy direct upload helpers", () => {
    const source = readFileSync("./src/lib/direct-storage-upload.ts", "utf8");
    expect(source).toContain('"lihok-corporate": "lihokCorporate"');
    // The helper must still recognize legacy modules
    expect(source).toContain("om: \"om\"");
    expect(source).toContain("governance: \"governance\"");
    expect(source).toContain("smp: \"smp\"");
  });
});
