import { describe, it, expect } from "vitest";
import {
  addRememberedLink,
  computeRolePermissions,
  extractTokenFromUrl,
  isProjectUnavailable,
  readRememberedLinks,
  stripTokenPath,
  type RememberedLink,
  type StorageLike,
} from "./pageState";

function makeStorage(initial: Record<string, string> = {}): StorageLike {
  const store = { ...initial };
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

const linkA: RememberedLink = {
  slug: "project-a",
  name: "Project A",
  adminUrl: "https://example.com/gantt/p/project-a?access=admin-token-a",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const linkB: RememberedLink = {
  slug: "project-b",
  name: "Project B",
  adminUrl: "https://example.com/gantt/p/project-b?access=admin-token-b",
  createdAt: "2026-08-02T00:00:00.000Z",
};

describe("pageState helpers", () => {
  it("reads empty links when storage is empty", () => {
    expect(readRememberedLinks(makeStorage())).toEqual([]);
  });

  it("reads valid remembered links", () => {
    const storage = makeStorage({
      "primavera-lite-admin-links": JSON.stringify([linkA, linkB]),
    });
    expect(readRememberedLinks(storage)).toEqual([linkA, linkB]);
  });

  it("ignores corrupt storage", () => {
    const storage = makeStorage({ "primavera-lite-admin-links": "not-json" });
    expect(readRememberedLinks(storage)).toEqual([]);
  });

  it("adds a new remembered link to the front", () => {
    const storage = makeStorage();
    const result = addRememberedLink(storage, linkA);
    expect(result).toEqual([linkA]);
    expect(readRememberedLinks(storage)).toEqual([linkA]);
  });

  it("moves an existing link to the front and deduplicates", () => {
    const storage = makeStorage({
      "primavera-lite-admin-links": JSON.stringify([linkA, linkB]),
    });
    const updated: RememberedLink = { ...linkA, name: "Updated A" };
    const result = addRememberedLink(storage, updated);
    expect(result).toEqual([updated, linkB]);
  });

  it("caps remembered links at 50", () => {
    const many = Array.from({ length: 55 }, (_, i) => ({
      slug: `project-${i}`,
      name: `Project ${i}`,
      adminUrl: `https://example.com/gantt/p/project-${i}?access=t${i}`,
      createdAt: "2026-08-01T00:00:00.000Z",
    }));
    const storage = makeStorage({
      "primavera-lite-admin-links": JSON.stringify(many),
    });
    const result = addRememberedLink(storage, many[0], 50);
    expect(result).toHaveLength(50);
  });

  it("extracts admin token from a link", () => {
    expect(extractTokenFromUrl(linkA.adminUrl)).toBe("admin-token-a");
  });

  it("returns null for a link without a token", () => {
    expect(extractTokenFromUrl("https://example.com/gantt/p/project-a")).toBeNull();
  });

  it("strips token from the visible project path", () => {
    expect(stripTokenPath("/gantt/p/project-a?access=admin-token", "project-a")).toBe(
      "/gantt/p/project-a"
    );
  });

  it("grants admin full permissions", () => {
    expect(computeRolePermissions("admin")).toEqual({ canEdit: true, isAdmin: true });
  });

  it("grants editor mutation but not admin permissions", () => {
    expect(computeRolePermissions("editor")).toEqual({ canEdit: true, isAdmin: false });
  });

  it("grants viewer no edit permissions", () => {
    expect(computeRolePermissions("viewer")).toEqual({ canEdit: false, isAdmin: false });
  });

  it("treats unknown roles as read-only", () => {
    expect(computeRolePermissions(undefined)).toEqual({ canEdit: false, isAdmin: false });
    expect(computeRolePermissions("guest")).toEqual({ canEdit: false, isAdmin: false });
  });

  it("marks project unavailable when archived", () => {
    expect(isProjectUnavailable({ archivedAt: new Date() })).toBe(true);
    expect(isProjectUnavailable({ archivedAt: "2026-08-01T00:00:00Z" })).toBe(true);
  });

  it("marks project unavailable when there is an error", () => {
    expect(isProjectUnavailable({ archivedAt: null }, new Error("fail"))).toBe(true);
  });

  it("marks project unavailable when project is missing", () => {
    expect(isProjectUnavailable(null)).toBe(true);
    expect(isProjectUnavailable(undefined)).toBe(true);
  });

  it("does not mark active project unavailable", () => {
    expect(isProjectUnavailable({ archivedAt: null })).toBe(false);
  });
});
