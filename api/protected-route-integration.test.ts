import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

// Mock environment
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");
vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

// Mock dependencies
vi.doMock("./queries/connection", () => ({
  getDb: vi.fn(() => ({
    execute: vi.fn(),
    query: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  })),
  ensureDbReady: vi.fn(() => Promise.resolve()),
}));

describe("Protected route integration", () => {
  it("actual protected route returns exactly HTTP 401 when unauthenticated", async () => {
    // Import boot after mocks
    const { default: bootApp } = await import("./boot");

    // Make an unauthenticated request to a protected route
    const response = await bootApp.request("/api/debug/uploads", {
      method: "GET",
    });

    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("Authentication required");
  });
});
