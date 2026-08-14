import { describe, expect, it } from "vitest";
import {
  getClientIdentifier,
  getRateLimitForClient,
} from "./client-ip";

process.env.APP_SECRET = process.env.APP_SECRET || "test-app-secret";

function headersWithForwardedFor(value: string): Headers {
  return new Headers({ "x-forwarded-for": value });
}

describe("client IP trust classification", () => {
  it("trusts a public IPv4 address", () => {
    const client = getClientIdentifier(headersWithForwardedFor("203.0.113.42"));
    expect(client.isTrusted).toBe(true);
    expect(client.trustSource).toBe("x-forwarded-for");
  });

  it("trusts a public IPv6 address", () => {
    const client = getClientIdentifier(
      headersWithForwardedFor("2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
    );
    expect(client.isTrusted).toBe(true);
    expect(client.trustSource).toBe("x-forwarded-for");
  });

  it("treats a malformed IP as untrusted", () => {
    const client = getClientIdentifier(headersWithForwardedFor("not-an-ip"));
    expect(client.isTrusted).toBe(false);
    expect(client.trustSource).toBe("invalid");
  });

  it("treats a private IPv4 address as untrusted", () => {
    const client = getClientIdentifier(headersWithForwardedFor("192.168.1.42"));
    expect(client.isTrusted).toBe(false);
    expect(client.trustSource).toBe("private");
  });

  it("treats an IPv4 loopback address as untrusted", () => {
    const client = getClientIdentifier(headersWithForwardedFor("127.0.0.1"));
    expect(client.isTrusted).toBe(false);
    expect(client.trustSource).toBe("private");
  });

  it("treats private, link-local, and loopback IPv6 addresses as untrusted", () => {
    const cases = [
      "::1",
      "fe80::1",
      "fe90::1",
      "fea0::1",
      "febf::1",
      "fd00::1",
      "fc00::1",
    ];

    for (const ip of cases) {
      const client = getClientIdentifier(headersWithForwardedFor(ip));
      expect(client.isTrusted).toBe(false);
      expect(client.trustSource).toBe("private");
    }
  });
});

describe("client rate limits", () => {
  it("gives a trusted IPv4 client 100 intents and 5 GB per hour", () => {
    const client = getClientIdentifier(headersWithForwardedFor("203.0.113.42"));
    const limits = getRateLimitForClient(client);
    expect(limits.maxIntents).toBe(100);
    expect(limits.maxBytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it("gives a trusted IPv6 client 100 intents and 5 GB per hour", () => {
    const client = getClientIdentifier(
      headersWithForwardedFor("2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
    );
    const limits = getRateLimitForClient(client);
    expect(limits.maxIntents).toBe(100);
    expect(limits.maxBytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it("keeps untrusted fallback at 5 intents and 1 GB per hour", () => {
    const untrusted = { isTrusted: false, trustSource: "none" };
    const limits = getRateLimitForClient(untrusted);
    expect(limits.maxIntents).toBe(5);
    expect(limits.maxBytes).toBe(1 * 1024 * 1024 * 1024);
  });
});
