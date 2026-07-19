import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { DocumentsViewDependencies } from "./documents-view-router";

// Mock environment before any imports
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");
vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

// Create mock functions that will be called by the routers
const mockCreateSignedUrl = vi.fn();
const mockSupabaseStorageFrom = vi.fn(() => ({
  createSignedUrl: mockCreateSignedUrl,
}));
const mockSupabaseStorage = {
  storage: {
    from: mockSupabaseStorageFrom,
  },
};

const mockGetStoredFileRecord = vi.fn();
const mockDeleteStoredFileRecord = vi.fn();

// Set up module mocks BEFORE any dynamic imports
vi.doMock("./storage-files", () => ({
  getStoredFileRecord: (...args: unknown[]) => mockGetStoredFileRecord(...args),
  deleteStoredFileRecord: (...args: unknown[]) => mockDeleteStoredFileRecord(...args),
}));

vi.doMock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: () => mockSupabaseStorage,
  getSupabaseStorageConfig: () => ({
    STORAGE_UPLOADS_ENABLED: true,
    STORAGE_SIGNED_URL_TTL_SECONDS: 300,
    buckets: { docFiles: "doc_files" },
  }),
}));

// Mock for documents router dependencies
const createMockDb = (storagePath: string | null = null) => {
  const limitFn = vi.fn(() => Promise.resolve(storagePath ? [{ storagePath }] : []));
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  return {
    execute: vi.fn(),
    query: vi.fn(),
    select: selectFn,
  };
};

describe("Storage file access full integration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreateSignedUrl.mockReset();
    mockGetStoredFileRecord.mockReset();
    
    // Reset modules to ensure fresh imports
    vi.resetModules();
  });

  it("storage-backed view follows redirect and returns signed URL", async () => {
    // Dynamic imports AFTER mocks are set up
    const { createDocumentsViewRouter } = await import("./documents-view-router");
    const { storageRouter } = await import("./storage-router");

    // Set up mocks for this test
    mockGetStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "doc_files",
      storagePath: "uploads/test.pdf",
      legacyData: null,
    });
    
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example.test/view" },
      error: null,
    });

    // Create the documents router with mocked dependencies
    const mockDb = createMockDb("uploads/test.pdf");
    
    const deps: DocumentsViewDependencies = {
      getDb: () => mockDb,
      getParsedDocumentFile: vi.fn(() => Promise.resolve(null)),
      parseRangeHeader: () => null,
      consoleError: vi.fn(),
    };

    const documentsRouter = createDocumentsViewRouter(deps);

    // Mount both routers
    const app = new Hono();
    app.route("/api/documents/files", documentsRouter);
    app.route("/api/storage", storageRouter);

    // Step 1: Request document view
    const firstResponse = await app.request("/api/documents/files/1/view", {
      method: "GET",
    });

    // Assert first response is exactly 302
    expect(firstResponse.status).toBe(302);
    
    // Read Location header
    const location = firstResponse.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toBe("/api/storage/files/doc_files/1/view");

    // Step 2: Make second unauthenticated request to the Location
    const secondResponse = await app.request(location!, {
      method: "GET",
    });

    // Assert second response is exactly 302 to signed URL
    expect(secondResponse.status).toBe(302);
    const signedLocation = secondResponse.headers.get("Location");
    expect(signedLocation).toBe("https://signed.example.test/view");

    // Assert mockCreateSignedUrl was called
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockGetStoredFileRecord).toHaveBeenCalled();
  });

  it("storage-backed download follows redirect with sanitized filename", async () => {
    const { createDocumentsViewRouter } = await import("./documents-view-router");
    const { storageRouter } = await import("./storage-router");

    // Set up mocks with a filename containing dangerous characters
    mockGetStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: 'test"evil.pdf',
      storageBucket: "doc_files",
      storagePath: "uploads/test.pdf",
      legacyData: null,
    });
    
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example.test/download" },
      error: null,
    });

    const mockDb = createMockDb("uploads/test.pdf");
    
    const deps: DocumentsViewDependencies = {
      getDb: () => mockDb,
      getParsedDocumentFile: vi.fn(() => Promise.resolve(null)),
      parseRangeHeader: () => null,
      consoleError: vi.fn(),
    };

    const documentsRouter = createDocumentsViewRouter(deps);

    const app = new Hono();
    app.route("/api/documents/files", documentsRouter);
    app.route("/api/storage", storageRouter);

    // Step 1: Request document download
    const firstResponse = await app.request("/api/documents/files/1/download", {
      method: "GET",
    });

    expect(firstResponse.status).toBe(302);
    const location = firstResponse.headers.get("Location");
    expect(location).toBe("/api/storage/files/doc_files/1/download");

    // Step 2: Request storage download
    const secondResponse = await app.request(location!, {
      method: "GET",
    });

    expect(secondResponse.status).toBe(302);
    expect(secondResponse.headers.get("Location")).toBe("https://signed.example.test/download");

    // Assert createSignedUrl was called with sanitized filename
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateSignedUrl.mock.calls[0];
    // Third argument should be options with sanitized download filename
    expect(callArgs[2]).toBeDefined();
    expect(callArgs[2].download).toBe("test_evil.pdf");
  });

  it("storage signing failure returns sanitized HTTP 500 without exposing secrets", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    
    const { createDocumentsViewRouter } = await import("./documents-view-router");
    const { storageRouter } = await import("./storage-router");

    // Set up file record
    mockGetStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "doc_files",
      storagePath: "uploads/test.pdf",
      legacyData: null,
    });
    
    // Create an error with sentinel values that should NOT appear in response
    const sentinelSecrets = [
      "service_role_abcdef123456",
      "SELECT * FROM pg_authid WHERE rolname = 'supabase_admin'",
      "/internal/secrets/config.json",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", // JWT header
      "postgresql://admin:secretpassword@localhost:5432/postgres",
    ];
    
    mockCreateSignedUrl.mockResolvedValue({
      data: null,
      error: { 
        message: `Error: ${sentinelSecrets.join(" ")}`,
      },
    });

    const mockDb = createMockDb("uploads/test.pdf");
    
    const deps: DocumentsViewDependencies = {
      getDb: () => mockDb,
      getParsedDocumentFile: vi.fn(() => Promise.resolve(null)),
      parseRangeHeader: () => null,
      consoleError: vi.fn(),
    };

    const documentsRouter = createDocumentsViewRouter(deps);

    const app = new Hono();
    app.route("/api/documents/files", documentsRouter);
    app.route("/api/storage", storageRouter);

    // Step 1: Get redirect to storage
    const firstResponse = await app.request("/api/documents/files/1/view", {
      method: "GET",
    });

    expect(firstResponse.status).toBe(302);
    const location = firstResponse.headers.get("Location");

    // Step 2: Request storage which will fail
    const secondResponse = await app.request(location!, {
      method: "GET",
    });

    // Assert exactly HTTP 500
    expect(secondResponse.status).toBe(500);
    
    // Assert exact JSON
    const body = await secondResponse.json() as { error: string };
    expect(body).toEqual({ error: "Unable to access file." });

    // Assert response excludes sentinel values
    const text = JSON.stringify(body);
    for (const sentinel of sentinelSecrets) {
      expect(text).not.toContain(sentinel);
    }

    // Assert console output excludes sentinel values
    const consoleCalls = consoleErrorSpy.mock.calls.flat();
    const consoleText = consoleCalls.join(" ");
    for (const sentinel of sentinelSecrets) {
      expect(consoleText).not.toContain(sentinel);
    }

    consoleErrorSpy.mockRestore();
  });
});
