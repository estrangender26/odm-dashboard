import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("rate limit bigint parameter handling", () => {
  const routerPath = join(process.cwd(), "api/storage-router.ts");
  const source = readFileSync(routerPath, "utf-8");
  
  it("has explicit ::bigint cast for declaredBytes in VALUES clause", () => {
    expect(source).toContain("${declaredBytes}::bigint)");
  });
  
  it("has explicit ::bigint cast for declaredBytes in total_bytes update", () => {
    expect(source).toContain("total_bytes + ${declaredBytes}::bigint");
  });
  
  it("has explicit ::bigint cast for declaredBytes in WHERE clause comparison", () => {
    expect(source).toContain("${declaredBytes}::bigint <= ${limits.maxBytes}::bigint");
  });
  
  it("has try-catch wrapper for database upsert", () => {
    const checkRateLimitFn = source.slice(
      source.indexOf("async function checkRateLimit"),
      source.indexOf("async function verifyCapabilityForIntent")
    );
    expect(checkRateLimitFn).toContain("try {");
    expect(checkRateLimitFn).toContain(" catch (dbError: any) {");
  });
  
  it("has sanitized error logging without SQL details", () => {
    const checkRateLimitFn = source.slice(
      source.indexOf("async function checkRateLimit"),
      source.indexOf("async function verifyCapabilityForIntent")
    );
    expect(checkRateLimitFn).toContain("[RATE_LIMIT] Database upsert failed");
  });
  
  it("fails closed when database upsert fails", () => {
    const checkRateLimitFn = source.slice(
      source.indexOf("async function checkRateLimit"),
      source.indexOf("async function verifyCapabilityForIntent")
    );
    expect(checkRateLimitFn).toContain('{ allowed: false, limit: "system" }');
  });
});
