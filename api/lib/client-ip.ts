import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { env } from './env';

/**
 * Extracts client identifier for rate limiting.
 *
 * Trust boundary:
 * - In production, the app runs behind Render's proxy
 * - Render sets X-Forwarded-For with the original client IP as the first entry
 * - This is an ABUSE-REDUCTION control, NOT an authentication or authorization boundary
 * - X-Forwarded-For can be spoofed by malicious clients if not properly validated by the proxy
 * - Conservative fallback limits apply when the header is missing or untrusted
 *
 * Conservative limits for untrusted clients:
 * - Max 5 intents per hour (vs 100 for trusted public IPs)
 * - Max 1 GB per hour (vs 5 GB for trusted public IPs)
 */
export function getClientIdentifier(headers: Headers): {
  id: string;
  isTrusted: boolean;
  trustSource: string;
} {
  const forwarded = headers.get('x-forwarded-for');

  if (!forwarded) {
    return {
      id: hashClientId('unknown:no-forwarded-header'),
      isTrusted: false,
      trustSource: 'none',
    };
  }

  // Parse chain: client, proxy1, proxy2, render
  const ips = forwarded.split(',').map((ip) => ip.trim());

  // Take FIRST IP as client (Render prepends)
  const clientIp = ips[0];

  // Reject malformed addresses (IPv4 or IPv6)
  if (!isIP(clientIp)) {
    return {
      id: hashClientId('unknown:invalid-ip'),
      isTrusted: false,
      trustSource: 'invalid',
    };
  }

  // Reject private/reserved ranges (should not come from internet)
  if (!isPublicIP(clientIp)) {
    return {
      id: hashClientId(`unknown:private-${clientIp}`),
      isTrusted: false,
      trustSource: 'private',
    };
  }

  return {
    id: hashClientId(clientIp),
    isTrusted: true,
    trustSource: 'x-forwarded-for',
  };
}

export function getRateLimitForClient(client: { isTrusted: boolean }): {
  maxIntents: number;
  maxBytes: number;
} {
  if (client.isTrusted) {
    return { maxIntents: 100, maxBytes: 5 * 1024 * 1024 * 1024 };
  }
  return { maxIntents: 5, maxBytes: 1 * 1024 * 1024 * 1024 };
}

function isPublicIP(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    return isPublicIPv4(ip);
  }
  if (kind === 6) {
    return isPublicIPv6(ip);
  }
  return false;
}

function isPublicIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  // Loopback, private (10/8, 172.16/12, 192.168/16)
  return !(
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPublicIPv6(ip: string): boolean {
  // Normalize to lower-case for safe prefix checks
  const normalized = ip.toLowerCase();

  // Loopback ::1/128
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return false;
  }

  // Link-local fe80::/10
  if (normalized.startsWith('fe80:')) {
    return false;
  }

  // Unique/local (private) fc00::/7 and fd00::/8
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return false;
  }

  return true;
}

function hashClientId(value: string): string {
  return createHmac('sha256', env.appSecret + ':client-id')
    .update(value)
    .digest('hex');
}
