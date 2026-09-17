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

  it("derives the blank-remaining hint from the engine so it matches the Remaining column", () => {
    const cases: Array<[Partial<ActivityGridRow>, RegExp]> = [
      [{ percentComplete: 25, originalDurationDays: 5 }, /\(4 working days forecast\)/],
      [{ activityType: "milestone", originalDurationDays: 0, percentComplete: 50 }, /\(0 working days forecast\)/],
      [{ percentComplete: 0, originalDurationDays: 5 }, /\(5 working days forecast\)/],
      [{ percentComplete: 25, originalDurationDays: 5, remainingDurationDays: 2 }, /\(2 working days forecast\)/],
    ];
    for (const [row, expected] of cases) {
      const { unmount } = render(<ActivityProgressPanel {...props({ activity: makeRow(row) })} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
      unmount();
    }
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

describe("ActivityProgressPanel — EMPTY is not ZERO percent", () => {
  const percentField = () => screen.getByLabelText("Percent Complete") as HTMLInputElement;
  const saveButton = () => screen.getByRole("button", { name: /Save progress|Saving…/ });

  it("CASE A — clearing % Complete is an incomplete value, not 0%: Save disabled, nothing submitted, stored status kept", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 25, actualStart: "2026-01-05", remainingDurationDays: 4 }), onSave })} />);
    expect(screen.getByTestId("progress-preview-status")).toHaveTextContent("In progress");

    await user.clear(percentField());

    // visibly empty, and explicitly incomplete
    expect(percentField()).toHaveValue(null);
    expect(screen.getByRole("alert")).toHaveTextContent(/Percent complete is required/);
    // the emptied field must NOT be previewed as 0% / Not started
    expect(screen.getByTestId("progress-preview-status")).toHaveTextContent("In progress");
    expect(screen.getByTestId("progress-preview-status")).not.toHaveTextContent("Not started");
    // Save must not become enabled through an empty-to-zero coercion
    expect(saveButton()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("CASE B — an explicit 0 stays numeric zero and can be saved", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 25, actualStart: "2026-01-05", remainingDurationDays: 4 }), onSave })} />);
    await user.clear(percentField());
    await user.type(percentField(), "0");

    expect(percentField()).toHaveValue(0); // numeric zero, not empty
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith({ percentComplete: 0 });
  });

  it("CASE C — a valid non-zero value behaves normally", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 25, actualStart: "2026-01-05", remainingDurationDays: 4 }), onSave })} />);
    await user.clear(percentField());
    await user.type(percentField(), "40");
    expect(screen.getByTestId("progress-preview-status")).toHaveTextContent("In progress");
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith({ percentComplete: 40 });
  });

  it("CASE D — out-of-range values keep the canonical validation and cannot be saved", async () => {
    const user = userEvent.setup();
    for (const bad of ["-1", "101"]) {
      const onSave = vi.fn();
      const { unmount } = render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 25, actualStart: "2026-01-05", remainingDurationDays: 4 }), onSave })} />);
      await user.clear(percentField());
      await user.type(percentField(), bad);
      expect(screen.getByRole("alert")).toHaveTextContent(/whole number from 0 to 100/);
      expect(saveButton()).toBeDisabled();
      expect(onSave).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("treats '00' and '0.0' as numeric zero, and keeps EMPTY distinct from ZERO", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 25, actualStart: "2026-01-05", remainingDurationDays: 4 }), onSave })} />);
    for (const zeroish of ["00", "0.0"]) {
      await user.clear(percentField());
      expect(screen.getByRole("alert")).toHaveTextContent(/required/); // EMPTY blocks
      await user.type(percentField(), zeroish);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();     // ZERO does not
      expect(saveButton()).toBeEnabled();
      await user.clear(percentField());
    }
  });

  it("blocks Save while % is empty even when another field changed", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 25, actualStart: "2026-01-05", remainingDurationDays: 4 }), onSave })} />);
    await user.clear(percentField());
    await user.type(screen.getByLabelText("Actual Finish"), "2026-01-06");
    expect(screen.getByRole("alert")).toHaveTextContent(/Percent complete is required/);
    expect(saveButton()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not advertise completion while % is empty", async () => {
    const user = userEvent.setup();
    render(<ActivityProgressPanel {...props({ activity: makeRow({ percentComplete: 100, actualStart: "2026-01-05", actualFinish: "2026-01-06" }) })} />);
    expect(screen.getByText("This activity is complete.")).toBeInTheDocument();
    await user.clear(percentField());
    expect(screen.queryByText("This activity is complete.")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Percent complete is required/);
  });
});
