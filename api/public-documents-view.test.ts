import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment before importing
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

// Mock the database before importing the router
const mockDbExecute = vi.fn();
const mockDbQuery = vi.fn();
vi.doMock("./queries/connection", () => ({
  getDb: vi.fn(() => ({
    execute: mockDbExecute,
    query: mockDbQuery,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  })),
}));

// Import boot after mocking
const { default: app } = await import("./boot");

describe("Public document view and download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockReset();
    mockDbQuery.mockReset();
  });

  it("unauthenticated public PDF view succeeds", async () => {
    mockDbQuery.mockResolvedValue([{
      id: 1,
      file_name: "test.pdf",
      mime_type: "application/pdf",
      file_data: Buffer.from("fake-pdf-data").toString("base64"),
    }]);

    const response = await app.request("/api/documents/files/1/view", {
      method: "GET",
    });

    expect(response.status).not.toBe(401);
  });

  it("unauthenticated public download succeeds", async () => {
    mockDbQuery.mockResolvedValue([{
      id: 1,
      file_name: "test.pdf",
      mime_type: "application/pdf",
      file_data: Buffer.from("fake-pdf-data").toString("base64"),
    }]);

    const response = await app.request("/api/documents/files/1/download", {
      method: "GET",
    });

    expect(response.status).not.toBe(401);
  });

  it("missing file returns 404", async () => {
    mockDbQuery.mockResolvedValue([]);

    const response = await app.request("/api/documents/files/99999/view", {
      method: "GET",
    });

    expect(response.status).toBe(404);
  });
});
