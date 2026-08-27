import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from './lib/env';

export interface CapabilityClaims {
  jti: string;
  iat: number;
  exp: number;
  intentId: string;
  mod: string;
  src: string;
  tgt: Record<string, unknown>;
  bucket: string;
  path: string;
  fn: string;
  mime: string;
  size: number;
}

const CAPABILITY_TOKEN_TTL_SECONDS = 2 * 60 * 60; // 2 hours

export function generateCapabilityClaims(
  intentId: string,
  module: string,
  source: string,
  target: Record<string, unknown>,
  path: string,
  bucket: string,
  filename: string,
  mimeType: string,
  size: number
): CapabilityClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    jti: randomUUID(),
    iat: now,
    exp: now + CAPABILITY_TOKEN_TTL_SECONDS,
    intentId,
    mod: module,
    src: source,
    tgt: target,
    path,
    bucket,
    fn: filename,
    mime: mimeType,
    size,
  };
}

export function signCapabilityClaims(claims: CapabilityClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', env.appSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyCapabilityToken(token: string): CapabilityClaims | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  try {
    const expected = createHmac('sha256', env.appSecret)
      .update(payload)
      .digest();
    const actual = Buffer.from(signature, 'base64url');

    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null;
    }

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CapabilityClaims;
    if (claims.exp < Date.now() / 1000) return null;

    return claims;
  } catch {
    return null;
  }
}

export function hashCapabilityToken(token: string): string {
  return createHmac('sha256', env.appSecret + ':capability-hash')
    .update(token)
    .digest('hex');
}

/* ─── Projects without PPP — governed FILE DELETION capability ───
   Issued to the uploader at finalize/attach time; binds deletion to exactly
   one file + one project. Verifying requires the matching file row, so a
   capability for File A can never delete File B (or a different project).
   NEVER returned in dashboard/history API responses — only in the uploader's
   own finalize/attach response. */

export const PWP_DELETE_CAPABILITY_OP = "pwp-file-delete" as const;
export const PWP_DELETE_CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface DeleteCapabilityClaims {
  jti: string;
  iat: number;
  exp: number;
  op: typeof PWP_DELETE_CAPABILITY_OP;
  fileId: number;
  projectId: number;
}

export function generateDeleteCapabilityClaims(
  fileId: number,
  projectId: number,
): DeleteCapabilityClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    jti: randomUUID(),
    iat: now,
    exp: now + Math.floor(PWP_DELETE_CAPABILITY_TTL_MS / 1000),
    op: PWP_DELETE_CAPABILITY_OP,
    fileId,
    projectId,
  };
}

export function signDeleteCapability(claims: DeleteCapabilityClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", env.appSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Verifies signature, operation and expiry, then binds the capability to the
 * exact file/project pair. Returns the claims on success, null otherwise.
 */
export function verifyDeleteCapability(
  token: string,
  expected: { fileId: number; projectId: number },
): DeleteCapabilityClaims | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  try {
    const expectedSig = createHmac("sha256", env.appSecret)
      .update(payload)
      .digest();
    const actualSig = Buffer.from(signature, "base64url");
    if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
      return null;
    }

    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as DeleteCapabilityClaims;

    if (claims.op !== PWP_DELETE_CAPABILITY_OP) return null;
    if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) return null;
    if (claims.fileId !== expected.fileId) return null;
    if (claims.projectId !== expected.projectId) return null;

    return claims;
  } catch {
    return null;
  }
}
