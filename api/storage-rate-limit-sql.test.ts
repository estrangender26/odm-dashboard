import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

// Mock environment before importing
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

// Import after env setup
const { checkRateLimitWithExecutor } = await import("./storage-router");

const dialect = new PgDialect();

// Helper to create a fake postgres.js client that enforces wire-safe parameters
function createFakePostgresClient() {
  const capturedQueries: { queryText: string; params: any[] }[] = [];

  const fakeClient = {
    options: {
      parsers: {},
      serializers: {},
    },
    unsafe: vi.fn((queryText: string, params: any[] = []) => {
      // Capture the actual compiled query
      capturedQueries.push({ queryText, params });

      // Validate parameters - throw ERR_INVALID_ARG_TYPE for Date/objects
      for (const param of params) {
        if (param instanceof Date) {
          const error = new Error(
            "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received an instance of Date"
          );
          (error as any).code = "ERR_INVALID_ARG_TYPE";
          throw error;
        }
        if (typeof param === "object" && param !== null) {
          const error = new Error(
            "The first argument must be of type string or an instance of Buffer. Received an instance of Object"
          );
          (error as any).code = "ERR_INVALID_ARG_TYPE";
          throw error;
        }
        if (param === undefined) {
          const error = new Error("The first argument must be of type string. Received undefined");
          (error as any).code = "ERR_INVALID_ARG_TYPE";
          throw error;
        }
      }

      // Return successful rate-limit row
      return Promise.resolve([{ intent_count: 1, total_bytes: 157286400 }]);
    }),
    capturedQueries,
  };

  return fakeClient;
}

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

  it("compiles SQL with PostgreSQL placeholders and explicit casts", async () => {
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

    // Compile the SQL using Drizzle PostgreSQL dialect
    const compiled = dialect.sqlToQuery(query);

    // Verify SQL contains PostgreSQL placeholders
    expect(compiled.sql).toContain("$1");
    expect(compiled.sql).toContain("$2");
    expect(compiled.sql).toContain("$3");

    // Verify explicit PostgreSQL casts in correct positions
    expect(compiled.sql).toContain("::timestamptz");
    expect(compiled.sql).toContain("::bigint");
    expect(compiled.sql).toContain("::integer");

    // Verify params array contains expected values - all should be strings, no Date/objects
    expect(compiled.params).toHaveLength(7);
    expect(compiled.params[0]).toBe("test-client-123"); // clientId
    expect(compiled.params[1]).toBe("2024-01-15T14:00:00.000Z"); // windowStart as ISO string
    expect(compiled.params[2]).toBe("157286400"); // declaredBytes as decimal string
    expect(compiled.params[3]).toBe("157286400"); // declaredBytes as decimal string
    expect(compiled.params[4]).toBe("10"); // maxIntents as decimal string
    expect(compiled.params[5]).toBe("157286400"); // declaredBytes as decimal string
    expect(compiled.params[6]).toBe("5368709120"); // maxBytes as decimal string

    // Verify NO parameter is a Date, object, undefined, NaN, or unsafe number
    for (const param of compiled.params) {
      expect(typeof param).not.toBe("object"); // No Date, no objects
      expect(param).not.toBeUndefined();
      expect(param).not.toBeNaN();
      if (typeof param === "number") {
        expect(Number.isFinite(param)).toBe(true);
      }
    }

    // Verify no literal template interpolations (TypeScript source code in compiled SQL)
    expect(compiled.sql).not.toContain("clientId");
    expect(compiled.sql).not.toContain("declaredBytes");
    expect(compiled.sql).not.toContain("windowStart");
    expect(compiled.sql).not.toContain("\${limits");

    // Verify no backslash-escaped interpolations
    expect(compiled.sql).not.toContain("\\${");
  });

  it("uses ISO timestamp string with timestamptz cast", async () => {
    const fixedDate = new Date("2024-06-01T12:30:45.123Z");

    await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: false,
      declaredBytes: 104857600,
      db: mockDb,
      now: fixedDate,
    });

    const query = capturedQueries[0];
    const compiled = dialect.sqlToQuery(query);

    // Window hour should be 12:00:00 (minute/second zeroed)
    expect(compiled.params[1]).toBe("2024-06-01T12:00:00.000Z");
    expect(typeof compiled.params[1]).toBe("string");
    expect(compiled.sql).toContain("::timestamptz");
  });

  it("converts numeric parameters to decimal strings", async () => {
    await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
    });

    const query = capturedQueries[0];
    const compiled = dialect.sqlToQuery(query);

    // All numeric parameters should be decimal strings
    expect(compiled.params[2]).toBe("157286400");
    expect(compiled.params[3]).toBe("157286400");
    expect(compiled.params[4]).toBe("10"); // maxIntents for trusted
    expect(compiled.params[5]).toBe("157286400");
    expect(compiled.params[6]).toBe("5368709120"); // maxBytes for trusted

    // Verify types are strings, not numbers
    expect(typeof compiled.params[2]).toBe("string");
    expect(typeof compiled.params[3]).toBe("string");
    expect(typeof compiled.params[4]).toBe("string");
    expect(typeof compiled.params[5]).toBe("string");
    expect(typeof compiled.params[6]).toBe("string");
  });
});

describe("rate limit Drizzle postgres-js boundary test", () => {
  it("proves Date parameters cause wire-boundary error through Drizzle", async () => {
    const fakeClient = createFakePostgresClient();
    const drizzleDb = drizzle(fakeClient as any);

    // Execute a raw Drizzle SQL query with a Date object
    // This should fail because the fake client rejects Date parameters
    let capturedError: any;
    try {
      await drizzleDb.execute(sql`SELECT ${new Date("2024-01-15T14:00:00Z")}::timestamptz`);
    } catch (error) {
      capturedError = error;
    }

    // Assert that an error was thrown
    expect(capturedError).toBeDefined();
    // Assert the error code is ERR_INVALID_ARG_TYPE (check both error.code and error.cause.code)
    const errorCode = capturedError.code ?? capturedError.cause?.code;
    expect(errorCode).toBe("ERR_INVALID_ARG_TYPE");

    // Verify unsafe was called with a Date (which causes the rejection)
    expect(fakeClient.unsafe).toHaveBeenCalled();
    const callArgs = fakeClient.unsafe.mock.calls[0];
    const params = callArgs[1] || [];
    expect(params.some((p: any) => p instanceof Date)).toBe(true);
  });

  it("succeeds with wire-safe string parameters through Drizzle boundary", async () => {
    const fakeClient = createFakePostgresClient();
    const drizzleDb = drizzle(fakeClient as any);

    // Create executor that uses Drizzle
    const drizzleExecutor = {
      execute: (query: any) => drizzleDb.execute(query) as Promise<any[]>,
    };

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 157286400,
      db: drizzleExecutor,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    // Should succeed (allowed: true)
    expect(result.allowed).toBe(true);

    // Verify unsafe was called
    expect(fakeClient.unsafe).toHaveBeenCalled();

    // Verify actual params are wire-safe strings
    const callArgs = fakeClient.unsafe.mock.calls[0];
    const queryText = callArgs[0];
    const params = callArgs[1] || [];

    // Timestamp should be ISO string
    const timestampParam = params.find((p: any) =>
      typeof p === "string" && p.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    );
    expect(timestampParam).toBeDefined();
    expect(timestampParam).toBe("2024-01-15T14:00:00.000Z");

    // SQL should contain explicit casts
    expect(queryText).toContain("::timestamptz");
    expect(queryText).toContain("::bigint");
    expect(queryText).toContain("::integer");

    // No Date objects in params
    expect(params.some((p: any) => p instanceof Date)).toBe(false);
    expect(params.some((p: any) => typeof p === "object" && p !== null)).toBe(false);
  });
});

describe("rate limit parameter validation", () => {
  const mockDb = {
    execute: vi.fn(() => Promise.resolve([{ intent_count: 1, total_bytes: 157286400 }])),
  };

  it("rejects NaN declaredBytes", async () => {
    await expect(
      checkRateLimitWithExecutor({
        clientId: "client-123",
        isTrusted: true,
        declaredBytes: NaN,
        db: mockDb,
      })
    ).rejects.toThrow("Invalid declaredBytes: NaN not allowed");
  });

  it("rejects Infinity declaredBytes", async () => {
    await expect(
      checkRateLimitWithExecutor({
        clientId: "client-123",
        isTrusted: true,
        declaredBytes: Infinity,
        db: mockDb,
      })
    ).rejects.toThrow("Invalid declaredBytes: must be a finite number");
  });

  it("rejects negative Infinity declaredBytes", async () => {
    await expect(
      checkRateLimitWithExecutor({
        clientId: "client-123",
        isTrusted: true,
        declaredBytes: -Infinity,
        db: mockDb,
      })
    ).rejects.toThrow("Invalid declaredBytes: must be a finite number");
  });

  it("rejects fractional declaredBytes", async () => {
    await expect(
      checkRateLimitWithExecutor({
        clientId: "client-123",
        isTrusted: true,
        declaredBytes: 157286400.5,
        db: mockDb,
      })
    ).rejects.toThrow("Invalid declaredBytes: must be a safe integer");
  });

  it("rejects unsafe integer declaredBytes", async () => {
    // Number.MAX_SAFE_INTEGER + 1 is not a safe integer
    await expect(
      checkRateLimitWithExecutor({
        clientId: "client-123",
        isTrusted: true,
        declaredBytes: Number.MAX_SAFE_INTEGER + 1,
        db: mockDb,
      })
    ).rejects.toThrow("Invalid declaredBytes: must be a safe integer");
  });

  it("accepts valid declaredBytes", async () => {
    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
    });

    expect(result.allowed).toBe(true);
  });

  it("accepts zero declaredBytes", async () => {
    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 0,
      db: mockDb,
    });

    expect(result.allowed).toBe(true);
  });

  it("rejects negative declaredBytes below minimum", async () => {
    await expect(
      checkRateLimitWithExecutor({
        clientId: "client-123",
        isTrusted: true,
        declaredBytes: -1,
        db: mockDb,
      })
    ).rejects.toThrow("Invalid declaredBytes: below minimum 0");
  });
});

describe("rate limit driver boundary behavioral test", () => {
  it("verifies all SQL parameters are wire-safe strings, not Date/objects", async () => {
    const capturedParams: any[] = [];

    const mockDb = {
      execute: vi.fn((query: any) => {
        // Capture the actual compiled query parameters
        const compiled = dialect.sqlToQuery(query);
        capturedParams.push(...compiled.params);
        return Promise.resolve([{ intent_count: 1, total_bytes: 157286400 }]);
      }),
    };

    await checkRateLimitWithExecutor({
      clientId: "test-client",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDb,
      now: new Date("2024-01-15T14:30:45Z"),
    });

    // Verify NO parameter is a Date, object, undefined, NaN, or unsafe number
    for (const param of capturedParams) {
      // Should not be a Date
      expect(param).not.toBeInstanceOf(Date);
      // Should not be an object (except null which is typeof object)
      if (param !== null && typeof param === "object") {
        throw new Error(`Parameter should not be an object, got: ${JSON.stringify(param)}`);
      }
      // Should not be undefined
      expect(param).not.toBeUndefined();
      // Should not be NaN
      if (typeof param === "number") {
        expect(Number.isNaN(param)).toBe(false);
        expect(Number.isFinite(param)).toBe(true);
      }
    }

    // Specifically verify the timestamp is an ISO string
    const timestampParam = capturedParams.find((p) =>
      typeof p === "string" && p.includes("T") && p.includes(":")
    );
    expect(timestampParam).toBeDefined();
    expect(timestampParam).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("returns count limit HTTP 429 when intent_count exceeded", async () => {
    // Mock database that returns an existing row at the limit
    const mockDbAtLimit = {
      execute: vi.fn((query: any) => {
        // First call (INSERT) returns empty (conflict/over-limit)
        // Second call (SELECT) returns row at limit
        const callCount = mockDbAtLimit.execute.mock.calls.length;
        if (callCount === 1) {
          return Promise.resolve([]); // INSERT returned empty
        }
        return Promise.resolve([{ intent_count: 10, total_bytes: 0 }]);
      }),
    };

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDbAtLimit,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    expect(result.allowed).toBe(false);
    expect((result as any).limit).toBe("count");
    expect((result as any).isSystemError).toBe(false);
  });

  it("returns bytes limit HTTP 429 when total_bytes exceeded", async () => {
    // Mock database that returns an existing row near byte limit
    const mockDbAtByteLimit = {
      execute: vi.fn((query: any) => {
        const callCount = mockDbAtByteLimit.execute.mock.calls.length;
        if (callCount === 1) {
          return Promise.resolve([]); // INSERT returned empty
        }
        // Trusted limit is 5GB = 5368709120 bytes
        // Return 5.5GB already used - adding any bytes would exceed
        return Promise.resolve([{ intent_count: 1, total_bytes: 5905580032 }]);
      }),
    };

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 104857600, // Adding 100MB
      db: mockDbAtByteLimit,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    expect(result.allowed).toBe(false);
    expect((result as any).limit).toBe("bytes");
    expect((result as any).isSystemError).toBe(false);
  });

  it("returns system error HTTP 503 when database fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockDbFailing = {
      execute: vi.fn(() => {
        const error = new Error("connection refused");
        (error as any).code = "ECONNREFUSED";
        throw error;
      }),
    };

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDbFailing,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    expect(result.allowed).toBe(false);
    expect((result as any).limit).toBe("system");
    expect((result as any).isSystemError).toBe(true);

    // Verify sanitized logging
    expect(consoleSpy).toHaveBeenCalledWith("[RATE_LIMIT] Database upsert failed", expect.any(Object));
    const logArgs = consoleSpy.mock.calls[0];
    expect(logArgs[1]).not.toHaveProperty("sql");
    expect(logArgs[1]).not.toHaveProperty("params");
    expect(logArgs[1]).not.toHaveProperty("clientId");

    consoleSpy.mockRestore();
  });

  it("returns system error HTTP 503 when fallback SELECT fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockDbWithSelectFailure = {
      execute: vi.fn((query: any) => {
        const callCount = mockDbWithSelectFailure.execute.mock.calls.length;
        if (callCount === 1) {
          return Promise.resolve([]); // INSERT returned empty
        }
        // SELECT throws
        const error = new Error("read ECONNRESET");
        (error as any).code = "ECONNRESET";
        throw error;
      }),
    };

    const result = await checkRateLimitWithExecutor({
      clientId: "client-123",
      isTrusted: true,
      declaredBytes: 157286400,
      db: mockDbWithSelectFailure,
      now: new Date("2024-01-15T14:30:00Z"),
    });

    expect(result.allowed).toBe(false);
    expect((result as any).limit).toBe("system");
    expect((result as any).isSystemError).toBe(true);

    // Verify sanitized logging for SELECT failure
    expect(consoleSpy).toHaveBeenCalledWith("[RATE_LIMIT] Database select failed", expect.any(Object));

    consoleSpy.mockRestore();
  });
});
