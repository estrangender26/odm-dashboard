// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ActivityProgressPanel from "./ActivityProgressPanel";
import { PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE } from "./progressModel";
import type { ActivityGridRow } from "./activityGridModel";

afterEach(() => cleanup());

function makeRow(overrides: Partial<ActivityGridRow> = {}): ActivityGridRow {
  return {
    id: 1,
    wbsNodeId: 1,
    sortOrder: 1,
    activityId: "A1000",
    activityName: "Mobilization",
    originalDurationDays: 5,
    calendarId: null,
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    remainingDurationDays: 0,
    status: null,
    earlyStart: null,
    earlyFinish: null,
    lateStart: null,
    lateFinish: null,
    totalFloatDays: null,
    archivedAt: null,
    ...overrides,
  };
}

function props(overrides: Partial<React.ComponentProps<typeof ActivityProgressPanel>> = {}) {
  return {
    activity: makeRow(),
    dataDate: "2026-01-07",
    pending: false,
    error: null,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("ActivityProgressPanel — entry surface", () => {
  it("exposes the statusing fields that have no grid column", () => {
    render(<ActivityProgressPanel {...props()} />);
    expect(screen.getByLabelText("Actual Start")).toBeInTheDocument();
    expect(screen.getByLabelText("Actual Finish")).toBeInTheDocument();
    expect(screen.getByLabelText("Percent Complete")).toBeInTheDocument();
    expect(screen.getByLabelText("Remaining Duration (days)")).toBeInTheDocument();
    expect(screen.getByTestId("progress-preview-status")).toHaveTextContent("Not started");
  });

  it("prefills the current stored facts", () => {
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 40, actualStart: "2026-01-05", remainingDurationDays: 3 }) })} />);
    expect(screen.getByLabelText("Actual Start")).toHaveValue("2026-01-05");
    expect(screen.getByLabelText("Percent Complete")).toHaveValue(40);
    expect(screen.getByLabelText("Remaining Duration (days)")).toHaveValue(3);
    expect(screen.getByTestId("progress-preview-status")).toHaveTextContent("In progress");
  });

  it("does not submit anything until a field actually changes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ onSave })} />);
    expect(screen.getByRole("button", { name: "Save progress" })).toBeDisabled();
    await user.type(screen.getByLabelText("Percent Complete"), "25");
    expect(screen.getByRole("button", { name: "Save progress" })).toBeEnabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("submits only the changed field so untouched facts are never re-sent", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 40, actualStart: "2026-01-05", remainingDurationDays: 3 }), onSave })} />);
    const remaining = screen.getByLabelText("Remaining Duration (days)");
    await user.clear(remaining);
    await user.type(remaining, "2");
    await user.click(screen.getByRole("button", { name: "Save progress" }));
    expect(onSave).toHaveBeenCalledWith({ remainingDurationDays: 2 });
  });

  it("previews the resolved lifecycle before saving (completion needs a finish)", async () => {
    const user = userEvent.setup();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 50, actualStart: "2026-01-05" }) })} />);
    const percent = screen.getByLabelText("Percent Complete");
    await user.clear(percent);
    await user.type(percent, "100");
    expect(screen.getByTestId("progress-preview-status")).toHaveTextContent("Completed");
    expect(screen.getByText(/Actual Finish will be recorded as the Data Date \(2026-01-07\)/)).toBeInTheDocument();
  });

  it("explains the missing Data Date instead of inventing today", async () => {
    const user = userEvent.setup();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 50, actualStart: "2026-01-05" }), dataDate: null })} />);
    const percent = screen.getByLabelText("Percent Complete");
    await user.clear(percent);
    await user.type(percent, "100");
    expect(screen.getByText(PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save progress" })).toBeDisabled();
  });

  it("blocks an impossible edit before it reaches the server", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 50, actualStart: "2026-01-05" }), onSave })} />);
    await user.type(screen.getByLabelText("Actual Finish"), "2026-01-06");
    expect(screen.getByRole("alert")).toHaveTextContent(/Actual Finish requires 100% complete/);
    expect(screen.getByRole("button", { name: "Save progress" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("blocks an explicit zero remaining duration for in-progress work", async () => {
    const user = userEvent.setup();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 50, actualStart: "2026-01-05", remainingDurationDays: 2 }) })} />);
    const remaining = screen.getByLabelText("Remaining Duration (days)");
    await user.clear(remaining);
    await user.type(remaining, "0");
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 1 day of remaining duration/);
  });

  it("surfaces a server error and the pending state", () => {
    render(<ActivityProgressPanel {...props({ error: "Project was updated by another user", pending: true })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Project was updated by another user");
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("cancels without saving", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ onCancel, onSave })} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
