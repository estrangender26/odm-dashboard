import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock environment before any imports
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

// Create mock db before module imports
const mockDbExecute = vi.fn();
const mockDb = {
  execute: mockDbExecute,
  query: {},
  $client: {},
};

// Mock the connection module completely
vi.mock("./queries/connection", () => ({
  db: mockDb,
  getDb: () => mockDb,
}));

// Import storageRouter after mocking
const { storageRouter } = await import("./storage-router");

describe("POST /api/storage/uploads/authorize rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockReset();
  });

  it("database error returns HTTP 503 with generic message", async () => {
    const dbError = new Error("INSERT INTO upload_rate_limits VALUES(secret-client-id, ...) failed") as any;
    dbError.code = "42501";
    mockDbExecute.mockRejectedValue(dbError);
    
    const req = new Request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "om",
        originalFilename: "test.pdf",
        mimeType: "application/pdf",
        fileSize: 157286400,
        target: { folderId: "123" },
      }),
    });

    const response = await storageRouter.request(req);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "Upload authorization is temporarily unavailable." });
  });

  it("database error response does not contain sensitive data", async () => {
    const dbError = new Error("INSERT INTO upload_rate_limits VALUES(secret-client-id, ...) failed") as any;
    dbError.code = "42501";
    mockDbExecute.mockRejectedValue(dbError);
    
    const req = new Request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "om",
        originalFilename: "test.pdf",
        mimeType: "application/pdf",
        fileSize: 157286400,
        target: { folderId: "123" },
      }),
    });

    const response = await storageRouter.request(req);
    const responseText = await response.text();
    
    expect(responseText).not.toContain("secret-client-id");
    expect(responseText).not.toContain("INSERT INTO");
    expect(responseText).not.toContain("VALUES");
    expect(responseText).not.toContain("failed");
  });

  it("count limit returns HTTP 429", async () => {
    mockDbExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ intent_count: 100, total_bytes: 1000000 }]);
    
    const req = new Request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "om",
        originalFilename: "test.pdf",
        mimeType: "application/pdf",
        fileSize: 157286400,
        target: { folderId: "123" },
      }),
    });

    const response = await storageRouter.request(req);

    expect(response.status).toBe(429);
  });

  it("byte limit returns HTTP 429", async () => {
    mockDbExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ intent_count: 1, total_bytes: 5368709120 - 100 }]);
    
    const req = new Request("http://localhost/uploads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "om",
        originalFilename: "test.pdf",
        mimeType: "application/pdf",
        fileSize: 157286400,
        target: { folderId: "123" },
      }),
    });

    const response = await storageRouter.request(req);

    expect(response.status).toBe(429);
  });
});
