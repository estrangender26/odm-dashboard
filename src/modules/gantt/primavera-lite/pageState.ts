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
