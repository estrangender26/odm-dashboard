/**
 * rateLimit.ts — sliding-window rate limiter for public Gantt endpoints.
 *
 * - Keys are caller + procedure scoped using the client IP returned by clientIp.ts.
 * - Unknown callers are NOT placed into a single global shared bucket; instead they
 *   are tracked per request (effectively no limit). Production traffic from Render
 *   always provides X-Forwarded-For, so this fallback is safe there.
 * - Windows are approximate; the map is trimmed lazily on each check.
 * - This is suitable for a single-instance deployment. For horizontal scale, replace
 *   with Redis or a reverse-proxy limiter such as Render's rate-limiting rules.
 */

import { getClientIp } from "./clientIp";

type Entry = {
  requests: number[]; // timestamps in ms
};

const buckets = new Map<string, Entry>();
const MAX_BUCKET_SIZE = 200;

function pruneBucket(entry: Entry, windowMs: number, now: number) {
  const cutoff = now - windowMs;
  entry.requests = entry.requests.filter((ts) => ts > cutoff);
}

export function checkRateLimit(
  req: Request,
  procedure: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const clientIp = getClientIp(req);
  // Use per-request identifier for unknown callers instead of a global shared bucket.
  const key = clientIp ? `${clientIp}::${procedure}` : `${crypto.randomUUID()}::${procedure}`;
  let entry = buckets.get(key);
  if (!entry) {
    entry = { requests: [] };
    buckets.set(key, entry);
  }
  pruneBucket(entry, windowMs, now);

  if (entry.requests.length >= maxRequests) {
    const oldest = entry.requests[0] ?? now - windowMs;
    return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
  }

  entry.requests.push(now);
  if (entry.requests.length > MAX_BUCKET_SIZE) {
    entry.requests = entry.requests.slice(-MAX_BUCKET_SIZE);
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimitForTests() {
  buckets.clear();
}
