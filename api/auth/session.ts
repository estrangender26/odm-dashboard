import * as jose from "jose";
import { env } from "../lib/env";

const JWT_ALG = "HS256";

/**
 * Provider-neutral session payload. `sub` is the immutable provider subject
 * (e.g. Google `sub`); `provider` identifies the OAuth provider (e.g.
 * "google"). Replaces the Kimi-era { unionId, clientId } payload.
 */
export type SessionPayload = {
  sub: string;
  provider: string;
};

function getSessionSecret() {
  if (!env.appSecret) {
    throw new Error("APP_SECRET is required for session signing.");
  }
  return new TextEncoder().encode(env.appSecret);
}

export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const secret = getSessionSecret();
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    console.warn("[session] No token provided for verification.");
    return null;
  }
  try {
    const secret = getSessionSecret();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const { sub, provider } = payload;
    if (!sub || !provider) {
      console.warn("[session] JWT payload missing required fields.");
      return null;
    }
    return { sub, provider } as SessionPayload;
  } catch (error) {
    console.warn("[session] JWT verification failed:", error);
    return null;
  }
}
