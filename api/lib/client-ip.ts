import { createHmac } from 'node:crypto';
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
 * - Max 5 intents per hour (vs 10 for known IPs)
 * - Max 1 GB per hour (vs 5 GB for known IPs)
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
      trustSource: 'none'
    };
  }
  
  // Parse chain: client, proxy1, proxy2, render
  const ips = forwarded.split(',').map(ip => ip.trim());
  
  // Take FIRST IP as client (Render prepends)
  const clientIp = ips[0];
  
  // Validate IPv4 format
  if (!isValidIPv4(clientIp)) {
    return { 
      id: hashClientId('unknown:invalid-ip'), 
      isTrusted: false,
      trustSource: 'invalid'
    };
  }
  
  // Check for private/reserved ranges (should not come from internet)
  if (isPrivateIP(clientIp)) {
    return { 
      id: hashClientId(`unknown:private-${clientIp}`), 
      isTrusted: false,
      trustSource: 'private'
    };
  }
  
  return {
    id: hashClientId(clientIp),
    isTrusted: true,
    trustSource: 'x-forwarded-for'
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

function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && String(num) === part;
  });
}

function isPrivateIP(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || 
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 127;
}

function hashClientId(value: string): string {
  return createHmac('sha256', env.appSecret + ':client-id')
    .update(value)
    .digest('hex');
}
