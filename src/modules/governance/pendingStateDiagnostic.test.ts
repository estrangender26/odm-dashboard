import { describe, it, expect } from "vitest";
import { isMilestoneCompleteAsOf, GOVERNANCE_MILESTONES } from "./governanceConfig";

describe("Pending State Discrepancy Regression", () => {
  it("should demonstrate pending edits inflate completion count", () => {
    const persistedState: Record<string, string | null> = {
      M1: "2025-09-01",
      M2: "2025-11-01",
      M3: "2026-02-01",
      M4: null,
      M5: null,
      M6: null,
      M7: null,
      M8: null,
      M9: null,
    };
    const pendingEdits: Record<string, string> = { M4: "2026-07-26" };
    const dashboardCompleted = GOVERNANCE_MILESTONES.filter(m => {
      const pending = pendingEdits[m.id];
      const compDate = pending !== undefined ? pending : persistedState[m.id];
      return isMilestoneCompleteAsOf(compDate, null);
    }).length;
    const apiCompleted = GOVERNANCE_MILESTONES.filter(m => {
      return isMilestoneCompleteAsOf(persistedState[m.id], null);
    }).length;
    expect(dashboardCompleted).toBe(4);
    expect(apiCompleted).toBe(3);
  });
});
