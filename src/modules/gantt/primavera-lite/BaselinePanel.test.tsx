// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CapturedMutation {
  name?: string;
  description?: string;
  slug?: string;
  access?: string;
  expectedRevision?: number;
}

const captured: { capture: CapturedMutation[] } = { capture: [] };

let listBaselinesData:
  | { baselines: Array<{ id: number; name: string; activityCount: number; capturedAt: Date | null; capturedByName?: string | null }> }
  | undefined = undefined;
type ComparisonFixture = {
  snapshotId: number | null;
  activityId: number;
  activityCode: string | null;
  activityName: string;
  wbsNodeId: number | null;
  wbsCode: string | null;
  wbsName: string | null;
  baselineScheduledStart: string | null;
  baselineScheduledFinish: string | null;
  currentScheduledStart: string | null;
  currentScheduledFinish: string | null;
  startVariance: number | null;
  finishVariance: number | null;
  currentArchivedAt: Date | string | null;
  currentMissing: boolean;
  baselineDurationDays?: number | null;
  currentDurationDays?: number | null;
  durationVariance?: number | null;
  status?: "ahead" | "on-baseline" | "late" | "undated" | "removed" | "new-since-baseline";
  statusLabel?: string;
  statusSymbol?: string;
  hasBaseline?: boolean;
};

type ProjectFixture = {
  baselineStart: string | null;
  baselineFinish: string | null;
  currentStart: string | null;
  currentFinish: string | null;
  startVariance: number | null;
  finishVariance: number | null;
  baselineActivityCount: number;
  newSinceBaselineCount: number;
  removedSinceBaselineCount: number;
};

let compareBaselineData: {
  comparisons: ComparisonFixture[];
  newSinceBaseline?: ComparisonFixture[];
  project?: ProjectFixture;
} | undefined = undefined;
let compareBaselineError: Error | null = null;
const refetchCounts = { list: 0, compare: 0 };
let captureBaselineError: Error | null = null;

function createCaptureMutationStub(bucket: CapturedMutation[]) {
  return (options?: { onSuccess?: (result: { baseline: { id: number }; revision: number }) => void; onError?: (error: Error) => void }) => {
    const [isPending] = useState(false);
    const [error] = useState(captureBaselineError);
    const mutate = (input: CapturedMutation) => {
      bucket.push(input);
      if (captureBaselineError) {
        options?.onError?.(captureBaselineError);
      } else {
        options?.onSuccess?.({ baseline: { id: 42 }, revision: 5 });
      }
    };
    const mutateAsync = async (input: CapturedMutation) => {
      bucket.push(input);
      if (captureBaselineError) throw captureBaselineError;
      return { baseline: { id: 42 }, revision: 5 };
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
            if (prop === "listBaselines") {
              return {
                useQuery: () => ({
                  data: listBaselinesData,
                  isLoading: false,
                  error: null,
                  refetch: async () => {
                    refetchCounts.list += 1;
                    return {};
                  },
                }),
              };
            }
            if (prop === "compareBaseline") {
              return {
                useQuery: () => ({
                  data: compareBaselineData,
                  isLoading: false,
                  error: compareBaselineError,
                  refetch: async () => {
                    refetchCounts.compare += 1;
                    return {};
                  },
                }),
              };
            }
            if (prop === "captureBaseline") return { useMutation: createCaptureMutationStub(captured.capture) };
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

import BaselinePanel from "./BaselinePanel";

function renderPanel(role: "admin" | "editor" | "viewer") {
  return render(
    <BaselinePanel
      slug="test-project"
      access="test-token"
      role={role}
      expectedRevision={3}
      onRevisionChange={() => undefined}
      onRefresh={async () => undefined}
    />
  );
}

describe("BaselinePanel", () => {
  beforeEach(() => {
    captured.capture = [];
    refetchCounts.list = 0;
    refetchCounts.compare = 0;
    listBaselinesData = undefined;
    compareBaselineData = undefined;
    compareBaselineError = null;
    captureBaselineError = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows empty state for viewer when no baselines exist", () => {
    listBaselinesData = { baselines: [] };
    renderPanel("viewer");
    expect(screen.getByTestId("baseline-empty-state")).toHaveTextContent("No baselines have been captured yet.");
    expect(screen.queryByLabelText("Baseline name")).not.toBeInTheDocument();
  });

  it("shows empty state for editor when no baselines exist", () => {
    listBaselinesData = { baselines: [] };
    renderPanel("editor");
    expect(screen.getByTestId("baseline-empty-state")).toHaveTextContent("No baselines have been captured yet.");
    expect(screen.queryByLabelText("Baseline name")).not.toBeInTheDocument();
  });

  it("shows capture form for admin when no baselines exist", () => {
    listBaselinesData = { baselines: [] };
    renderPanel("admin");
    expect(screen.getByLabelText("Baseline name")).toBeInTheDocument();
    expect(screen.getByLabelText("Baseline description")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Capture Baseline/i })).toBeInTheDocument();
  });

  it("does not show capture form for editor", () => {
    listBaselinesData = { baselines: [] };
    renderPanel("editor");
    expect(screen.queryByLabelText("Baseline name")).not.toBeInTheDocument();
  });

  it("does not show capture form for viewer", () => {
    listBaselinesData = { baselines: [] };
    renderPanel("viewer");
    expect(screen.queryByLabelText("Baseline name")).not.toBeInTheDocument();
  });

  it("renders baseline list and allows selection", async () => {
    listBaselinesData = {
      baselines: [
        { id: 1, name: "Baseline Alpha", activityCount: 3, capturedAt: new Date("2026-08-01T00:00:00Z") },
        { id: 2, name: "Baseline Beta", activityCount: 5, capturedAt: new Date("2026-08-15T00:00:00Z") },
      ],
    };
    compareBaselineData = { comparisons: [] };
    renderPanel("viewer");

    expect(screen.getByText("Baseline Alpha")).toBeInTheDocument();
    expect(screen.getByText("Baseline Beta")).toBeInTheDocument();
    expect(screen.getByText("(3 activities)")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("baseline-select-2"));
    expect(screen.getByText("Comparison: Baseline Beta")).toBeInTheDocument();
  });

  it("renders comparison with variance values", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Baseline One", activityCount: 1, capturedAt: new Date("2026-08-01T00:00:00Z") }],
    };
    compareBaselineData = {
      comparisons: [
        {
          snapshotId: 10,
          activityId: 100,
          activityCode: "A-100",
          activityName: "Task 100",
          wbsNodeId: 1,
          wbsCode: "1.1",
          wbsName: "WBS One",
          baselineScheduledStart: "2026-09-10",
          baselineScheduledFinish: "2026-09-12",
          currentScheduledStart: "2026-09-12",
          currentScheduledFinish: "2026-09-14",
          startVariance: 2,
          finishVariance: 2,
          currentArchivedAt: null,
          currentMissing: false,
        },
      ],
    };
    renderPanel("viewer");
    await userEvent.click(screen.getByTestId("baseline-select-1"));

    expect(screen.getByText("Task 100")).toBeInTheDocument();
    expect(screen.getByText("A-100")).toBeInTheDocument();
    expect(screen.getByText("1.1")).toBeInTheDocument();
    expect(screen.getAllByText("+2").length).toBeGreaterThanOrEqual(1);
  });

  it("indicates archived current activity", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Baseline One", activityCount: 1, capturedAt: new Date("2026-08-01T00:00:00Z") }],
    };
    compareBaselineData = {
      comparisons: [
        {
          snapshotId: 10,
          activityId: 100,
          activityCode: null,
          activityName: "Archived Task",
          wbsNodeId: 1,
          wbsCode: "1",
          wbsName: "Root",
          baselineScheduledStart: "2026-09-10",
          baselineScheduledFinish: "2026-09-12",
          currentScheduledStart: "2026-09-10",
          currentScheduledFinish: "2026-09-12",
          startVariance: 0,
          finishVariance: 0,
          currentArchivedAt: "2026-09-15T00:00:00Z",
          currentMissing: false,
        },
      ],
    };
    renderPanel("viewer");
    await userEvent.click(screen.getByTestId("baseline-select-1"));

    expect(screen.getByText(/Archived since baseline/)).toBeInTheDocument();
  });

  it("indicates missing current activity", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Baseline One", activityCount: 1, capturedAt: new Date("2026-08-01T00:00:00Z") }],
    };
    compareBaselineData = {
      comparisons: [
        {
          snapshotId: 10,
          activityId: 100,
          activityCode: null,
          activityName: "Deleted Task",
          wbsNodeId: 1,
          wbsCode: "1",
          wbsName: "Root",
          baselineScheduledStart: "2026-09-10",
          baselineScheduledFinish: "2026-09-12",
          currentScheduledStart: null,
          currentScheduledFinish: null,
          startVariance: null,
          finishVariance: null,
          currentArchivedAt: null,
          currentMissing: true,
        },
      ],
    };
    renderPanel("viewer");
    await userEvent.click(screen.getByTestId("baseline-select-1"));

    expect(screen.getByText(/Removed since baseline/)).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("submits capture form for admin", async () => {
    listBaselinesData = { baselines: [] };
    renderPanel("admin");

    await userEvent.type(screen.getByLabelText("Baseline name"), "My Baseline");
    await userEvent.type(screen.getByLabelText("Baseline description"), "A note");
    await userEvent.click(screen.getByRole("button", { name: /Capture Baseline/i }));

    // Establishing a baseline is a controlled action: nothing is sent yet.
    expect(screen.getByTestId("baseline-capture-confirm")).toBeInTheDocument();
    expect(captured.capture.length).toBe(0);

    await userEvent.click(screen.getByTestId("baseline-capture-confirm-button"));

    await waitFor(() => expect(captured.capture.length).toBe(1));
    expect(captured.capture[0].name).toBe("My Baseline");
    expect(captured.capture[0].description).toBe("A note");
    expect(captured.capture[0].expectedRevision).toBe(3);
  });

  it("keeps UI stable when capture mutation fails", async () => {
    captureBaselineError = new Error("Capture failed");
    listBaselinesData = { baselines: [] };
    renderPanel("admin");

    await userEvent.type(screen.getByLabelText("Baseline name"), "Bad Baseline");
    await userEvent.click(screen.getByRole("button", { name: /Capture Baseline/i }));
    await userEvent.click(screen.getByTestId("baseline-capture-confirm-button"));

    await waitFor(() => expect(screen.getByText("Capture failed")).toBeInTheDocument());
    expect(screen.getByLabelText("Baseline name")).toHaveValue("Bad Baseline");
  });

  it("shows the not-established baseline state", () => {
    listBaselinesData = { baselines: [] };
    renderPanel("viewer");

    expect(screen.getByTestId("baseline-state")).toHaveTextContent("Baseline: Not established");
  });

  it("shows the established baseline state with its captured date and actor", () => {
    listBaselinesData = {
      baselines: [
        {
          id: 7,
          name: "Approved Rev A",
          activityCount: 2,
          capturedAt: new Date(2026, 1, 16, 9, 0),
          capturedByName: "Gerald",
        },
      ],
    };
    renderPanel("viewer");

    const state = screen.getByTestId("baseline-state");
    expect(state).toHaveTextContent("Baseline: Established (2026-02-16)");
    expect(state).toHaveTextContent("Approved Rev A");
    expect(state).toHaveTextContent("Gerald");
  });

  it("requires an explicit confirmation before capturing, and can be cancelled", async () => {
    listBaselinesData = { baselines: [] };
    renderPanel("admin");

    await userEvent.type(screen.getByLabelText("Baseline name"), "Approved Rev A");
    await userEvent.click(screen.getByRole("button", { name: /Capture Baseline/i }));
    expect(screen.getByTestId("baseline-capture-confirm")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("baseline-capture-cancel-button"));
    expect(screen.queryByTestId("baseline-capture-confirm")).not.toBeInTheDocument();
    expect(captured.capture.length).toBe(0);
  });

  it("offers rebaseline, explains that history is preserved, and warns on the confirmation step", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Approved Rev A", activityCount: 1, capturedAt: new Date(2026, 1, 16) }],
    };
    renderPanel("admin");

    await userEvent.type(screen.getByLabelText("Baseline name"), "Approved Rev B");
    await userEvent.click(screen.getByRole("button", { name: /Replace Baseline/i }));

    const confirm = screen.getByTestId("baseline-capture-confirm");
    expect(confirm).toHaveTextContent("Existing baselines are kept as history");
  });

  it("renders the project-level baseline versus current/forecast comparison", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Approved Rev A", activityCount: 2, capturedAt: new Date(2026, 1, 16) }],
    };
    compareBaselineData = {
      comparisons: [],
      project: {
        baselineStart: "2026-02-16",
        baselineFinish: "2026-02-27",
        currentStart: "2026-02-16",
        currentFinish: "2026-03-06",
        startVariance: 0,
        finishVariance: 7,
        baselineActivityCount: 2,
        newSinceBaselineCount: 1,
        removedSinceBaselineCount: 0,
      },
    };
    renderPanel("viewer");
    await userEvent.click(screen.getByTestId("baseline-select-1"));

    const tiles = screen.getByTestId("baseline-project-comparison");
    expect(tiles).toHaveTextContent("Baseline Finish");
    expect(tiles).toHaveTextContent("Current / Forecast Finish");
    expect(tiles).toHaveTextContent("Finish Variance");
    expect(tiles).toHaveTextContent("+7");
    expect(screen.getByTestId("baseline-project-counts")).toHaveTextContent("2 approved");
    expect(screen.getByTestId("baseline-project-counts")).toHaveTextContent("1 new since baseline");
  });

  it("renders duration variance and explicit status text for each activity", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Approved Rev A", activityCount: 3, capturedAt: new Date(2026, 1, 16) }],
    };
    compareBaselineData = {
      comparisons: [
        {
          snapshotId: 10,
          activityId: 100,
          activityCode: "A-100",
          activityName: "On plan",
          wbsNodeId: 1,
          wbsCode: "1.1",
          wbsName: "WBS One",
          baselineScheduledStart: "2026-02-16",
          baselineScheduledFinish: "2026-02-20",
          currentScheduledStart: "2026-02-16",
          currentScheduledFinish: "2026-02-20",
          startVariance: 0,
          finishVariance: 0,
          baselineDurationDays: 5,
          currentDurationDays: 8,
          durationVariance: 3,
          status: "on-baseline",
          statusLabel: "On baseline",
          statusSymbol: "=",
          currentArchivedAt: null,
          currentMissing: false,
        },
        {
          snapshotId: 11,
          activityId: 101,
          activityCode: "A-101",
          activityName: "Running late",
          wbsNodeId: 1,
          wbsCode: "1.1",
          wbsName: "WBS One",
          baselineScheduledStart: "2026-02-16",
          baselineScheduledFinish: "2026-02-20",
          currentScheduledStart: "2026-02-16",
          currentScheduledFinish: "2026-02-25",
          startVariance: 0,
          finishVariance: 5,
          baselineDurationDays: 5,
          currentDurationDays: 5,
          durationVariance: 0,
          status: "late",
          statusLabel: "Behind baseline",
          statusSymbol: "▲",
          currentArchivedAt: null,
          currentMissing: false,
        },
        {
          snapshotId: 12,
          activityId: 102,
          activityCode: "A-102",
          activityName: "Ahead of plan",
          wbsNodeId: 1,
          wbsCode: "1.1",
          wbsName: "WBS One",
          baselineScheduledStart: "2026-02-16",
          baselineScheduledFinish: "2026-02-20",
          currentScheduledStart: "2026-02-16",
          currentScheduledFinish: "2026-02-18",
          startVariance: 0,
          finishVariance: -2,
          baselineDurationDays: 5,
          currentDurationDays: 3,
          durationVariance: -2,
          status: "ahead",
          statusLabel: "Ahead of baseline",
          statusSymbol: "▼",
          currentArchivedAt: null,
          currentMissing: false,
        },
      ],
    };
    renderPanel("viewer");
    await userEvent.click(screen.getByTestId("baseline-select-1"));

    // Duration columns are labelled as baseline vs current/forecast.
    expect(screen.getByText("Baseline Duration")).toBeInTheDocument();
    expect(screen.getByText("Current / Forecast Duration")).toBeInTheDocument();
    expect(screen.getByText("Duration Variance")).toBeInTheDocument();
    expect(screen.getAllByText("5 days").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("8 days")).toBeInTheDocument();
    expect(screen.getAllByText("+3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("-2").length).toBeGreaterThanOrEqual(1);

    // Status is text plus a symbol, never colour alone.
    expect(screen.getByTestId("baseline-status-100")).toHaveTextContent("On baseline");
    expect(screen.getByTestId("baseline-status-101")).toHaveTextContent("Behind baseline");
    expect(screen.getByTestId("baseline-status-101")).toHaveTextContent("▲");
    expect(screen.getByTestId("baseline-status-102")).toHaveTextContent("Ahead of baseline");
    expect(screen.getByTestId("baseline-status-102")).toHaveTextContent("▼");
  });

  it("labels forecast columns as current/forecast and never as actual", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Approved Rev A", activityCount: 1, capturedAt: new Date(2026, 1, 16) }],
    };
    compareBaselineData = {
      comparisons: [
        {
          snapshotId: 10,
          activityId: 100,
          activityCode: "A-100",
          activityName: "Task 100",
          wbsNodeId: 1,
          wbsCode: "1.1",
          wbsName: "WBS One",
          baselineScheduledStart: "2026-02-16",
          baselineScheduledFinish: "2026-02-20",
          currentScheduledStart: "2026-02-16",
          currentScheduledFinish: "2026-02-20",
          startVariance: 0,
          finishVariance: 0,
          baselineDurationDays: 5,
          currentDurationDays: 5,
          durationVariance: 0,
          status: "on-baseline",
          statusLabel: "On baseline",
          statusSymbol: "=",
          currentArchivedAt: null,
          currentMissing: false,
        },
      ],
    };
    renderPanel("viewer");
    await userEvent.click(screen.getByTestId("baseline-select-1"));

    expect(screen.getByText("Current / Forecast Start")).toBeInTheDocument();
    expect(screen.getByText("Current / Forecast Finish")).toBeInTheDocument();
    expect(screen.queryByText(/\bActual Start\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bActual Finish\b/)).not.toBeInTheDocument();
  });

  it("lists activities added after the baseline without inventing baseline values", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Approved Rev A", activityCount: 1, capturedAt: new Date(2026, 1, 16) }],
    };
    compareBaselineData = {
      comparisons: [
        {
          snapshotId: 10,
          activityId: 100,
          activityCode: "A-100",
          activityName: "Original scope",
          wbsNodeId: 1,
          wbsCode: "1.1",
          wbsName: "WBS One",
          baselineScheduledStart: "2026-02-16",
          baselineScheduledFinish: "2026-02-20",
          currentScheduledStart: "2026-02-16",
          currentScheduledFinish: "2026-02-20",
          startVariance: 0,
          finishVariance: 0,
          baselineDurationDays: 5,
          currentDurationDays: 5,
          durationVariance: 0,
          status: "on-baseline",
          statusLabel: "On baseline",
          statusSymbol: "=",
          currentArchivedAt: null,
          currentMissing: false,
        },
      ],
      newSinceBaseline: [
        {
          snapshotId: null,
          activityId: 200,
          activityCode: "A-200",
          activityName: "Added later",
          wbsNodeId: 1,
          wbsCode: "1.1",
          wbsName: "WBS One",
          baselineScheduledStart: null,
          baselineScheduledFinish: null,
          currentScheduledStart: "2026-03-02",
          currentScheduledFinish: "2026-03-04",
          startVariance: null,
          finishVariance: null,
          baselineDurationDays: null,
          currentDurationDays: 3,
          durationVariance: null,
          status: "new-since-baseline",
          statusLabel: "New since baseline",
          statusSymbol: "+",
          currentArchivedAt: null,
          currentMissing: false,
        },
      ],
      project: {
        baselineStart: "2026-02-16",
        baselineFinish: "2026-02-20",
        currentStart: "2026-02-16",
        currentFinish: "2026-03-04",
        startVariance: 0,
        finishVariance: 12,
        baselineActivityCount: 1,
        newSinceBaselineCount: 1,
        removedSinceBaselineCount: 0,
      },
    };
    renderPanel("viewer");
    await userEvent.click(screen.getByTestId("baseline-select-1"));

    const section = screen.getByTestId("baseline-new-since");
    expect(section).toHaveTextContent("New since baseline (1)");
    expect(section).toHaveTextContent("Added later");
    expect(section).toHaveTextContent("New since baseline");
    // Its current forecast duration is real; its baseline values stay blank.
    expect(section).toHaveTextContent("3 days");
    expect(section).toHaveTextContent("—");
  });

  it("does not show baseline comparison controls to an unauthorized role", () => {
    listBaselinesData = { baselines: [] };
    renderPanel("viewer");

    expect(screen.queryByRole("button", { name: /Capture Baseline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Replace Baseline/i })).not.toBeInTheDocument();
  });

  it("refreshes the comparison when the project revision changes, so a stale result cannot linger", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Approved Rev A", activityCount: 1, capturedAt: new Date(2026, 1, 16) }],
    };
    compareBaselineData = { comparisons: [] };

    const { rerender } = render(
      <BaselinePanel
        slug="test-project"
        access="test-token"
        role="viewer"
        expectedRevision={3}
        onRevisionChange={() => undefined}
        onRefresh={async () => undefined}
      />
    );
    await userEvent.click(screen.getByTestId("baseline-select-1"));
    const before = { ...refetchCounts };

    // A project mutation (for example Run Schedule) advances the revision.
    rerender(
      <BaselinePanel
        slug="test-project"
        access="test-token"
        role="viewer"
        expectedRevision={4}
        onRevisionChange={() => undefined}
        onRefresh={async () => undefined}
      />
    );

    await waitFor(() => expect(refetchCounts.compare).toBeGreaterThan(before.compare));
    expect(refetchCounts.list).toBeGreaterThan(before.list);
  });

  it("does not refetch the comparison while the revision is unchanged", async () => {
    listBaselinesData = {
      baselines: [{ id: 1, name: "Approved Rev A", activityCount: 1, capturedAt: new Date(2026, 1, 16) }],
    };
    compareBaselineData = { comparisons: [] };

    const { rerender } = render(
      <BaselinePanel
        slug="test-project"
        access="test-token"
        role="viewer"
        expectedRevision={3}
        onRevisionChange={() => undefined}
        onRefresh={async () => undefined}
      />
    );
    await userEvent.click(screen.getByTestId("baseline-select-1"));
    const before = { ...refetchCounts };

    rerender(
      <BaselinePanel
        slug="test-project"
        access="test-token"
        role="viewer"
        expectedRevision={3}
        onRevisionChange={() => undefined}
        onRefresh={async () => undefined}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(refetchCounts.compare).toBe(before.compare);
    expect(refetchCounts.list).toBe(before.list);
  });
});
