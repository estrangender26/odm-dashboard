import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// Mock environment before importing
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

// Import after env setup
const { checkRateLimitWithExecutor } = await import("./storage-router");

const dialect = new PgDialect();

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

  it("compiles SQL with PostgreSQL placeholders and bigint casts", async () => {
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
    expect(compiled.sql).toContain("\$1");
    expect(compiled.sql).toContain("\$2");
    expect(compiled.sql).toContain("\$3");
    
    // Verify bigint casts in correct positions
    expect(compiled.sql).toContain("\$3::bigint");
    expect(compiled.sql).toContain("\$4::bigint");
    expect(compiled.sql).toContain("\$6::bigint");
    expect(compiled.sql).toContain("\$7::bigint");
    
    // Verify params array contains expected values
    expect(compiled.params).toHaveLength(7);
    expect(compiled.params[0]).toBe("test-client-123");
    expect(compiled.params[1]).toBeInstanceOf(Date);
    expect(compiled.params[2]).toBe(157286400);
    expect(compiled.params[3]).toBe(157286400);
    expect(compiled.params[4]).toBe(10);
    expect(compiled.params[5]).toBe(157286400);
    expect(compiled.params[6]).toBe(5368709120);
    
    // Verify no literal template interpolations (TypeScript source code in compiled SQL)
    expect(compiled.sql).not.toContain("clientId");
    expect(compiled.sql).not.toContain("declaredBytes");
    expect(compiled.sql).not.toContain("windowStart");
    expect(compiled.sql).not.toContain("\${limits");
    
    // Verify no backslash-escaped interpolations
    expect(compiled.sql).not.toContain("\\\${");
  });
});
