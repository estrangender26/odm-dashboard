import { env } from "./env";
import { Paths } from "@contracts/constants";

/**
 * Canonical PUBLIC origin resolution for OAuth redirects.
 *
 * Problem: behind Render's reverse proxy the application receives the original
 * request forwarded over plain HTTP internally, so `request.url` yields
 * `http://odm-dashboard.onrender.com/...` even though the public URL is HTTPS.
 * Google rejects the callback with `redirect_uri_mismatch` unless every step
 * of the OAuth flow uses the EXACT public HTTPS callback URI.
 *
 * Trust model (narrowest safe implementation):
 * 1. PUBLIC_APP_URL (explicit operator configuration) wins when set — it
 *    cannot be spoofed by any request header.
 * 2. Production (no PUBLIC_APP_URL): the scheme comes from the RIGHTMOST value
 *    of the X-Forwarded-Proto chain (Render's edge appends/overwrites it;
 *    client-supplied leading values are ignored) and must be exactly "https".
 *    The host comes ONLY from the Host header — Render's edge validates the
 *    Host against the service's registered domains before the request reaches
 *    the app, so an arbitrary attacker-controlled Host cannot be routed here;
 *    the client-spoofable X-Forwarded-Host header is never read. The resolved
 *    host is additionally validated (public hostname shape, no IP/private
 *    TLDs) as defense in depth. Any other combination fails closed.
 * 3. Development: fall back to the request URL origin, preserving
 *    http://localhost:PORT behavior.
 */

function lastChainValue(header: string | null): string | null {
  if (!header) return null;
  const parts = header
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Validates a host (optionally with a port) as a plausible public hostname.
 * Rejects schemes/paths/userinfo, IP literals, bare names, and private
 * pseudo-TLDs (local/localhost/internal/lan/home/corp).
 */
export function isValidPublicHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  const match = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?::[0-9]{1,5})?$/.exec(
    host,
  );
  if (!match) return false;

  const hostname = host.split(":")[0].toLowerCase();
  if (hostname.includes("..")) return false;

  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => !label || label.length > 63)) return false;

  // Reject IP literals (IPv4 dotted quad, IPv6 colons).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  if (hostname.includes(":")) return false;

  const privateTlds = new Set([
    "local",
    "localhost",
    "internal",
    "lan",
    "home",
    "corp",
  ]);
  if (privateTlds.has(labels[labels.length - 1])) return false;

  return true;
}

/**
 * Resolves the canonical public origin for a request.
 * Throws when a trusted origin cannot be determined (production, no
 * PUBLIC_APP_URL, missing/invalid forwarded scheme or host).
 */
export function getPublicOrigin(request: Request): string {
  // 1. Explicit operator configuration — highest trust, never spoofable.
  if (env.publicUrl) {
    return env.publicUrl.replace(/\/+$/, "");
  }

  if (env.isProduction) {
    // 2. Trusted reverse-proxy information.
    const proto = lastChainValue(request.headers.get("x-forwarded-proto"));
    const host = request.headers.get("host") ?? "";
    if (proto === "https" && isValidPublicHostname(host)) {
      // Strip any port; Render's public host has none.
      return `https://${host.split(":")[0]}`;
    }
    throw new Error(
      "Unable to resolve a trusted public origin for OAuth (missing https X-Forwarded-Proto or invalid host). Configure PUBLIC_APP_URL if this deployment's proxy is not Render.",
    );
  }

  // 3. Development — request URL origin (http://localhost:PORT).
  return new URL(request.url).origin;
}

/**
 * The canonical OAuth callback redirect URI for a request. This exact value is
 * used for the Google authorization redirect_uri, the signed state binding,
 * the callback's expected-URI validation, and the token-exchange redirect_uri,
 * so the four values can never disagree.
 */
export function getOAuthRedirectUri(request: Request): string {
  return `${getPublicOrigin(request)}${Paths.oauthCallback}`;
}
