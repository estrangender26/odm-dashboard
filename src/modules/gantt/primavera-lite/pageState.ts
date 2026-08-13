export interface RememberedLink {
  slug: string;
  name: string;
  adminUrl: string;
  createdAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readRememberedLinks(storage: StorageLike): RememberedLink[] {
  try {
    const raw = storage.getItem("primavera-lite-admin-links");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is RememberedLink =>
        l && typeof l.slug === "string" && typeof l.adminUrl === "string"
    );
  } catch {
    return [];
  }
}

export function addRememberedLink(
  storage: StorageLike,
  link: RememberedLink,
  max = 50
): RememberedLink[] {
  const existing = readRememberedLinks(storage);
  const filtered = existing.filter((l) => l.slug !== link.slug);
  const next = [link, ...filtered].slice(0, max);
  storage.setItem("primavera-lite-admin-links", JSON.stringify(next));
  return next;
}

export function extractTokenFromUrl(url: string): string | null {
  try {
    // createProject returns relative links such as /gantt/p/:slug?access=:token.
    // new URL() requires an absolute URL, so we resolve against a safe origin
    // and then read the access query parameter.
    const resolved = new URL(url, "http://localhost");
    return resolved.searchParams.get("access");
  } catch {
    return null;
  }
}

export function stripTokenPath(_pathWithSearch: string, slug: string): string {
  return `/gantt/p/${slug}`;
}

const ACCESS_TOKEN_KEY_PREFIX = "primavera-lite-access:";

function accessTokenKey(slug: string): string {
  return `${ACCESS_TOKEN_KEY_PREFIX}${slug}`;
}

/**
 * Persist the active project access token in sessionStorage, keyed by slug.
 * Storage failures (private browsing, quota, blocked storage) are tolerated
 * silently; the token remains usable from the current URL/memory.
 */
export function persistAccessToken(
  storage: StorageLike,
  slug: string,
  token: string
): void {
  if (!token) return;
  try {
    storage.setItem(accessTokenKey(slug), token);
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Read a previously persisted access token for a project slug.
 * Returns null when absent, empty, or when storage is unavailable/corrupt.
 */
export function readAccessToken(
  storage: StorageLike,
  slug: string
): string | null {
  try {
    const raw = storage.getItem(accessTokenKey(slug));
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective access token for a project slug.
 * A token supplied by the current URL always takes precedence over a stored token.
 */
export function resolveAccessToken(
  urlAccess: string,
  storage: StorageLike,
  slug: string
): string {
  if (urlAccess) return urlAccess;
  return readAccessToken(storage, slug) ?? "";
}

export function computeRolePermissions(role: string | undefined): {
  canEdit: boolean;
  isAdmin: boolean;
} {
  return {
    canEdit: role === "admin" || role === "editor",
    isAdmin: role === "admin",
  };
}

export function isProjectUnavailable(
  project: { archivedAt?: Date | string | null } | null | undefined,
  error?: unknown
): boolean {
  if (error) return true;
  if (!project) return true;
  if (project.archivedAt) return true;
  return false;
}
