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

let listBaselinesData: { baselines: Array<{ id: number; name: string; activityCount: number; capturedAt: Date | null }> } | undefined = undefined;
let compareBaselineData: { comparisons: Array<{
  snapshotId: number;
  activityId: number;
  activityCode: string | null;
  activityName: string;
  wbsNodeId: number;
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
}> } | undefined = undefined;
let compareBaselineError: Error | null = null;
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
                  refetch: async () => ({}),
                }),
              };
            }
            if (prop === "compareBaseline") {
              return {
                useQuery: () => ({
                  data: compareBaselineData,
                  isLoading: false,
                  error: compareBaselineError,
                  refetch: async () => ({}),
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

    expect(screen.getByText("Archived")).toBeInTheDocument();
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

    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("submits capture form for admin", async () => {
    listBaselinesData = { baselines: [] };
    renderPanel("admin");

    await userEvent.type(screen.getByLabelText("Baseline name"), "My Baseline");
    await userEvent.type(screen.getByLabelText("Baseline description"), "A note");
    await userEvent.click(screen.getByRole("button", { name: /Capture Baseline/i }));

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

    await waitFor(() => expect(screen.getByText("Capture failed")).toBeInTheDocument());
    expect(screen.getByLabelText("Baseline name")).toHaveValue("Bad Baseline");
  });
});
