import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment before importing
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

const { checkRateLimitWithExecutor } = await import("./storage-router");

describe("rate limit 100 intents / 5 GB window", () => {
  const mockDb = {
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("accepts the 100th upload intent in a window", async () => {
    mockDb.execute.mockResolvedValue([{ intent_count: 100, total_bytes: 0 }]);

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 1024,
      db: mockDb,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    expect(result.allowed).toBe(true);
  });

  it("rejects the 101st upload intent in a window", async () => {
    mockDb.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ intent_count: 100, total_bytes: 0 }]);

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 1024,
      db: mockDb,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("Expected rejection");
    expect(result.limit).toBe("count");
    expect(result.isSystemError).toBe(false);
  });

  it("accepts cumulative bytes below 5 GB", async () => {
    mockDb.execute.mockResolvedValue([
      { intent_count: 1, total_bytes: 5 * 1024 * 1024 * 1024 - 1024 },
    ]);

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 1024,
      db: mockDb,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    expect(result.allowed).toBe(true);
  });

  it("rejects a request that would exceed 5 GB cumulative", async () => {
    mockDb.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { intent_count: 1, total_bytes: 5 * 1024 * 1024 * 1024 - 100 + 1 },
      ]);

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 100,
      db: mockDb,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("Expected rejection");
    expect(result.limit).toBe("bytes");
    expect(result.isSystemError).toBe(false);
  });

  it("enforces count limit under concurrent requests", async () => {
    let intentCount = 99;
    const db = {
      execute: vi.fn(async () => {
        if (intentCount < 100) {
          intentCount += 1;
          return [{ intent_count: intentCount, total_bytes: 0 }];
        }
        return [];
      }),
    };

    const requests = Array.from({ length: 5 }, () =>
      checkRateLimitWithExecutor({
        clientId: "concurrent-client",
        isTrusted: true,
        declaredBytes: 1024,
        db,
        now: new Date("2024-01-15T14:30:00Z"),
      })
    );

    const results = await Promise.all(requests);
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(1);
  });

  it("enforces byte limit under concurrent requests", async () => {
    const maxBytes = 5 * 1024 * 1024 * 1024;
    let totalBytes = maxBytes - 1024 * 1024 * 1024 - 1;
    const db = {
      execute: vi.fn(async () => {
        if (totalBytes + 1024 * 1024 * 1024 <= maxBytes) {
          totalBytes += 1024 * 1024 * 1024;
          return [{ intent_count: 1, total_bytes: totalBytes }];
        }
        return [];
      }),
    };

    const requests = Array.from({ length: 3 }, () =>
      checkRateLimitWithExecutor({
        clientId: "concurrent-bytes-client",
        isTrusted: true,
        declaredBytes: 1024 * 1024 * 1024,
        db,
        now: new Date("2024-01-15T14:30:00Z"),
      })
    );

    const results = await Promise.all(requests);
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(1);
  });
});
