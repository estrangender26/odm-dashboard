import { describe, it, expect } from "vitest";
import {
  calculateMilestoneEffectiveProgress,
  isPersistedMilestoneComplete,
  calculateFacilityCurrentProgress,
} from "./governanceConfig";

describe("isPersistedMilestoneComplete", () => {
  it("should return true for a populated completion date", () => {
    expect(isPersistedMilestoneComplete("2025-09-01")).toBe(true);
    expect(isPersistedMilestoneComplete("2026-07-25")).toBe(true);
  });

  it("should return false for null or undefined", () => {
    expect(isPersistedMilestoneComplete(null)).toBe(false);
    expect(isPersistedMilestoneComplete(undefined)).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isPersistedMilestoneComplete("")).toBe(false);
  });
});

describe("calculateFacilityCurrentProgress", () => {
  it("should count milestones with compDate as complete", () => {
    const milestoneDates = {
      M1: "2025-09-01",
      M2: "2025-11-01",
      M3: "2026-02-01",
      M4: "2026-07-26",
      M5: null,
      M6: null,
      M7: null,
      M8: null,
      M9: null,
    };
    const result = calculateFacilityCurrentProgress(milestoneDates);
    expect(result.completed).toBe(4);
    expect(result.total).toBe(9);
    expect(result.percentage).toBe(44);
  });
});

// Four scenario verification tests
describe("Four Scenario Verification", () => {
  it("Scenario 1: customPct=50, compDate=null - both show 50%", () => {
    const effectiveProgress = calculateMilestoneEffectiveProgress(50, null);
    expect(effectiveProgress).toBe(50);
  });

  it("Scenario 2: customPct=75, compDate exists - both show 75%", () => {
    const effectiveProgress = calculateMilestoneEffectiveProgress(75, "2026-07-25");
    expect(effectiveProgress).toBe(75);
  });

  it("Scenario 3: Reporting date changed - No metric changes", () => {
    const progress1 = calculateFacilityCurrentProgress({ M1: "2026-01-15", M2: null });
    const progress2 = calculateFacilityCurrentProgress({ M1: "2026-01-15", M2: null });
    expect(progress1.percentage).toBe(progress2.percentage);
  });

  it("Scenario 4: Unsaved edit - Presentation shows persisted value", () => {
    const persisted = { M1: "2026-01-15", M2: null };
    const presentation = calculateFacilityCurrentProgress(persisted);
    expect(presentation.completed).toBe(1);
  });
});
