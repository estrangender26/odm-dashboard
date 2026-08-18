// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityGridRow } from "./activityGridModel";
import type { DependencyRow } from "./dependencyModel";

interface CapturedRestore {
  slug?: string;
  access?: string;
  expectedRevision?: number;
  dependencyId?: number;
  confirmed?: boolean;
}

const captured: {
  restore: CapturedRestore[];
  listQueries: { input: unknown; enabled: boolean | undefined }[];
  setData: unknown[];
  invalidations: number;
  revisions: number[];
  refreshes: number;
} = { restore: [], listQueries: [], setData: [], invalidations: 0, revisions: [], refreshes: 0 };

/** Controls whether the mocked restoreDependency mutation succeeds or fails. */
let restoreFailure: { message: string; code: string } | null = null;

const ARCHIVED_AT = "2026-08-15T00:00:00.000Z";
const activeDependency: DependencyRow = { id: 10, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0, revision: 1, archivedAt: null };
const archivedDependency: DependencyRow = { id: 11, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "SS", lagDays: 2, revision: 3, archivedAt: ARCHIVED_AT };

vi.mock("@/providers/trpc", () => {
  const utils = {
    primaveraLite: {
      load: {
        setData: (_input: unknown, updater: unknown) => { captured.setData.push(updater); },
        getData: () => undefined,
        cancel: async () => undefined,
      },
      listDependencies: {
        invalidate: async () => { captured.invalidations += 1; },
      },
    },
  };
  return {
    trpc: {
      Provider: ({ children }: { children: ReactNode }) => children,
      useUtils: () => utils,
      primaveraLite: new Proxy(
        {},
        {
          get(_target: unknown, prop: string) {
            if (prop === "useUtils") return () => utils;
            if (prop === "listDependencies") {
              return {
                useQuery: (input: unknown, opts?: { enabled?: boolean }) => {
                  captured.listQueries.push({ input, enabled: opts?.enabled });
                  if (!opts?.enabled) return { data: undefined, isLoading: false, error: null, refetch: async () => ({}) };
                  return { data: { dependencies: [activeDependency, archivedDependency], revision: 7 }, isLoading: false, error: null, refetch: async () => ({}) };
                },
              };
            }
            if (prop === "restoreDependency") {
              return {
                useMutation: (opts?: {
                  onSuccess?: (result: { dependency: DependencyRow; revision: number }) => void;
                  onError?: (error: { message: string; data?: { code: string } }) => void;
                }) => {
                  const [isPending] = useState(false);
                  const mutate = (input: CapturedRestore) => {
                    captured.restore.push(input);
                    if (restoreFailure) opts?.onError?.({ message: restoreFailure.message, data: { code: restoreFailure.code } });
                    else opts?.onSuccess?.({ dependency: { ...archivedDependency, archivedAt: null, revision: 4 }, revision: 8 });
                  };
                  return { isPending, error: null, mutate, mutateAsync: async (input: CapturedRestore) => mutate(input) };
                },
              };
            }
            if (prop === "archiveDependencyDryRun") return { useMutation: () => ({ mutateAsync: async () => ({ previewToken: "preview-token" }) }) };
            return { useQuery: () => ({ data: undefined, isLoading: false, error: null, refetch: async () => ({}) }), useMutation: () => ({ isPending: false, error: null, mutate: () => undefined, mutateAsync: async () => ({}) }) };
          },
        }
      ),
    },
  };
});

import DependencyPanel from "./DependencyPanel";

const activities = [
  { id: 1, wbsNodeId: 1, sortOrder: 0, activityId: "A", activityName: "Activity A", originalDurationDays: 1, calendarId: null, percentComplete: 0 },
  { id: 2, wbsNodeId: 1, sortOrder: 1, activityId: "B", activityName: "Activity B", originalDurationDays: 1, calendarId: null, percentComplete: 0 },
] as unknown as ActivityGridRow[];

function renderPanel(role: "admin" | "editor" | "viewer") {
  return render(
    <DependencyPanel
      slug="p1"
      access="tok"
      role={role}
      expectedRevision={7}
      activities={activities}
      dependencies={[activeDependency]}
      onRevisionChange={(revision) => captured.revisions.push(revision)}
      onRefresh={() => { captured.refreshes += 1; }}
    />
  );
}

async function showArchived() {
  await userEvent.click(screen.getByRole("button", { name: "Show archived" }));
  return screen.getByText("(archived)").closest("tr")!;
}

describe("DependencyPanel archived dependencies and restore", () => {
  beforeEach(() => {
    captured.restore = [];
    captured.listQueries = [];
    captured.setData = [];
    captured.invalidations = 0;
    captured.revisions = [];
    captured.refreshes = 0;
    restoreFailure = null;
  });
  afterEach(cleanup);

  it("hides archived dependencies by default and does not fetch them", () => {
    renderPanel("editor");
    expect(screen.queryByText("(archived)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show archived" })).toBeInTheDocument();
    // The archived listing query stays disabled until the user opts in.
    expect(captured.listQueries.every((query) => query.enabled === false)).toBe(true);
  });

  it("Show archived fetches includeArchived=true and reveals a visually distinct row", async () => {
    renderPanel("editor");
    const row = await showArchived();
    expect(captured.listQueries.some((query) => query.enabled === true)).toBe(true);
    expect(captured.listQueries.at(-1)?.input).toEqual({ slug: "p1", access: "tok", includeArchived: true });
    expect(row).toHaveAttribute("data-archived", "true");
    expect(within(row).getByText("SS")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();
    // Active dependency 10 from the archived listing is not duplicated as an archived row.
    expect(screen.getAllByText("(archived)")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Hide archived" })).toBeInTheDocument();
  });

  it("archived rows are read-only: no edit controls and no re-archive control", async () => {
    renderPanel("editor");
    const row = await showArchived();
    expect(within(row).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(row).queryAllByRole("spinbutton")).toHaveLength(0);
    expect(within(row).queryByRole("button", { name: /Archive dependency/ })).not.toBeInTheDocument();
    // The active row keeps its editable controls untouched.
    expect(screen.getByLabelText("Type for dependency 10")).toBeInTheDocument();
  });

  it("shows Restore for editor and admin, never for viewer", async () => {
    renderPanel("editor");
    let row = await showArchived();
    expect(within(row).getByRole("button", { name: "Restore dependency 11" })).toBeInTheDocument();
    cleanup();
    renderPanel("admin");
    row = await showArchived();
    expect(within(row).getByRole("button", { name: "Restore dependency 11" })).toBeInTheDocument();
    cleanup();
    renderPanel("viewer");
    row = await showArchived();
    expect(within(row).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });

  it("restore sends the exact restoreDependency payload and refreshes authoritative data", async () => {
    renderPanel("editor");
    const row = await showArchived();
    await userEvent.click(within(row).getByRole("button", { name: "Restore dependency 11" }));
    expect(captured.restore).toEqual([{ slug: "p1", access: "tok", expectedRevision: 7, dependencyId: 11, confirmed: true }]);
    // Success path: revision propagated, load cache updated with the server row, archived listing invalidated.
    expect(captured.revisions).toEqual([8]);
    expect(captured.setData.length).toBeGreaterThan(0);
    expect(captured.invalidations).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("failed restore keeps the row archived, surfaces the error and never applies an optimistic state", async () => {
    restoreFailure = { message: "Duplicate active dependency", code: "CONFLICT" };
    renderPanel("editor");
    const row = await showArchived();
    await userEvent.click(within(row).getByRole("button", { name: "Restore dependency 11" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Duplicate active dependency");
    expect(screen.getByText("(archived)")).toBeInTheDocument();
    expect(captured.revisions).toEqual([]);
    expect(captured.setData).toHaveLength(0);
    expect(captured.invalidations).toBe(0);
    // CONFLICT triggers an authoritative refresh, matching update/archive semantics.
    expect(captured.refreshes).toBe(1);
  });
});
