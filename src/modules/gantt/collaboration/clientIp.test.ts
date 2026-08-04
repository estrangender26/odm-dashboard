import { describe, it, expect } from "vitest";
import { getClientIp } from "./clientIp";

function req(headers: Record<string, string>): Request {
  return new Request("https://example.com/gantt/p/test", { headers });
}

describe("getClientIp", () => {
  it("returns the leftmost X-Forwarded-For value by default", () => {
    const ip = getClientIp(req({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" }));
    expect(ip).toBe("203.0.113.42");
  });

  it("returns null when no trusted header exists", () => {
    expect(getClientIp(req({}))).toBeNull();
  });

  it("skips trusted proxies when TRUSTED_PROXY_CIDRS is set", () => {
    const original = process.env.TRUSTED_PROXY_CIDRS;
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    try {
      const ip = getClientIp(req({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" }));
      expect(ip).toBe("203.0.113.42");
    } finally {
      process.env.TRUSTED_PROXY_CIDRS = original;
    }
  });

  it("returns the first untrusted IP from the right with multiple hops", () => {
    const original = process.env.TRUSTED_PROXY_CIDRS;
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8,192.168.0.0/16";
    try {
      const ip = getClientIp(req({ "x-forwarded-for": "203.0.113.42, 192.168.1.1, 10.0.0.1" }));
      expect(ip).toBe("203.0.113.42");
    } finally {
      process.env.TRUSTED_PROXY_CIDRS = original;
    }
  });
});
