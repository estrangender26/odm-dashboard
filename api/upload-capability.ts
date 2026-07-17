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
