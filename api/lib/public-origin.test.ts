import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROD_CALLBACK = "https://odm-dashboard.onrender.com/api/oauth/callback";

function req(headers: Record<string, string>, url = "http://localhost/api/oauth/callback"): Request {
  return new Request(url, { headers });
}

describe("canonical public origin for OAuth redirects", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "test-app-secret-at-least-32-chars-long!!");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("production-equivalent Render/proxied HTTPS request resolves the exact HTTPS callback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getOAuthRedirectUri } = await import("./public-origin");
    // Render's edge forwards internally over HTTP with X-Forwarded-Proto: https.
    const request = req(
      { "x-forwarded-proto": "https", host: "odm-dashboard.onrender.com" },
      "http://odm-dashboard.onrender.com/api/oauth/callback",
    );
    expect(getOAuthRedirectUri(request)).toBe(PROD_CALLBACK);
  });

  it("a client-spoofed leading forwarded proto cannot downgrade the scheme", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getOAuthRedirectUri } = await import("./public-origin");
    // Attacker sends X-Forwarded-Proto: http; Render appends https. The
    // rightmost (proxy-appended) value is the trusted one.
    const request = req(
      { "x-forwarded-proto": "http, https", host: "odm-dashboard.onrender.com" },
      "http://odm-dashboard.onrender.com/api/oauth/callback",
    );
    expect(getOAuthRedirectUri(request)).toBe(PROD_CALLBACK);
  });

  it("a spoofed X-Forwarded-Host is ignored — the edge-validated Host header wins", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getOAuthRedirectUri } = await import("./public-origin");
    const request = req(
      {
        "x-forwarded-proto": "https",
        host: "odm-dashboard.onrender.com",
        "x-forwarded-host": "attacker.example.com",
      },
      "http://odm-dashboard.onrender.com/api/oauth/callback",
    );
    expect(getOAuthRedirectUri(request)).toBe(PROD_CALLBACK);
  });

  it("production fails closed when the forwarded scheme is not https", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getOAuthRedirectUri } = await import("./public-origin");
    expect(() =>
      getOAuthRedirectUri(req({ "x-forwarded-proto": "http", host: "odm-dashboard.onrender.com" })),
    ).toThrow(/trusted public origin/i);
    expect(() =>
      getOAuthRedirectUri(req({ host: "odm-dashboard.onrender.com" })),
    ).toThrow(/trusted public origin/i);
  });

  it("production rejects non-public hosts (private/loopback/IP) even with https proto", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getOAuthRedirectUri } = await import("./public-origin");
    for (const host of ["localhost:3000", "192.168.1.5", "10.0.0.1", "myhost.local", "odm.local"]) {
      expect(
        () => getOAuthRedirectUri(req({ "x-forwarded-proto": "https", host })),
        `host ${host} must be rejected`,
      ).toThrow(/trusted public origin/i);
    }
  });

  it("PUBLIC_APP_URL (operator config) wins and is never spoofable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_URL", "https://odm.example.com");
    const { getOAuthRedirectUri } = await import("./public-origin");
    // Even hostile forwarded headers cannot change the configured origin.
    const request = req(
      { "x-forwarded-proto": "http", host: "attacker.example.com", "x-forwarded-host": "evil.test" },
      "http://internal/api/oauth/callback",
    );
    expect(getOAuthRedirectUri(request)).toBe("https://odm.example.com/api/oauth/callback");
  });

  it("localhost development keeps working over plain HTTP", async () => {
    const { getPublicOrigin, getOAuthRedirectUri } = await import("./public-origin");
    const request = req({ host: "localhost:3000" }, "http://localhost:3000/api/oauth/callback");
    expect(getPublicOrigin(request)).toBe("http://localhost:3000");
    expect(getOAuthRedirectUri(request)).toBe("http://localhost:3000/api/oauth/callback");
  });

  it("localhost development with an explicit port is preserved", async () => {
    const { getPublicOrigin } = await import("./public-origin");
    expect(getPublicOrigin(req({ host: "127.0.0.1:5173" }, "http://127.0.0.1:5173/x"))).toBe(
      "http://127.0.0.1:5173",
    );
  });

  it("host validation rejects malformed hosts", async () => {
    const { isValidPublicHostname } = await import("./public-origin");
    expect(isValidPublicHostname("odm-dashboard.onrender.com")).toBe(true);
    expect(isValidPublicHostname("odm-dashboard.onrender.com:443")).toBe(true);
    expect(isValidPublicHostname("evil.com@odm.com")).toBe(false);
    expect(isValidPublicHostname("odm.com/path")).toBe(false);
    expect(isValidPublicHostname("odm com")).toBe(false);
    expect(isValidPublicHostname("localhost")).toBe(false);
    expect(isValidPublicHostname("127.0.0.1")).toBe(false);
    expect(isValidPublicHostname("[::1]")).toBe(false);
    expect(isValidPublicHostname("a")).toBe(false);
    expect(isValidPublicHostname("")).toBe(false);
  });
});
