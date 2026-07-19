/**
 * SQL Syntax and Sanitization Tests
 *
 * Tests for proper SQL syntax and log redaction.
 */

import { describe, it, expect } from "vitest";

describe("SQL Syntax Fixes", () => {
  it("uses substr() not substring(from...for) for chunk queries", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync("scripts/legacy-storage-migrator.ts", "utf-8");
    
    // Should use substr() function
    expect(content).toContain("substr(");
    
    // Should NOT use the problematic substring(from...for) syntax
    expect(content).not.toContain("substring(");
  });

  it("fetchBase64Chunk uses bounded chunk reads", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync("scripts/legacy-storage-migrator.ts", "utf-8");
    
    // Should use BASE64_CHUNK_SIZE constant
    expect(content).toContain("BASE64_CHUNK_SIZE");
    
    // Should loop with chunk size, not fetch full payload
    expect(content).toContain("sqlOffset += BASE64_CHUNK_SIZE");
  });
});

describe("sanitizeError Redaction", () => {
  it("redacts database URLs", async () => {
    const { sanitizeError } = await import("../../scripts/lib/legacy-storage-migrator-core");
    const error = "Connection failed: postgres://user:pass@host.com:5432/dbname";
    const sanitized = sanitizeError(error);
    expect(sanitized).toContain("[REDACTED_DB_URL]");
    expect(sanitized).not.toContain("postgres://");
    expect(sanitized).not.toContain("user:pass");
  });

  it("redacts DATABASE_URL environment variable", async () => {
    const { sanitizeError } = await import("../../scripts/lib/legacy-storage-migrator-core");
    const error = "DATABASE_URL=postgres://user:pass@host:5432/db";
    const sanitized = sanitizeError(error);
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("postgres://");
  });

  it("redacts connection fingerprints", async () => {
    const { sanitizeError } = await import("../../scripts/lib/legacy-storage-migrator-core");
    const error = "Connected to db.example.com:5432/productiondb";
    const sanitized = sanitizeError(error);
    expect(sanitized).toContain("[REDACTED_HOST:PORT/DB]");
    expect(sanitized).not.toContain("db.example.com:5432");
  });

  it("redacts SQL parameters", async () => {
    const { sanitizeError } = await import("../../scripts/lib/legacy-storage-migrator-core");
    const error = "Query failed: SELECT * FROM table WHERE id = $1 AND name = $2";
    const sanitized = sanitizeError(error);
    expect(sanitized).toContain("[PARAM]");
    expect(sanitized).not.toContain("$1");
    expect(sanitized).not.toContain("$2");
  });

  it("redacts username and password fields", async () => {
    const { sanitizeError } = await import("../../scripts/lib/legacy-storage-migrator-core");
    const error = "config: username=admin password=secret123";
    const sanitized = sanitizeError(error);
    expect(sanitized).toContain("username=[REDACTED]");
    expect(sanitized).toContain("password=[REDACTED]");
    expect(sanitized).not.toContain("admin");
    expect(sanitized).not.toContain("secret123");
  });

  it("redacts port fields", async () => {
    const { sanitizeError } = await import("../../scripts/lib/legacy-storage-migrator-core");
    const error = "config: port=5432";
    const sanitized = sanitizeError(error);
    expect(sanitized).toContain("port=[REDACTED]");
    expect(sanitized).not.toContain("port=5432");
  });

  it("preserves non-sensitive error context", async () => {
    const { sanitizeError } = await import("../../scripts/lib/legacy-storage-migrator-core");
    const error = "Failed to process record 123: validation error";
    const sanitized = sanitizeError(error);
    expect(sanitized).toContain("record 123");
    expect(sanitized).toContain("validation error");
  });
});

describe("Dry-Run No Side Effects", () => {
  it("dry-run does not create ledger entries", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync("scripts/legacy-storage-migrator.ts", "utf-8");
    
    // Should check execute flag before writes
    expect(content).toContain("if (!ctx.execute)");
    expect(content).toContain("if (ctx.execute)");
  });

  it("transactional operations check execute flag", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync("scripts/legacy-storage-migrator.ts", "utf-8");
    
    // transactionalMetadataCommit should return early in dry-run
    expect(content).toContain("if (!ctx.execute) return { success: true }");
  });
});
