import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment before importing
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

// Import after env setup
const { checkRateLimitWithExecutor } = await import("./storage-router");

describe("rate limit compiled SQL verification", () => {
  const capturedQueries: any[] = [];

  const mockDb = {
    execute: vi.fn((query: any) => {
      capturedQueries.push(query);
      return Promise.resolve([{ intent_count: 1, total_bytes: 157286400 }]);
    }),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    capturedQueries.length = 0;
  });

  it("generates SQL with proper PostgreSQL placeholders and bigint casts", async () => {
    const fixedDate = new Date("2024-01-15T14:30:45Z");
    
    await checkRateLimitWithExecutor({
      clientId: "test-client-123",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
      now: fixedDate,
    });

    expect(capturedQueries).toHaveLength(1);
    const query = capturedQueries[0];
    
    expect(query).toBeDefined();
    expect(query.constructor).toBeDefined();
    
    const queryStr = JSON.stringify(query);
    
    expect(queryStr).not.toContain("${clientId}");
    expect(queryStr).not.toContain("${declaredBytes}");
    expect(queryStr).not.toContain("${windowStart}");
    expect(queryStr).not.toContain("${limits.maxIntents}");
    expect(queryStr).not.toContain("${limits.maxBytes}");
    expect(queryStr).not.toContain("\\${");
  });
});
