/**
 * Simple in-memory sliding-window rate limiter for public Gantt endpoints.
 *
 * - Keys are caller/route scoped (e.g., IP + procedure).
 * - Windows are approximate; the map is trimmed lazily on each check.
 * - This is suitable for a single-node deployment. For horizontal scale,
 *   replace with Redis or a reverse-proxy limiter.
 */

type Entry = {
  requests: number[]; // timestamps in ms
};

const buckets = new Map<string, Entry>();
const MAX_BUCKET_SIZE = 1000;

function pruneBucket(entry: Entry, windowMs: number, now: number) {
  const cutoff = now - windowMs;
  entry.requests = entry.requests.filter((ts) => ts > cutoff);
}

function getClientKey(req: Request, procedure: string): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return `${ip}::${procedure}`;
}

export function checkRateLimit(
  req: Request,
  procedure: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const key = getClientKey(req, procedure);
  let entry = buckets.get(key);
  if (!entry) {
    entry = { requests: [] };
    buckets.set(key, entry);
  }
  pruneBucket(entry, windowMs, now);

  if (entry.requests.length >= maxRequests) {
    const oldest = entry.requests[0] ?? now - windowMs;
    return { allowed: false, retryAfterMs: windowMs - (now - oldest) };
  }

  entry.requests.push(now);
  if (entry.requests.length > MAX_BUCKET_SIZE) {
    // Defensive trim to prevent unbounded memory growth.
    entry.requests = entry.requests.slice(-MAX_BUCKET_SIZE);
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(req: Request, procedure: string) {
  const key = getClientKey(req, procedure);
  buckets.delete(key);
}
