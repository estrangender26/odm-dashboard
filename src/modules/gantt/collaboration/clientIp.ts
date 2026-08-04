/**
 * clientIp.ts — trusted client IP extraction for ODM Primavera Lite public endpoints.
 *
 * Deployment target: Render (https://render.com).
 *
 * Trusted headers
 * ---------------
 * Render terminates TLS at its edge and forwards requests to the running service.
 * For every request it sets:
 *   - X-Forwarded-For:  the original client IP, followed by any intermediate proxies,
 *                      with Render's own router appended as the rightmost value.
 *   - X-Forwarded-Proto: the original request scheme (http or https).
 *
 * Because traffic reaches the application only through Render's router, the leftmost
 * value of X-Forwarded-For is the real client IP in the default Render configuration.
 * If you place an additional trusted proxy (e.g., Cloudflare) in front of Render,
 * set TRUSTED_PROXY_CIDRS to the IP ranges of that proxy. The helper then walks
 * X-Forwarded-For from right to left and returns the first IP that is NOT inside a
 * trusted CIDR; that IP is the client that originated the request.
 *
 * Multiple proxy hops
 * ---------------------
 * Without TRUSTED_PROXY_CIDRS:
 *   - The first (leftmost) value is returned. This is correct for Render-only
 *     deployments but can be spoofed if an untrusted proxy sits in front of Render.
 * With TRUSTED_PROXY_CIDRS:
 *   - The helper returns the IP immediately to the left of the trusted proxy chain.
 *   - Values to the left of that are treated as possibly spoofed and ignored.
 *
 * No trusted client IP
 * --------------------
 * If no X-Forwarded-For header exists and no other trusted header is configured,
 * the function returns `null`. Callers must decide how to handle unknown clients.
 * The rate limiter does NOT put all unknown callers into a single shared bucket;
 * instead it falls back to a per-request identifier (rate limiting is effectively
 * disabled for those calls). Production should ensure Render always sends the header.
 *
 * Limitations
 * -----------
 * - This helper parses headers only; it does not validate against a live proxy list.
 * - It does not support IPv6 CIDR matching (contributions welcome when needed).
 * - For multi-instance deployments, the in-memory rate limiter is per-process; use
 *   a Redis-backed limiter or a reverse-proxy limiter for cluster-wide enforcement.
 */

function isPrivateOrTrustedIP(ip: string, cidrs: string[]): boolean {
  // Very small CIDR matcher for IPv4.
  const [addr] = ip.split("/");
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  for (const cidr of cidrs) {
    const [net, bitsStr] = cidr.split("/");
    const bits = Number(bitsStr);
    if (Number.isNaN(bits)) continue;
    const netParts = net.split(".").map(Number);
    if (netParts.length !== 4) continue;
    let match = true;
    for (let i = 0; i < Math.floor(bits / 8); i++) {
      if (parts[i] !== netParts[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function getTrustedProxyCidrs(): string[] {
  const env = process.env.TRUSTED_PROXY_CIDRS;
  if (!env) return [];
  return env
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return null;

  const ips = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ips.length === 0) return null;

  const cidrs = getTrustedProxyCidrs();

  // No explicit trusted proxy CIDRs: trust the leftmost value (Render default).
  if (cidrs.length === 0) {
    return ips[0] ?? null;
  }

  // Walk from right to left, skipping trusted proxies. Return the first untrusted IP.
  for (let i = ips.length - 1; i >= 0; i--) {
    if (!isPrivateOrTrustedIP(ips[i], cidrs)) {
      return ips[i];
    }
  }

  // All values were inside trusted ranges; fall back to leftmost as a last resort.
  return ips[0] ?? null;
}
