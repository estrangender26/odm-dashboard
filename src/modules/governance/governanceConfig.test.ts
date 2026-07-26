import { describe, it, expect } from "vitest";
import { GOVERNANCE_MILESTONES } from "./governanceConfig";

/**
 * These tests verify that the shared governance configuration is consistent
 * with the canonical definitions in GovernanceDashboard.tsx.
 * 
 * The UI and presentation generator must use the same milestone definitions.
 */
describe("Governance Configuration", () => {
  it("should have 9 standard milestones", () => {
    expect(GOVERNANCE_MILESTONES.length).toBe(9);
  });

  it("should have milestones M1 through M9", () => {
    const expectedIds = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"];
    const actualIds = GOVERNANCE_MILESTONES.map(m => m.id);
    expect(actualIds).toEqual(expectedIds);
  });

  it("should have equal weights as fallback", () => {
    const weights = GOVERNANCE_MILESTONES.map(m => m.weight);
    const allEqual = weights.every(w => w === weights[0]);
    expect(allEqual).toBe(true);
    expect(weights[0]).toBe(1);
  });

  it("should include Technical Audit as first milestone", () => {
    expect(GOVERNANCE_MILESTONES[0].label).toContain("Technical Audit");
  });

  it("should include Final TOC as last milestone", () => {
    expect(GOVERNANCE_MILESTONES[8].label).toContain("Final TOC");
  });
});


import {
  isMilestoneCompleteAsOf,
  calculateFacilityProgressAsOf,
  formatProgressDisplay,
  isValidReportingDate,
} from "./governanceConfig";

/**
 * Tests for as-of-date milestone completion logic.
 * 
 * These tests ensure consistent calculation between:
 * - Facility Dashboard (current view)
 * - Presentation Center (historical as-of-date view)
 */
describe("isMilestoneCompleteAsOf", () => {
  it("should return false for null completion date", () => {
    expect(isMilestoneCompleteAsOf(null, "2026-07-25")).toBe(false);
    expect(isMilestoneCompleteAsOf(undefined, "2026-07-25")).toBe(false);
  });

  it("should return true for any completion date when no reporting date (current view)", () => {
    expect(isMilestoneCompleteAsOf("2026-07-25", null)).toBe(true);
    expect(isMilestoneCompleteAsOf("2026-07-26", null)).toBe(true);
    expect(isMilestoneCompleteAsOf("2025-01-01", null)).toBe(true);
  });

  it("should exclude milestones completed ON the reporting date (end-of-day semantics)", () => {
    // A milestone completed on 2026-07-25 is NOT complete as-of 2026-07-25
    expect(isMilestoneCompleteAsOf("2026-07-25", "2026-07-25")).toBe(false);
  });

  it("should include milestones completed BEFORE the reporting date", () => {
    expect(isMilestoneCompleteAsOf("2026-07-24", "2026-07-25")).toBe(true);
    expect(isMilestoneCompleteAsOf("2026-07-20", "2026-07-25")).toBe(true);
    expect(isMilestoneCompleteAsOf("2026-01-01", "2026-07-25")).toBe(true);
  });

  it("should exclude milestones completed AFTER the reporting date", () => {
    expect(isMilestoneCompleteAsOf("2026-07-26", "2026-07-25")).toBe(false);
    expect(isMilestoneCompleteAsOf("2026-08-01", "2026-07-25")).toBe(false);
  });

  it("should handle ISO datetime strings by extracting date portion", () => {
    expect(isMilestoneCompleteAsOf("2026-07-24T14:30:00Z", "2026-07-25")).toBe(true);
    expect(isMilestoneCompleteAsOf("2026-07-25T00:00:00Z", "2026-07-25")).toBe(false);
    expect(isMilestoneCompleteAsOf("2026-07-25T23:59:59Z", "2026-07-25")).toBe(false);
  });
});

describe("calculateFacilityProgressAsOf", () => {
  it("should calculate current progress when reportingDate is null", () => {
    const milestones = {
      M1: "2026-07-20",
      M2: "2026-07-21",
      M3: null,
      M4: "2026-07-25",
      M5: null,
      M6: null,
      M7: null,
      M8: null,
      M9: null,
    };
    
    const result = calculateFacilityProgressAsOf(milestones, null);
    expect(result.completed).toBe(3); // M1, M2, M4 all count
    expect(result.total).toBe(9);
    expect(result.percentage).toBe(33); // 3/9 = 33%
  });

  it("should calculate historical progress as-of reporting date", () => {
    const milestones = {
      M1: "2026-07-20",  // before cutoff - counts
      M2: "2026-07-21",  // before cutoff - counts
      M3: "2026-07-24",  // before cutoff - counts
      M4: "2026-07-25",  // ON cutoff - does NOT count
      M5: "2026-07-26",  // after cutoff - does NOT count
      M6: null,
      M7: null,
      M8: null,
      M9: null,
    };
    
    const result = calculateFacilityProgressAsOf(milestones, "2026-07-25");
    expect(result.completed).toBe(3); // M1, M2, M3 only
    expect(result.total).toBe(9);
    expect(result.percentage).toBe(33);
  });

  it("should handle empty milestone data", () => {
    const result = calculateFacilityProgressAsOf({}, "2026-07-25");
    expect(result.completed).toBe(0);
    expect(result.total).toBe(9);
    expect(result.percentage).toBe(0);
  });

  it("should handle all incomplete milestones", () => {
    const milestones = {
      M1: null,
      M2: null,
      M3: null,
      M4: null,
      M5: null,
      M6: null,
      M7: null,
      M8: null,
      M9: null,
    };
    
    const result = calculateFacilityProgressAsOf(milestones, "2026-07-25");
    expect(result.completed).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it("should handle all complete milestones", () => {
    const milestones = {
      M1: "2026-07-01",
      M2: "2026-07-02",
      M3: "2026-07-03",
      M4: "2026-07-04",
      M5: "2026-07-05",
      M6: "2026-07-06",
      M7: "2026-07-07",
      M8: "2026-07-08",
      M9: "2026-07-09",
    };
    
    const result = calculateFacilityProgressAsOf(milestones, "2026-07-25");
    expect(result.completed).toBe(9);
    expect(result.percentage).toBe(100);
  });

  it("should demonstrate AGLIPAY/HTT discrepancy scenario", () => {
    // Scenario: M1-M3 complete before 2026-07-25, M4 complete on/after 2026-07-25
    const milestones = {
      M1: "2026-07-20",
      M2: "2026-07-21",
      M3: "2026-07-22",
      M4: "2026-07-25", // Completed ON reporting date - excluded from historical
      M5: null,
      M6: null,
      M7: null,
      M8: null,
      M9: null,
    };
    
    // Current view (Facility Dashboard): 4/9 complete
    const currentResult = calculateFacilityProgressAsOf(milestones, null);
    expect(currentResult.completed).toBe(4);
    
    // Historical view (Presentation Center as-of 2026-07-25): 3/9 complete
    const historicalResult = calculateFacilityProgressAsOf(milestones, "2026-07-25");
    expect(historicalResult.completed).toBe(3);
  });
});

describe("formatProgressDisplay", () => {
  it("should format standard progress", () => {
    expect(formatProgressDisplay(4, 9)).toBe("4/9");
    expect(formatProgressDisplay(0, 9)).toBe("0/9");
    expect(formatProgressDisplay(9, 9)).toBe("9/9");
  });
});

describe("isValidReportingDate", () => {
  it("should accept valid dates", () => {
    expect(isValidReportingDate("2026-07-25")).toBe(true);
    expect(isValidReportingDate("2026-01-01")).toBe(true);
    expect(isValidReportingDate("2026-12-31")).toBe(true);
    expect(isValidReportingDate("2024-02-29")).toBe(true); // Leap year
  });

  it("should reject invalid formats", () => {
    expect(isValidReportingDate("07-25-2026")).toBe(false);
    expect(isValidReportingDate("2026/07/25")).toBe(false);
    expect(isValidReportingDate("20260725")).toBe(false);
    expect(isValidReportingDate("")).toBe(false);
  });

  it("should reject calendar-invalid dates", () => {
    expect(isValidReportingDate("2026-02-30")).toBe(false); // Feb has 28/29 days
    expect(isValidReportingDate("2026-04-31")).toBe(false); // April has 30 days
    expect(isValidReportingDate("2026-13-01")).toBe(false); // No month 13
    expect(isValidReportingDate("2026-00-15")).toBe(false); // No month 0
    expect(isValidReportingDate("2026-01-32")).toBe(false); // Jan has 31 days
  });

  it("should reject non-leap-year Feb 29", () => {
    expect(isValidReportingDate("2025-02-29")).toBe(false); // 2025 is not leap year
    expect(isValidReportingDate("2023-02-29")).toBe(false); // 2023 is not leap year
  });
});
