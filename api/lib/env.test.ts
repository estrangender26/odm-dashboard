import { afterEach, describe, expect, it, vi } from "vitest";

describe("authentication environment mapping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("exposes APP_SECRET through the session contract", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "test-app-secret");

    const { env } = await import("./env");

    expect(env.appSecret).toBe("test-app-secret");
  });

  it("exposes Google OAuth and OWNER configuration when present", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "test-app-secret");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id-123");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret-456");
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "owner@example.com");
    vi.stubEnv("OWNER_GOOGLE_SUB", "owner-sub-789");

    const { env } = await import("./env");

    expect(env.googleOAuthClientId).toBe("client-id-123");
    expect(env.googleOAuthClientSecret).toBe("client-secret-456");
    expect(env.ownerGoogleEmail).toBe("owner@example.com");
    expect(env.ownerGoogleSub).toBe("owner-sub-789");
  });

  it("OWNER_GOOGLE_SUB is optional — email bootstrap works without it", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "test-app-secret");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id-123");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret-456");
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "owner@example.com");

    const { env } = await import("./env");

    expect(env.ownerGoogleEmail).toBe("owner@example.com");
    expect(env.ownerGoogleSub).toBeUndefined();
  });

  it("uses the configured APP_SECRET for session signing and verification", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "test-app-secret");

    const { signSessionToken, verifySessionToken } = await import("../auth/session");
    const token = await signSessionToken({ sub: "test-sub", provider: "google" });

    await expect(verifySessionToken(token)).resolves.toEqual({
      sub: "test-sub",
      provider: "google",
    });
  });

  it("reports missing authentication configuration and refuses empty-key session signing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "");

    const { env } = await import("./env");
    const { signSessionToken } = await import("../auth/session");

    expect(env.appSecret).toBe("");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("APP_SECRET is required");
    await expect(signSessionToken({ sub: "test-sub", provider: "google" }))
      .rejects.toThrow("APP_SECRET is required for session signing.");
  });
});
