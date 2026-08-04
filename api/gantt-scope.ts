import * as cookie from "cookie";
import * as jose from "jose";
import { env } from "./lib/env";
import { getSessionCookieOptions } from "./lib/cookies";
import type { TrpcContext } from "./context";

const ANON_COOKIE = "gantt_anon_scope";
const ANON_AUDIENCE = "odm-gantt";
const ANON_ISSUER = "odm-dashboard";

export type GanttScope =
  | { kind: "user"; userId: number; isAdmin: boolean }
  | { kind: "anonymous"; sessionId: string; isAdmin: false };

export function ganttScopeOwnsProject(
  scope: GanttScope,
  project: { userId: number | null; sessionId: string | null },
): boolean {
  return scope.kind === "user"
    ? project.userId === scope.userId
    : project.userId === null && project.sessionId === scope.sessionId;
}

function getScopeSecret(): Uint8Array {
  const secretValue = env.appSecret ?? env.APP_SECRET;
  if (!secretValue) throw new Error("APP_SECRET is required for anonymous Gantt isolation.");
  return new TextEncoder().encode(secretValue);
}

async function signAnonymousScope(sessionId: string): Promise<string> {
  const secret = getScopeSecret();
  return new jose.SignJWT({ kind: "gantt-anonymous", sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ANON_ISSUER)
    .setAudience(ANON_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(secret);
}

async function verifyAnonymousScope(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const secret = getScopeSecret();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: ANON_ISSUER,
      audience: ANON_AUDIENCE,
    });
    return payload.kind === "gantt-anonymous" && typeof payload.sessionId === "string"
      ? payload.sessionId
      : null;
  } catch {
    return null;
  }
}

export async function resolveGanttScope(ctx: TrpcContext): Promise<GanttScope> {
  if (ctx.user) {
    return { kind: "user", userId: ctx.user.id, isAdmin: ctx.user.role === "admin" };
  }

  const cookies = cookie.parse(ctx.req.headers.get("cookie") || "");
  let sessionId = await verifyAnonymousScope(cookies[ANON_COOKIE]);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    const token = await signAnonymousScope(sessionId);
    const options = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append("set-cookie", cookie.serialize(ANON_COOKIE, token, {
      httpOnly: options.httpOnly,
      path: options.path,
      sameSite: options.sameSite?.toString().toLowerCase() as "lax" | "none" | "strict" | undefined,
      secure: options.secure,
      maxAge: 60 * 60 * 24 * 365,
    }));
  }
  return { kind: "anonymous", sessionId, isAdmin: false };
}

export const ganttScopeCookieName = ANON_COOKIE;
