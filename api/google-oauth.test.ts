import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const hoisted = vi.hoisted(() => ({
  idTokenPayload: {
    sub: "google-sub-owner",
    email: "owner@example.com",
    email_verified: true,
    name: "Gerald Balucan",
    picture: "https://example.com/avatar.png",
  },
  upsertCalls: [] as Record<string, unknown>[],
  tokenExchangeOk: true,
  verifyCalls: [] as { token: string; opts?: Parameters<typeof import("jose").jwtVerify>[2] }[],
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async (
      token: string,
      key: Parameters<typeof actual.jwtVerify>[1],
      opts?: Parameters<typeof actual.jwtVerify>[2],
    ) => {
      let alg = "";
      try {
        alg = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).alg;
      } catch {
        // Unparseable header: treat as a provider id_token for the test.
        alg = "RS256";
      }
      if (alg === "HS256") {
        // Real verification for OAuth state JWTs (signed with APP_SECRET).
        return actual.jwtVerify(token, key, opts);
      }
      // RS256: simulated Google id_token verification.
      hoisted.verifyCalls.push({ token, opts });
      return { payload: hoisted.idTokenPayload, protectedHeader: { alg: "RS256" } };
    }),
  };
});

vi.mock("./queries/users", () => ({
  upsertUserByProvider: vi.fn(async (input: Record<string, unknown>) => {
    hoisted.upsertCalls.push(input);
    return { id: 1, role: "user", ...input };
  }),
}));

describe("Google OAuth (OWNER/admin auth)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "test-app-secret-at-least-32-chars-long!!");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "google-client-secret");
    vi.stubEnv("OWNER_GOOGLE_SUB", "google-sub-owner");
    hoisted.upsertCalls.length = 0;
    hoisted.verifyCalls.length = 0;
    hoisted.idTokenPayload = {
      sub: "google-sub-owner",
      email: "owner@example.com",
      email_verified: true,
      name: "Gerald Balucan",
      picture: "https://example.com/avatar.png",
    };
    hoisted.tokenExchangeOk = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        hoisted.tokenExchangeOk
          ? new Response(JSON.stringify({ id_token: "header.payload.sig", access_token: "access-token" }), { status: 200 })
          : new Response("invalid_grant", { status: 400 }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("authorize builds a Google OAuth request (no Kimi references)", async () => {
    const { buildAuthorizeUrl, verifyOAuthState } = await import("./auth/google");
    const url = new URL(await buildAuthorizeUrl("https://odm-dashboard.onrender.com"));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://odm-dashboard.onrender.com/api/oauth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.toString()).not.toContain("kimi");

    // The signed state is bound to the exact redirect URI and validates.
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    await expect(verifyOAuthState(state!)).resolves.toBe(
      "https://odm-dashboard.onrender.com/api/oauth/callback",
    );
  });

  it("authorize fails closed when Google OAuth is not configured", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");
    const { buildAuthorizeUrl, isGoogleOAuthConfigured } = await import("./auth/google");
    expect(isGoogleOAuthConfigured()).toBe(false);
    await expect(buildAuthorizeUrl("https://example.com")).rejects.toThrow(/not configured/i);
  });

  it("OAuth state round-trips and rejects tampered state", async () => {
    const { createOAuthState, verifyOAuthState } = await import("./auth/google");
    const state = await createOAuthState("https://odm-dashboard.onrender.com/api/oauth/callback");
    expect(state.split(".").length).toBe(3);

    await expect(verifyOAuthState(state)).resolves.toBe(
      "https://odm-dashboard.onrender.com/api/oauth/callback",
    );

    // Tamper with the payload portion.
    const [header, , sig] = state.split(".");
    const tampered = `${header}.${Buffer.from(JSON.stringify({ redirectUri: "https://evil.example.com/cb" })).toString("base64url")}.${sig}`;
    await expect(verifyOAuthState(tampered)).resolves.toBeNull();

    await expect(verifyOAuthState("not-a-jwt")).resolves.toBeNull();
  });

  it("verifyGoogleIdToken validates audience/issuer and returns the verified identity", async () => {
    const { verifyGoogleIdToken } = await import("./auth/google");
    const identity = await verifyGoogleIdToken("header.payload.sig");

    expect(identity).toEqual({
      sub: "google-sub-owner",
      email: "owner@example.com",
      emailVerified: true,
      name: "Gerald Balucan",
      picture: "https://example.com/avatar.png",
    });
    const call = hoisted.verifyCalls.at(-1);
    expect(call?.opts?.audience).toBe("google-client-id");
    expect(call?.opts?.issuer).toContain("accounts.google.com");
  });

  it("callback rejects a missing or forged state", async () => {
    const { createOAuthCallbackHandler } = await import("./auth/google");
    const app = new Hono();
    app.get("/api/oauth/callback", createOAuthCallbackHandler());

    const noState = await app.request("/api/oauth/callback?code=abc", { headers: { host: "localhost:3000" } });
    expect(noState.status).toBe(400);

    const forged = await app.request(
      "/api/oauth/callback?code=abc&state=" + encodeURIComponent("forged.state.value"),
      { headers: { host: "localhost:3000" } },
    );
    expect(forged.status).toBe(400);
    expect(await forged.json()).toEqual({ error: "invalid OAuth state" });
  });

  it("callback rejects a validly-signed state bound to a different redirect URI", async () => {
    const { createOAuthCallbackHandler, createOAuthState } = await import("./auth/google");
    const app = new Hono();
    app.get("/api/oauth/callback", createOAuthCallbackHandler());

    // Signed, valid, but bound to a redirect URI that differs from the request origin.
    const state = await createOAuthState("https://evil.example.com/api/oauth/callback");
    const res = await app.request(
      "/api/oauth/callback?code=abc&state=" + encodeURIComponent(state),
      { headers: { host: "localhost:3000" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid OAuth state" });
  });

  it("callback handles access_denied by redirecting home", async () => {
    const { createOAuthCallbackHandler } = await import("./auth/google");
    const app = new Hono();
    app.get("/api/oauth/callback", createOAuthCallbackHandler());

    const res = await app.request("/api/oauth/callback?error=access_denied", { headers: { host: "localhost:3000" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("OWNER Google subject logs in and receives an odm_sid session cookie", async () => {
    const { createOAuthCallbackHandler, createOAuthState } = await import("./auth/google");
    const app = new Hono();
    app.get("/api/oauth/callback", createOAuthCallbackHandler());

    const state = await createOAuthState("http://localhost/api/oauth/callback");
    const res = await app.request(
      "/api/oauth/callback?code=auth-code&state=" + encodeURIComponent(state),
      { headers: { host: "localhost:3000" } },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("odm_sid=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("kimi_sid");

    // Verified identity passed through to the server-side user upsert
    // (email + email_verified reach the bootstrap logic; sub is the identity).
    expect(hoisted.upsertCalls).toHaveLength(1);
    expect(hoisted.upsertCalls[0]).toMatchObject({
      provider: "google",
      subject: "google-sub-owner",
      email: "owner@example.com",
      emailVerified: true,
    });
  });

  it("a non-owner Google subject still passes through as google provider (role decided server-side)", async () => {
    const { createOAuthCallbackHandler, createOAuthState } = await import("./auth/google");
    hoisted.idTokenPayload = { ...hoisted.idTokenPayload, sub: "google-sub-other", email: "other@example.com" };
    const app = new Hono();
    app.get("/api/oauth/callback", createOAuthCallbackHandler());

    const state = await createOAuthState("http://localhost/api/oauth/callback");
    const res = await app.request(
      "/api/oauth/callback?code=auth-code&state=" + encodeURIComponent(state),
      { headers: { host: "localhost:3000" } },
    );
    expect(res.status).toBe(302);
    expect(hoisted.upsertCalls[0]).toMatchObject({
      provider: "google",
      subject: "google-sub-other",
    });
    // The session binds the verified subject only.
    expect(res.headers.get("set-cookie")).toContain("odm_sid=");
  });

  it("callback returns 500 when the Google token exchange fails", async () => {
    const { createOAuthCallbackHandler, createOAuthState } = await import("./auth/google");
    hoisted.tokenExchangeOk = false;
    const app = new Hono();
    app.get("/api/oauth/callback", createOAuthCallbackHandler());

    const state = await createOAuthState("http://localhost/api/oauth/callback");
    const res = await app.request(
      "/api/oauth/callback?code=bad-code&state=" + encodeURIComponent(state),
      { headers: { host: "localhost:3000" } },
    );
    expect(res.status).toBe(500);
    expect(hoisted.upsertCalls).toHaveLength(0);
  });

  it("session cookie is provider-neutral and verifiable (odm_sid, not kimi_sid)", async () => {
    const { signSessionToken, verifySessionToken } = await import("./auth/session");
    const token = await signSessionToken({ sub: "google-sub-owner", provider: "google" });
    await expect(verifySessionToken(token)).resolves.toEqual({
      sub: "google-sub-owner",
      provider: "google",
    });
  });

  it("auth.me resolves the OWNER admin and logout clears the odm_sid cookie", async () => {
    const { appRouter } = await import("./router");
    const resHeaders = new Headers();
    const caller = appRouter.createCaller({
      req: new Request("http://localhost/api/trpc"),
      resHeaders,
      user: {
        id: 1,
        name: "Gerald Balucan",
        email: "owner@example.com",
        avatar: null,
        role: "admin",
        unionId: null,
        authProvider: "google",
        authSubject: "google-sub-owner",
        createdAt: new Date(),
        lastSignInAt: new Date(),
      },
    } as never);

    const me = await caller.auth.me();
    expect(me.role).toBe("admin");
    expect(me.authSubject).toBe("google-sub-owner");

    const out = await caller.auth.logout();
    expect(out.success).toBe(true);
    const setCookie = resHeaders.get("set-cookie") ?? "";
    expect(setCookie).toContain("odm_sid=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).not.toContain("kimi_sid");
  });

  it("auth.me without a session is rejected (authedQuery boundary)", async () => {
    const { appRouter } = await import("./router");
    const caller = appRouter.createCaller({
      req: new Request("http://localhost/api/trpc"),
      resHeaders: new Headers(),
    } as never);
    await expect(caller.auth.me()).rejects.toThrow(/Authentication required/);
  });
});
