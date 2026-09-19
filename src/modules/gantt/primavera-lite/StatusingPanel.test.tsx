// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StatusingPanel from "./StatusingPanel";
import type { StatusingActivityInput } from "@lihok/project-controls";

afterEach(() => cleanup());

const activities: StatusingActivityInput[] = [
  { id: 1, wbsNodeId: 1, activityName: "A", originalDurationDays: 5, percentComplete: 0, remainingDurationDays: 0, actualStart: null, actualFinish: null, earlyFinish: "2026-01-09" },
  { id: 2, wbsNodeId: 1, activityName: "B", originalDurationDays: 5, percentComplete: 40, remainingDurationDays: 3, actualStart: "2026-01-05", actualFinish: null, earlyFinish: "2026-01-07" },
  { id: 3, wbsNodeId: 1, activityName: "C", originalDurationDays: 2, percentComplete: 100, remainingDurationDays: 0, actualStart: "2026-01-05", actualFinish: "2026-01-06", earlyFinish: "2026-01-06" },
];

function props(overrides: Partial<React.ComponentProps<typeof StatusingPanel>> = {}) {
  return {
    activities,
    dataDate: "2026-01-07",
    scheduleOutOfDate: false,
    isAdmin: true,
    dataDateDraft: "2026-01-07",
    onDataDateDraftChange: vi.fn(),
    onSaveDataDate: vi.fn(),
    savingDataDate: false,
    dataDateError: null,
    ...overrides,
  };
}

describe("StatusingPanel — roll-up", () => {
  it("answers the statusing questions for the current Data Date", () => {
    render(<StatusingPanel {...props()} />);
    expect(screen.getByLabelText("Progress status")).toBeInTheDocument();
    expect(screen.getByTestId("statusing-data-date")).toHaveTextContent("2026-01-07");
    expect(screen.getByTestId("statusing-tile-Not started")).toHaveTextContent("1");
    expect(screen.getByTestId("statusing-tile-In progress")).toHaveTextContent("1");
    expect(screen.getByTestId("statusing-tile-Completed")).toHaveTextContent("1");
    expect(screen.getByTestId("statusing-tile-Actually started")).toHaveTextContent("2");
    expect(screen.getByTestId("statusing-tile-Actually finished")).toHaveTextContent("1");
    expect(screen.getByTestId("statusing-tile-Remaining work")).toHaveTextContent("8 days");
    expect(screen.getByTestId("statusing-tile-Forecast finish")).toHaveTextContent("2026-01-09");
  });

  it("states plainly when no Data Date is stored", () => {
    render(<StatusingPanel {...props({ dataDate: null, dataDateDraft: "" })} />);
    expect(screen.getByTestId("statusing-data-date")).toHaveTextContent("not set");
    expect(screen.getByTestId("statusing-warning-data-date-not-set")).toBeInTheDocument();
  });

  it("surfaces the out-of-date schedule notice", () => {
    render(<StatusingPanel {...props({ scheduleOutOfDate: true })} />);
    expect(screen.getByText(/Schedule is out of date/i)).toBeInTheDocument();
  });

  it("reports data-quality notices without rewriting anything", () => {
    render(<StatusingPanel {...props({ activities: [{ id: 9, wbsNodeId: 1, activityName: "X", percentComplete: 30, remainingDurationDays: 0, actualStart: null, actualFinish: null, originalDurationDays: 5, earlyFinish: "2026-01-09" }] })} />);
    expect(screen.getByTestId("statusing-warning-progress-without-actual-start")).toBeInTheDocument();
  });
});

describe("StatusingPanel — Data Date control", () => {
  it("keeps the explicit Data Date action admin-only", () => {
    render(<StatusingPanel {...props()} />);
    expect(screen.getByLabelText("Project Data Date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set Data Date" })).toBeInTheDocument();
  });

  it("hides the Data Date control from a viewer while keeping the roll-up", () => {
    render(<StatusingPanel {...props({ isAdmin: false })} />);
    expect(screen.queryByLabelText("Project Data Date")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set Data Date/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("statusing-tile-Completed")).toBeInTheDocument();
  });

  it("saves only when the explicit action is used", async () => {
    const user = userEvent.setup();
    const onSaveDataDate = vi.fn();
    render(<StatusingPanel {...props({ onSaveDataDate })} />);
    expect(onSaveDataDate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Set Data Date" }));
    expect(onSaveDataDate).toHaveBeenCalledTimes(1);
  });

  it("reports the draft change and the saving state", () => {
    const onDataDateDraftChange = vi.fn();
    render(<StatusingPanel {...props({ onDataDateDraftChange, savingDataDate: true })} />);
    fireEvent.change(screen.getByLabelText("Project Data Date"), { target: { value: "2026-01-09" } });
    expect(onDataDateDraftChange).toHaveBeenCalledWith("2026-01-09");
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("shows a server error from the Data Date mutation", () => {
    render(<StatusingPanel {...props({ dataDateError: "Invalid date" })} />);
    expect(screen.getByText("Invalid date")).toBeInTheDocument();
  });
});
