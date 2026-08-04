import { describe, it, expect } from "vitest";
import { getClientIp, ipToUint32, parseCidr } from "./clientIp";

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

  it("supports non-octet-aligned prefixes such as /20", () => {
    const original = process.env.TRUSTED_PROXY_CIDRS;
    process.env.TRUSTED_PROXY_CIDRS = "10.16.0.0/20";
    try {
      // 10.16.15.255 is inside 10.16.0.0/20; 10.16.16.1 is outside.
      const inside = getClientIp(req({ "x-forwarded-for": "203.0.113.42, 10.16.15.255" }));
      expect(inside).toBe("203.0.113.42");

      const outside = getClientIp(req({ "x-forwarded-for": "203.0.113.42, 10.16.16.1" }));
      expect(outside).toBe("10.16.16.1");
    } finally {
      process.env.TRUSTED_PROXY_CIDRS = original;
    }
  });

  it("falls back to leftmost when all IPs are inside trusted ranges", () => {
    const original = process.env.TRUSTED_PROXY_CIDRS;
    process.env.TRUSTED_PROXY_CIDRS = "0.0.0.0/0";
    try {
      const ip = getClientIp(req({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" }));
      expect(ip).toBe("203.0.113.42");
    } finally {
      process.env.TRUSTED_PROXY_CIDRS = original;
    }
  });

  it("ignores invalid CIDRs and uses valid ones to find client", () => {
    const original = process.env.TRUSTED_PROXY_CIDRS;
    process.env.TRUSTED_PROXY_CIDRS = "not-a-cidr, 10.0.0.0/33, 192.168.0.0/16";
    try {
      const ip = getClientIp(req({ "x-forwarded-for": "203.0.113.42, 192.168.1.1, 10.0.0.1" }));
      // 10.0.0.1 is not inside 192.168.0.0/16, so it is the client IP.
      expect(ip).toBe("10.0.0.1");
    } finally {
      process.env.TRUSTED_PROXY_CIDRS = original;
    }
  });
});

describe("parseCidr", () => {
  it("parses valid IPv4 CIDRs", () => {
    expect(parseCidr("10.0.0.0/8")).toEqual({ network: 167772160, prefix: 8 });
    expect(parseCidr("192.168.0.0/16")).toEqual({ network: 3232235520, prefix: 16 });
    expect(parseCidr("10.16.0.0/20")).toEqual({ network: 168820736, prefix: 20 });
  });

  it("rejects invalid prefix lengths", () => {
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("10.0.0.0/-1")).toBeNull();
    expect(parseCidr("10.0.0.0/abc")).toBeNull();
  });

  it("rejects malformed CIDRs", () => {
    expect(parseCidr("10.0.0.0")).toBeNull();
    expect(parseCidr("256.0.0.0/8")).toBeNull();
    expect(parseCidr("not-a-cidr")).toBeNull();
  });
});

describe("ipToUint32", () => {
  it("converts valid IPv4 addresses", () => {
    expect(ipToUint32("0.0.0.0")).toBe(0);
    expect(ipToUint32("255.255.255.255")).toBe(4294967295);
    expect(ipToUint32("10.16.15.255")).toBe(168824831);
  });

  it("rejects invalid IPv4 addresses", () => {
    expect(ipToUint32("256.0.0.1")).toBeNull();
    expect(ipToUint32("10.0.0")).toBeNull();
    expect(ipToUint32("not-an-ip")).toBeNull();
  });
});
