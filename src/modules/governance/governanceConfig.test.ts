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
