import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment before importing the router
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

// Import after env setup
const { checkRateLimitWithExecutor } = await import("./storage-router");

type RateLimitDbExecutor = {
  execute: (query: any) => Promise<any[]>;
};

describe("checkRateLimitWithExecutor behavioral tests", () => {
  // Create a separately typed Vitest mock
  const mockExecute = vi.fn<(query: any) => Promise<any[]>>();
  const mockDb: RateLimitDbExecutor = { execute: mockExecute };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allows upload when database returns a row", async () => {
    mockExecute.mockResolvedValueOnce([{ intent_count: 1, total_bytes: 157286400 }]);

    const result = await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
    });

    expect(result.allowed).toBe(true);
  });

  it("returns count limit when intent_count exceeds max", async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ intent_count: 10, total_bytes: 1000000 }]);

    const result = await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
    });

    expect(result.allowed).toBe(false);
    // Narrow the union type before accessing limit
    if (result.allowed) {
      throw new Error("Expected rate limit rejection");
    }
    expect(result.limit).toBe("count");
    expect(result.isSystemError).toBe(false);
  });

  it("returns bytes limit when total_bytes would exceed max", async () => {
    // Trusted limit is 5GB (5368709120 bytes)
    // Existing: 5GB - 100MB + 1 = already near limit
    // Adding another 157MB would exceed
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ intent_count: 1, total_bytes: 5368709120 - 100000000 + 1 }]);

    const result = await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
    });

    expect(result.allowed).toBe(false);
    // Narrow the union type before accessing limit
    if (result.allowed) {
      throw new Error("Expected rate limit rejection");
    }
    expect(result.limit).toBe("bytes");
  });

  it("returns system error when database upsert fails", async () => {
    const dbError = new Error("Connection refused") as any;
    dbError.code = "ECONNREFUSED";
    mockExecute.mockRejectedValueOnce(dbError);

    const result = await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
    });

    expect(result.allowed).toBe(false);
    // Narrow the union type before accessing limit
    if (result.allowed) {
      throw new Error("Expected rate limit rejection");
    }
    expect(result.limit).toBe("system");
    expect(result.isSystemError).toBe(true);
  });

  it("returns system error when follow-up SELECT fails", async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("SELECT failed"));

    const result = await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
    });

    expect(result.allowed).toBe(false);
    // Narrow the union type before accessing limit
    if (result.allowed) {
      throw new Error("Expected rate limit rejection");
    }
    expect(result.limit).toBe("system");
    expect(result.isSystemError).toBe(true);
  });

  it("uses untrusted limits when isTrusted is false", async () => {
    mockExecute.mockResolvedValueOnce([{ intent_count: 1, total_bytes: 100 }]);

    const result = await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: false,
      declaredBytes: 100,
      db: mockDb,
    });

    expect(result.allowed).toBe(true);
  });
});
