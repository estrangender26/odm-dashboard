import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimitForTests } from "./rateLimit";

function makeReq(xff?: string) {
  return new Request("https://example.com/gantt/p/test", {
    headers: xff ? { "x-forwarded-for": xff } : {},
  });
}

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  it("allows requests under the limit for a known client", () => {
    const req = makeReq("203.0.113.42");
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(req, "createShared", 3, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit(req, "createShared", 3, 60_000).allowed).toBe(false);
  });

  it("does not share a global bucket for unknown callers", () => {
    // Without X-Forwarded-For each call gets its own per-request bucket.
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(makeReq(), "createShared", 3, 60_000).allowed).toBe(true);
    }
  });

  it("blocks requests over the limit and reports retry after", () => {
    const req = makeReq("203.0.113.42");
    for (let i = 0; i < 3; i++) checkRateLimit(req, "createShared", 3, 60_000);
    const blocked = checkRateLimit(req, "createShared", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
