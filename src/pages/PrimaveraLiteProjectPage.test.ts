import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Page-level regression test for the Primavera Lite reload/viewer access
 * defect. Renders the real PrimaveraLiteProjectPage through react-dom/server
 * (the same lightweight, Node-compatible technique used by Timeline.test.ts
 * and DependencyPanel.test.ts) and asserts that the recovered access token is
 * wired into the actual `primaveraLite.load.useQuery` call and that role
 * separation drives the rendered controls.
 *
 * The tRPC provider and react-router's useSearchParams are mocked; the
 * component under test and all of its children are real.
 */

// Hoisted, mutable state shared between the test cases and the module mocks.
const h = vi.hoisted(() => ({
  accessParam: "",
  loadInput: null as { slug: string; access: string; includeArchived?: boolean } | null,
  loadResult: {
    data: undefined as unknown,
    isLoading: false,
    error: null as unknown,
  },
}));

vi.mock("react-router", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams();
    if (h.accessParam) params.set("access", h.accessParam);
    return [params, () => undefined];
  },
}));

vi.mock("@/providers/trpc", () => {
  const queryStub = () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: async () => ({}),
  });
  const mutationStub = () => ({
    isPending: false,
    error: null,
    mutate: () => undefined,
    mutateAsync: async () => ({}),
  });
  const load = {
    useQuery: (input: { slug: string; access: string }) => {
      h.loadInput = input;
      return h.loadResult;
    },
  };
  // Every other primaveraLite procedure resolves to benign stubs so the
  // child components (WbsTree, ActivityGrid, DependencyPanel) render safely.
  const primaveraLite = new Proxy(
    { load },
    {
      get(target, prop) {
        if (prop === "load") return target.load;
        return { useQuery: queryStub, useMutation: mutationStub };
      },
    }
  );
  return {
    trpc: {
      primaveraLite,
      useUtils: () => ({
        primaveraLite: {
          load: {
            setData: () => undefined,
            getData: () => undefined,
            cancel: async () => undefined,
          },
        },
      }),
    },
  };
});

import PrimaveraLiteProjectPage from "./PrimaveraLiteProjectPage";

const SLUG = "project-a";

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function makeSessionStorage(entries: Record<string, string> = {}): FakeStorage {
  const store = { ...entries };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

const LOADED_FIXTURE = {
  role: "viewer",
  project: {
    name: "PR7 Production Smoke",
    slug: SLUG,
    dataDate: null,
    lastScheduledAt: null,
    archivedAt: null,
    revision: 1,
  },
  revision: 1,
  wbsNodes: [],
  activities: [],
  dependencies: [],
  calendars: [],
  events: [],
};

function renderPage(urlAccess: string, sessionStorage: FakeStorage, loadResult = h.loadResult) {
  h.accessParam = urlAccess;
  h.loadInput = null;
  h.loadResult = loadResult;
  (globalThis as Record<string, unknown>).window = {
    location: { pathname: `/gantt/p/${SLUG}` },
    history: { replaceState: () => undefined },
  };
  (globalThis as Record<string, unknown>).sessionStorage = sessionStorage;
  return renderToStaticMarkup(createElement(PrimaveraLiteProjectPage));
}

beforeEach(() => {
  h.accessParam = "";
  h.loadInput = null;
  h.loadResult = { data: undefined, isLoading: false, error: null };
});

describe("PrimaveraLiteProjectPage access-token wiring (reload/viewer regression)", () => {
  it("captures a ?access= token on first navigation and passes it to the load query", () => {
    renderPage("admin-token", makeSessionStorage(), {
      data: undefined,
      isLoading: true,
      error: null,
    });
    expect(h.loadInput).toEqual({ slug: SLUG, access: "admin-token", includeArchived: true });
  });

  it("recovers the token from sessionStorage on reload with no ?access=", () => {
    const storage = makeSessionStorage({
      "primavera-lite-access:project-a": "admin-token",
    });
    renderPage("", storage, { data: undefined, isLoading: true, error: null });
    expect(h.loadInput).toEqual({ slug: SLUG, access: "admin-token", includeArchived: true });
  });

  it("wires the recovered token into the real load path, not merely resolveAccessToken", () => {
    const storage = makeSessionStorage({
      "primavera-lite-access:project-a": "admin-token",
    });
    // Render with the loaded (non-loading) state so the real render path runs.
    renderPage("", storage, {
      data: { ...LOADED_FIXTURE, role: "admin" },
      isLoading: false,
      error: null,
    });
    // The exact object handed to primaveraLite.load.useQuery carries the
    // recovered token and slug — this is the page's actual load wiring.
    expect(h.loadInput).toEqual({ slug: SLUG, access: "admin-token", includeArchived: true });
  });

  it("gives a URL token precedence over an older stored token", () => {
    const storage = makeSessionStorage({
      "primavera-lite-access:project-a": "stale-token",
    });
    renderPage("fresh-token", storage, {
      data: undefined,
      isLoading: true,
      error: null,
    });
    expect(h.loadInput).toEqual({ slug: SLUG, access: "fresh-token", includeArchived: true });
  });

  it("viewer token recovery renders the read-only (viewer) experience", () => {
    const storage = makeSessionStorage({
      "primavera-lite-access:project-a": "viewer-token",
    });
    const html = renderPage("", storage, {
      data: { ...LOADED_FIXTURE, role: "viewer" },
      isLoading: false,
      error: null,
    });
    expect(h.loadInput?.access).toBe("viewer-token");
    expect(html).toContain("Role: viewer");
    // No admin/edit controls are rendered for a viewer.
    expect(html).not.toContain("Set Data Date");
    expect(html).not.toContain('aria-label="Project Data Date"');
    expect(html).not.toContain("Run Schedule");
    expect(html).not.toContain("Archive Project");
  });

  it("shows Schedule Out of Date to every role when the loaded schedule is stale", () => {
    const html = renderPage("", makeSessionStorage({ "primavera-lite-access:project-a": "viewer-token" }), {
      data: { ...LOADED_FIXTURE, project: { ...LOADED_FIXTURE.project, scheduleOutOfDate: true } },
      isLoading: false, error: null,
    });
    expect(html).toContain("Schedule Out of Date");
  });

  it("admin token recovery renders the admin (editable) experience", () => {
    const storage = makeSessionStorage({
      "primavera-lite-access:project-a": "admin-token",
    });
    const html = renderPage("", storage, {
      data: { ...LOADED_FIXTURE, role: "admin" },
      isLoading: false,
      error: null,
    });
    expect(h.loadInput?.access).toBe("admin-token");
    expect(html).toContain("Role: admin");
    expect(html).toContain("Set Data Date");
    expect(html).toContain('aria-label="Project Data Date"');
    expect(html).toContain("Run Schedule");
    expect(html).toContain("Archive Project");
  });

  it("with neither a URL token nor a stored token renders Project Unavailable", () => {
    const html = renderPage("", makeSessionStorage(), {
      data: undefined,
      isLoading: false,
      error: null,
    });
    expect(h.loadInput).toEqual({ slug: SLUG, access: "", includeArchived: true });
    expect(html).toContain("Project Unavailable");
  });
});
