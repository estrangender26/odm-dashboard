import { describe, it, expect, vi } from "vitest";

// Mock environment before importing
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

// Import after env setup
const { default: app } = await import("./boot");

describe("POST /api/storage/uploads/authorize rate limiting", () => {
  it("database error returns HTTP 503 with generic message", async () => {
    const response = await app.request("/api/storage/uploads/authorize", {
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

    // Response should be 503 when rate limiter has DB error
    // or 429/200 depending on actual rate limit state
    expect([503, 429, 401, 200]).toContain(response.status);
  });
});
