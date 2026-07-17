import { afterEach, describe, expect, it, vi } from "vitest";

describe("authentication environment mapping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("exposes APP_ID and APP_SECRET through the camelCase authentication contract", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_ID", "test-app-id");
    vi.stubEnv("APP_SECRET", "test-app-secret");

    const { env } = await import("./env");

    expect(env.appId).toBe("test-app-id");
    expect(env.appSecret).toBe("test-app-secret");
  });

  it("uses the configured APP_SECRET for session signing and verification", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_ID", "test-app-id");
    vi.stubEnv("APP_SECRET", "test-app-secret");

    const { signSessionToken, verifySessionToken } = await import("../kimi/session");
    const token = await signSessionToken({ unionId: "test-user", clientId: "test-app-id" });

    await expect(verifySessionToken(token)).resolves.toEqual({
      unionId: "test-user",
      clientId: "test-app-id",
    });
  });

  it("reports missing authentication configuration and refuses empty-key session signing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_ID", "");
    vi.stubEnv("APP_SECRET", "");

    const { env } = await import("./env");
    const { signSessionToken } = await import("../kimi/session");

    expect(env.appId).toBe("");
    expect(env.appSecret).toBe("");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("APP_ID is required");
    expect(warn.mock.calls[0]?.[0]).toContain("APP_SECRET is required");
    await expect(signSessionToken({ unionId: "test-user", clientId: "test-app-id" }))
      .rejects.toThrow("APP_SECRET is required for session signing.");
  });
});
