import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import * as jose from "jose";
import { randomUUID } from "node:crypto";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { getOAuthRedirectUri } from "../lib/public-origin";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { signSessionToken } from "./session";
import { upsertUserByProvider } from "../queries/users";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const GOOGLE_SCOPE = "openid email profile";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const googleJwks = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(env.googleOAuthClientId && env.googleOAuthClientSecret);
}

export type GoogleIdentity = {
  sub: string;
  email: string | null;
  emailVerified: boolean | null;
  name: string | null;
  picture: string | null;
};

export type GoogleTokenResponse = {
  access_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token?: string;
};

/**
 * Stateless, signed OAuth state. The redirect URI is bound inside the signed
 * JWT so a forged or replayed `state` cannot steer the callback elsewhere;
 * expiry bounds replay window. Verified server-side on callback.
 */
export async function createOAuthState(redirectUri: string): Promise<string> {
  if (!env.appSecret) {
    throw Errors.internal("APP_SECRET is required for OAuth state signing.");
  }
  return new jose.SignJWT({ redirectUri })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_MS / 1000}s`)
    .sign(new TextEncoder().encode(env.appSecret));
}

export async function verifyOAuthState(
  state: string,
): Promise<string | null> {
  try {
    if (!env.appSecret) return null;
    const { payload } = await jose.jwtVerify(state, new TextEncoder().encode(env.appSecret), {
      algorithms: ["HS256"],
    });
    const redirectUri = payload.redirectUri as string | undefined;
    // Signature/expiry are enforced by jwtVerify; additionally require an
    // absolute http(s) URL so a signed payload cannot smuggle a non-URL.
    if (!redirectUri || !/^https?:\/\//.test(redirectUri)) return null;
    return redirectUri;
  } catch {
    return null;
  }
}

export async function buildAuthorizeUrl(redirectUri: string): Promise<string> {
  if (!isGoogleOAuthConfigured()) {
    throw Errors.internal("Google OAuth is not configured.");
  }
  const state = await createOAuthState(redirectUri);
  const params = new URLSearchParams({
    client_id: env.googleOAuthClientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  if (!isGoogleOAuthConfigured()) {
    throw Errors.internal("Google OAuth is not configured.");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.googleOAuthClientId!,
    client_secret: env.googleOAuthClientSecret!,
    redirect_uri: redirectUri,
  });
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google token exchange failed (${resp.status}): ${text}`);
  }
  return resp.json() as Promise<GoogleTokenResponse>;
}

/**
 * Verifies the Google ID token cryptographically and returns the verified
 * identity. `sub` is the immutable provider subject — the server-side
 * authorization authority. Email is used only for display.
 */
export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleIdentity> {
  if (!env.googleOAuthClientId) {
    throw Errors.internal("Google OAuth is not configured.");
  }
  const { payload } = await jose.jwtVerify(idToken, googleJwks, {
    algorithms: ["RS256"],
    audience: env.googleOAuthClientId,
    issuer: ["accounts.google.com", "https://accounts.google.com"],
  });
  const sub = payload.sub as string | undefined;
  if (!sub) {
    throw new Error("Google id_token missing sub claim.");
  }
  return {
    sub,
    email: (payload.email as string | undefined) ?? null,
    emailVerified: (payload.email_verified as boolean | undefined) ?? null,
    name: (payload.name as string | undefined) ?? null,
    picture: (payload.picture as string | undefined) ?? null,
  };
}

export function createOAuthCallbackHandler() {
  return async (c: Context) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      if (error === "access_denied") {
        return c.redirect("/", 302);
      }
      return c.json({ error }, 400);
    }

    if (!code || !state) {
      return c.json({ error: "code and state are required" }, 400);
    }

    try {
      // Validate state: signature + expiry, and bind the redirect URI. The
      // expected URI is resolved from the SAME canonical public origin used to
      // build the authorize URL, so the values can never disagree.
      const stateRedirectUri = await verifyOAuthState(state);
      const expectedRedirectUri = getOAuthRedirectUri(c.req.raw);
      if (!stateRedirectUri || stateRedirectUri !== expectedRedirectUri) {
        return c.json({ error: "invalid OAuth state" }, 400);
      }

      const tokenResp = await exchangeCodeForToken(code, expectedRedirectUri);
      if (!tokenResp.id_token) {
        throw new Error("Google token response missing id_token.");
      }

      // Cryptographic verification of the provider identity (server-side).
      // The raw verified email + email_verified flag are passed through so the
      // one-time OWNER bootstrap can match OWNER_GOOGLE_EMAIL exactly; the
      // persisted identity remains the immutable Google sub.
      const identity = await verifyGoogleIdToken(tokenResp.id_token);

      const user = await upsertUserByProvider({
        provider: "google",
        subject: identity.sub,
        name: identity.name ?? "Google User",
        email: identity.email,
        emailVerified: identity.emailVerified,
        avatar: identity.picture,
        lastSignInAt: new Date(),
      });
      if (!user) {
        throw new Error("Failed to persist user record");
      }

      const token = await signSessionToken({
        sub: identity.sub,
        provider: "google",
      });

      const cookieOpts = getSessionCookieOptions(c.req.raw.headers);
      setCookie(c, Session.cookieName, token, {
        ...cookieOpts,
        maxAge: Session.maxAgeMs / 1000,
      });

      return c.redirect("/", 302);
    } catch (err) {
      console.error("[OAuth] Google callback failed", err);
      return c.json({ error: "OAuth callback failed" }, 500);
    }
  };
}
