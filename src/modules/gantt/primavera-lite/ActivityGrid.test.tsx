// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityGridRow } from "./activityGridModel";

interface CapturedMutation {
  activityId?: number;
  expectedRevision?: number;
  slug?: string;
  access?: string;
  actorName?: string;
  previewToken?: string;
  confirmed?: boolean;
}

const captured: {
  archive: CapturedMutation[];
  restore: CapturedMutation[];
} = {
  archive: [],
  restore: [],
};

function createMutationStub(bucket: CapturedMutation[]) {
  return () => {
    const [isPending] = useState(false);
    const [error] = useState<null | Error>(null);
    const mutate = (input: CapturedMutation) => {
      bucket.push(input);
    };
    const mutateAsync = async (input: CapturedMutation) => {
      bucket.push(input);
      return { previewToken: "preview-token" };
    };
    return { isPending, error, mutate, mutateAsync };
  };
}

function createRestoreMutationStub(bucket: CapturedMutation[], hasArchivedDependencies = false) {
  return (options?: { onSuccess?: (result: { hasArchivedDependencies: boolean }) => void }) => {
    const [isPending] = useState(false);
    const [error] = useState<null | Error>(null);
    const mutate = (input: CapturedMutation) => {
      bucket.push(input);
      options?.onSuccess?.({ hasArchivedDependencies });
    };
    const mutateAsync = async (input: CapturedMutation) => {
      bucket.push(input);
      return { hasArchivedDependencies };
    };
    return { isPending, error, mutate, mutateAsync };
  };
}

function queryStub() {
  return { data: undefined, isLoading: false, error: null, refetch: async () => ({}) };
}

vi.mock("@/providers/trpc", () => {
  return {
    trpc: {
      Provider: ({ children }: { children: ReactNode }) => children,
      primaveraLite: new Proxy(
        {},
        {
          get(_target: unknown, prop: string) {
            if (prop === "useUtils") {
              return () => ({
                primaveraLite: {
                  load: {
                    setData: () => undefined,
                    getData: () => undefined,
                    cancel: async () => undefined,
                  },
                },
              });
            }
            if (prop === "archiveActivityDryRun") {
              return { useMutation: () => ({ mutateAsync: async () => ({ previewToken: "preview-token" }) }) };
            }
            if (prop === "archiveActivity") return { useMutation: createMutationStub(captured.archive) };
            if (prop === "restoreActivity") return { useMutation: createRestoreMutationStub(captured.restore, true) };
            if (prop === "createActivity") return { useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => ({}) }) };
            if (prop === "editActivity") return { useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => ({}) }) };
            if (prop === "reorderActivity") return { useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => ({}) }) };
            if (prop === "load") return { useQuery: queryStub };
            return { useQuery: queryStub, useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => ({}) }) };
          },
        }
      ),
      useUtils: () => ({
        primaveraLite: {
          load: { setData: () => undefined, getData: () => undefined, cancel: async () => undefined },
        },
      }),
    },
  };
});

import ActivityGrid from "./ActivityGrid";

const wbsNodes = [
  { id: 1, code: "1", name: "Root", isLeaf: true, archivedAt: null },
];

const calendars: { id: number; name: string }[] = [];

function makeRow(id: number, overrides?: Partial<ActivityGridRow>): ActivityGridRow {
  return {
    id,
    activityId: `A-${id}`,
    activityName: `Activity ${id}`,
    wbsNodeId: 1,
    plannedStart: null,
    plannedFinish: null,
    actualStart: null,
    actualFinish: null,
    originalDurationDays: 5,
    percentComplete: 0,
    calendarId: null,
    earlyStart: null,
    earlyFinish: null,
    lateStart: null,
    lateFinish: null,
    totalFloatDays: null,
    archivedAt: null,
    sortOrder: id,
    ...overrides,
  };
}

const activeRow = makeRow(1);
const archivedRow = makeRow(2, { activityName: "Archived Activity", archivedAt: "2026-08-01T00:00:00Z" });

function renderGrid(role: "admin" | "editor" | "viewer", activities: ActivityGridRow[] = [activeRow, archivedRow]) {
  return render(
    <ActivityGrid
      slug="test-project"
      access="test-token"
      role={role}
      expectedRevision={3}
      activities={activities}
      wbsNodes={wbsNodes}
      calendars={calendars}
      onRevisionChange={() => undefined}
      onRefresh={async () => undefined}
      onEditingChange={() => undefined}
    />
  );
}

function rowByName(name: string) {
  const cell = screen.getByText(name);
  return within(cell.closest("tr")!);
}

async function showArchived() {
  const toggle = screen.getByLabelText(/Show archived/i);
  await userEvent.click(toggle);
}

describe("ActivityGrid restore", () => {
  beforeEach(() => {
    captured.archive.length = 0;
    captured.restore.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the archived toggle only when archived activities exist", () => {
    renderGrid("editor", [activeRow]);
    expect(screen.queryByLabelText(/Show archived/i)).not.toBeInTheDocument();
  });

  it("toggles visibility of archived rows", async () => {
    renderGrid("editor");
    const toggle = screen.getByLabelText(/Show archived/i);
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByText("Archived Activity")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByText("Archived Activity")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Archived Activity")).not.toBeInTheDocument();
  });

  it("renders archived rows as read-only spans instead of inputs", async () => {
    renderGrid("editor");
    await showArchived();
    const archived = rowByName("Archived Activity");
    // The activityId and activityName cells for an archived row should not contain inputs.
    expect(archived.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("disables drag for archived rows", async () => {
    renderGrid("editor");
    await showArchived();
    const archivedRow = screen.getByText("Archived Activity").closest("tr")!;
    expect(archivedRow).toHaveAttribute("draggable", "false");
  });

  it("shows restore button and hides archive button for archived rows when editor", async () => {
    renderGrid("editor");
    await showArchived();
    const archived = rowByName("Archived Activity");
    expect(archived.getByRole("button", { name: /Restore Archived Activity/i })).toBeInTheDocument();
    expect(archived.queryByRole("button", { name: /Archive Archived Activity/i })).not.toBeInTheDocument();
  });

  it("hides archive and restore buttons for viewer but keeps archived toggle", () => {
    renderGrid("viewer");
    expect(screen.queryByRole("button", { name: /Archive Activity 1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore Archived Activity/i })).not.toBeInTheDocument();
    // Viewers can still toggle visibility of archived rows for read-only inspection.
    expect(screen.getByLabelText(/Show archived/i)).toBeInTheDocument();
  });

  it("clicking restore sends the correct mutation payload", async () => {
    renderGrid("editor");
    await showArchived();
    await userEvent.click(screen.getByRole("button", { name: /Restore Archived Activity/i }));
    expect(captured.restore).toHaveLength(1);
    expect(captured.restore[0]).toMatchObject({
      slug: "test-project",
      access: "test-token",
      expectedRevision: 3,
      activityId: 2,
    });
  });

  it("shows a non-blocking message when restored activity has archived dependencies", async () => {
    renderGrid("editor");
    await showArchived();
    await userEvent.click(screen.getByRole("button", { name: /Restore Archived Activity/i }));
    expect(screen.getByText("Activity restored. Archived dependencies remain archived.")).toBeInTheDocument();
  });

  it("shows archive button for active rows when editor", () => {
    renderGrid("editor");
    const active = rowByName("Activity 1");
    expect(active.getByRole("button", { name: /Archive Activity 1/i })).toBeInTheDocument();
    expect(active.queryByRole("button", { name: /Restore Activity 1/i })).not.toBeInTheDocument();
  });
});
