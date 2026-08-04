import { describe, it, expect } from "vitest";
import { checkRateLimit } from "./rateLimit";

function makeReq() {
  return new Request("https://example.com/gantt/p/test");
}

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const req = makeReq();
    for (let i = 0; i < 3; i++) {
      const result = checkRateLimit(req, "createShared", 3, 60_000);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests over the limit", () => {
    const req = makeReq();
    for (let i = 0; i < 3; i++) checkRateLimit(req, "createShared", 3, 60_000);
    const blocked = checkRateLimit(req, "createShared", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
