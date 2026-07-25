import { describe, it, expect } from "vitest";
import {
  calculateFacilityProgress,
  calculateSubmissionCoverageProxy,
  determineRagStatus,
  generateFacilitySCurve,
  calculateForecastSCurve,
  buildExecutiveActions,
  buildPortfolioRisks,
  GOVERNANCE_MILESTONES,
  type GovernanceMilestone,
  type DocumentSummary,
  type FacilityGovernanceData,
} from "./governanceTypes";

describe("Governance Data Calculations", () => {
  describe("calculateFacilityProgress", () => {
    it("should return null planned when no baseline dates exist", () => {
      const milestones: GovernanceMilestone[] = [
        { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
        { milestoneId: "M2", milestoneName: "Test", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      ];
      
      const result = calculateFacilityProgress(milestones, new Date());
      expect(result.planned).toBeNull();
      expect(result.hasBaseline).toBe(false);
    });
    
    it("should calculate cumulative planned when baseline dates exist", () => {
      const milestones: GovernanceMilestone[] = [
        { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: "2026-01-01", actualDate: null, actualProgress: null, status: null },
        { milestoneId: "M2", milestoneName: "Test", weight: 1, plannedDate: "2026-02-01", actualDate: null, actualProgress: null, status: null },
        { milestoneId: "M3", milestoneName: "Test", weight: 1, plannedDate: "2026-03-01", actualDate: null, actualProgress: null, status: null },
      ];
      
      const reportingDate = new Date("2026-02-15");
      const result = calculateFacilityProgress(milestones, reportingDate);
      expect(result.planned).toBe(67); // 2 of 3 milestones planned by Feb 15
      expect(result.hasBaseline).toBe(true);
    });
    
    it("should calculate cumulative actual based on completion dates", () => {
      const milestones: GovernanceMilestone[] = [
        { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: "2026-01-01", actualDate: "2026-01-05", actualProgress: 100, status: "complete" },
        { milestoneId: "M2", milestoneName: "Test", weight: 1, plannedDate: "2026-02-01", actualDate: null, actualProgress: null, status: null },
        { milestoneId: "M3", milestoneName: "Test", weight: 1, plannedDate: "2026-03-01", actualDate: null, actualProgress: null, status: null },
      ];
      
      const reportingDate = new Date("2026-02-15");
      const result = calculateFacilityProgress(milestones, reportingDate);
      expect(result.actual).toBe(33); // 1 of 3 milestones completed
    });
    
    it("should never decrease actual progress", () => {
      const milestones: GovernanceMilestone[] = [
        { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: "2026-01-01", actualDate: "2026-01-05", actualProgress: 100, status: "complete" },
        { milestoneId: "M2", milestoneName: "Test", weight: 1, plannedDate: "2026-02-01", actualDate: "2026-02-10", actualProgress: 100, status: "complete" },
        { milestoneId: "M3", milestoneName: "Test", weight: 1, plannedDate: "2026-03-01", actualDate: null, actualProgress: null, status: null },
      ];
      
      const reportingDate = new Date("2026-03-15");
      const result = calculateFacilityProgress(milestones, reportingDate);
      expect(result.actual).toBe(67); // 2 of 3 completed - cumulative
    });
    
    it("should return zero for empty milestones", () => {
      const result = calculateFacilityProgress([], new Date());
      expect(result.actual).toBe(0);
      expect(result.planned).toBeNull();
      expect(result.hasBaseline).toBe(false);
    });
  });
  
  describe("calculateSubmissionCoverageProxy", () => {
    it("should use configured required count, not upload count", () => {
      const docSummary: DocumentSummary = {
        totalDocuments: 5,
        byCategory: { "TOC-08": 3, "TOC-10": 2 },
        byWorkflowStatus: { accepted: 0, pendingReview: 5, returned: 0, missing: 0, overdue: 0, rejected: 0 },
        latestSubmissionDate: "2026-07-20",
      };
      
      const requiredFromConfig = 10; // Should come from configuration
      const result = calculateSubmissionCoverageProxy(docSummary, requiredFromConfig);
      expect(result.requiredMilestoneSubmissionProxy).toBe(10); // Not 5 from uploads
      // Workflow status is not tracked, so approved = 0
      expect(result.submissionCoverageProxy).toBe(50); // 5 submitted / 10 required = 50%
    });
    
    it("should handle zero required deliverables", () => {
      const docSummary: DocumentSummary = {
        totalDocuments: 0,
        byCategory: {},
        byWorkflowStatus: { accepted: 0, pendingReview: 0, returned: 0, missing: 0, overdue: 0, rejected: 0 },
        latestSubmissionDate: null,
      };
      
      const result = calculateSubmissionCoverageProxy(docSummary, 0);
      expect(result.submissionCoverageProxy).toBe(0); // Zero required = 0 coverage
    });
  });
  
  describe("determineRagStatus", () => {
    it("should return gray when no baseline exists", () => {
      expect(determineRagStatus(null, 0, false, false)).toBe("gray");
    });
    
    it("should return red for critical overdue", () => {
      expect(determineRagStatus(0, 0, true, true)).toBe("red");
    });
    
    it("should return red for significant variance", () => {
      expect(determineRagStatus(-25, 0, false, true)).toBe("red");
    });
    
    it("should return amber for moderate variance", () => {
      expect(determineRagStatus(-15, 0, false, true)).toBe("amber");
    });
    
    it("should return amber for many outstanding items", () => {
      expect(determineRagStatus(0, 8, false, true)).toBe("amber");
    });
    
    it("should return green for on track", () => {
      expect(determineRagStatus(5, 1, false, true)).toBe("green");
    });
  });
  
  describe("generateFacilitySCurve", () => {
    it("should return hasBaseline=false when no planned dates exist", () => {
      const milestones: GovernanceMilestone[] = [
        { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: null, actualDate: "2026-01-15", actualProgress: 100, status: "complete" },
      ];
      
      const result = generateFacilitySCurve(milestones, new Date("2026-02-01"));
      expect(result.hasBaseline).toBe(false);
      expect(result.points.every(p => p.planned === null)).toBe(true);
    });
    
    it("should not fabricate dates when baseline is unavailable", () => {
      const milestones: GovernanceMilestone[] = [
        { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      ];
      
      const result = generateFacilitySCurve(milestones, new Date());
      const hasTodayFabricated = result.points.some(p => {
        const today = new Date().toISOString().split("T")[0];
        return p.date === today && p.planned !== null;
      });
      expect(hasTodayFabricated).toBe(false);
    });
    
    it("should calculate planned based on milestone dates", () => {
      const milestones: GovernanceMilestone[] = [
        { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: "2026-01-01", actualDate: "2026-01-05", actualProgress: 100, status: "complete" },
        { milestoneId: "M2", milestoneName: "Test", weight: 1, plannedDate: "2026-02-01", actualDate: null, actualProgress: null, status: null },
        { milestoneId: "M3", milestoneName: "Test", weight: 1, plannedDate: "2026-03-01", actualDate: null, actualProgress: null, status: null },
      ];
      
      const reportingDate = new Date("2026-02-15");
      const result = generateFacilitySCurve(milestones, reportingDate);
      
      const febPoint = result.points.find(p => p.date === "2026-02-01");
      expect(febPoint?.planned).toBe(67); // 2 of 3 milestones planned by Feb 1
    });
    
    it("should calculate cumulative actual progress", () => {
      const milestones: GovernanceMilestone[] = [
        { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: "2026-01-01", actualDate: "2026-01-05", actualProgress: 100, status: "complete" },
        { milestoneId: "M2", milestoneName: "Test", weight: 1, plannedDate: "2026-02-01", actualDate: null, actualProgress: null, status: null },
      ];
      
      const reportingDate = new Date("2026-02-15");
      const result = generateFacilitySCurve(milestones, reportingDate);
      
      // Actual should be cumulative (50% after first milestone)
      const janPoint = result.points.find(p => p.date === "2026-01-05");
      expect(janPoint?.actual).toBe(50);
    });
  });
  
  describe("calculateForecastSCurve", () => {
    it("should omit forecast when no actual data exists", () => {
      const points = [
        { date: "2026-01", planned: 25, actual: null, forecast: null },
        { date: "2026-02", planned: 50, actual: null, forecast: null },
      ];
      
      const reportingDate = new Date("2026-01-15");
      const result = calculateForecastSCurve(points, reportingDate);
      expect(result.every(p => p.forecast === null)).toBe(true);
    });
    
    it("should omit forecast when actual progress is zero", () => {
      const points = [
        { date: "2026-01", planned: 25, actual: 0, forecast: null },
        { date: "2026-02", planned: 50, actual: 0, forecast: null },
      ];
      
      const reportingDate = new Date("2026-01-15");
      const result = calculateForecastSCurve(points, reportingDate);
      expect(result.every(p => p.forecast === null)).toBe(true);
    });
    
    it("should calculate forecast based on historical velocity", () => {
      const points = [
        { date: "2026-01-15", planned: 25, actual: 20, forecast: null },
        { date: "2026-02-15", planned: 50, actual: 40, forecast: null },
        { date: "2026-03-15", planned: 75, actual: null, forecast: null },
      ];
      
      const reportingDate = new Date("2026-02-15");
      const result = calculateForecastSCurve(points, reportingDate);
      
      // Should have forecast for future dates
      const futurePoint = result.find(p => p.date === "2026-03-15");
      expect(futurePoint?.forecast).not.toBeNull();
      expect(futurePoint?.forecast).toBeGreaterThan(40); // Should increase from 40
    });
    
    it("should cap forecast at 100%", () => {
      const points = [
        { date: "2026-01-01", planned: 25, actual: 20, forecast: null },
        { date: "2026-01-15", planned: 35, actual: 80, forecast: null },
        { date: "2026-02-01", planned: 50, actual: null, forecast: null },
      ];
      
      const reportingDate = new Date("2026-01-15");
      const result = calculateForecastSCurve(points, reportingDate);
      
      const futurePoint = result.find(p => p.date === "2026-02-01");
      expect(futurePoint?.forecast).toBe(100);
    });
    
    it("should never decrease forecast values", () => {
      const points = [
        { date: "2026-01-01", planned: 25, actual: 50, forecast: null },
        { date: "2026-02-01", planned: 50, actual: null, forecast: null },
        { date: "2026-03-01", planned: 75, actual: null, forecast: null },
      ];
      
      const reportingDate = new Date("2026-01-15");
      const result = calculateForecastSCurve(points, reportingDate);
      
      const forecasts = result.map(p => p.forecast).filter((f): f is number => f !== null);
      for (let i = 1; i < forecasts.length; i++) {
        expect(forecasts[i]).toBeGreaterThanOrEqual(forecasts[i - 1]);
      }
    });
    
    it("should not copy planned into forecast when insufficient data", () => {
      const points = [
        { date: "2026-01", planned: 25, actual: null, forecast: null },
        { date: "2026-02", planned: 50, actual: null, forecast: null },
      ];
      
      const reportingDate = new Date("2026-01-15");
      const result = calculateForecastSCurve(points, reportingDate);
      
      // Should NOT copy planned values
      const febPoint = result.find(p => p.date === "2026-02");
      expect(febPoint?.forecast).toBeNull();
      expect(febPoint?.forecast).not.toBe(50); // Not copied from planned
    });
  });
  
  describe("buildExecutiveActions", () => {
    it("should use actual milestone due dates, not invented dates", () => {
      const facilities: FacilityGovernanceData[] = [{
        facility: { slug: "test", name: "Test Facility", shortName: "TEST", color: "#000" },
        pppStartDate: "2026-01-01",
        governanceMetrics: {
          governanceReadiness: 20,
          riskLevel: "High",
          milestones: { complete: 1, total: 9 },
          progress: { planned: 60, actual: 20, variance: -40 },
          ragStatus: "red",
        },
        milestones: [
          { milestoneId: "M1", milestoneName: "Test", weight: 1, plannedDate: "2026-01-01", actualDate: "2026-01-05", actualProgress: 100, status: "complete" },
          { milestoneId: "M2", milestoneName: "Test", weight: 1, plannedDate: "2026-02-01", actualDate: null, actualProgress: null, status: null }, // Overdue
        ],
        documentSummary: {
          totalDocuments: 10,
          byCategory: {},
          byWorkflowStatus: { accepted: 3, pendingReview: 5, returned: 0, missing: 2, overdue: 0, rejected: 0 },
          latestSubmissionDate: "2026-07-20",
        },
      }];
      
      const actions = buildExecutiveActions(facilities);
      const criticalAction = actions.find(a => a.priority === "critical");
      
      // Due date should come from actual milestone, not Date.now() + 7 days
      expect(criticalAction?.dueDate).toBe("2026-02-01"); // Actual planned date
    });
    
    it("should return null due date when not available", () => {
      const facilities: FacilityGovernanceData[] = [{
        facility: { slug: "test", name: "Test Facility", shortName: "TEST", color: "#000" },
        pppStartDate: "2026-01-01",
        governanceMetrics: {
          governanceReadiness: 50,
          riskLevel: "Medium",
          milestones: { complete: 4, total: 9 },
          progress: { planned: 50, actual: 50, variance: 0 },
          ragStatus: "amber",
        },
        milestones: [],
        documentSummary: {
          totalDocuments: 5,
          byCategory: {},
          byWorkflowStatus: { accepted: 10, pendingReview: 8, returned: 2, missing: 0, overdue: 0, rejected: 0 },
          latestSubmissionDate: "2026-07-20",
        },
      }];
      
      const actions = buildExecutiveActions(facilities);
      // Actions are only created for critical schedule variance
      // No actions for document review when workflow status unavailable
      expect(actions.length).toBe(0);
    });
  });
  
  describe("buildPortfolioRisks", () => {
    it("should identify facilities without baseline", () => {
      const facilities: FacilityGovernanceData[] = [{
        facility: { slug: "test", name: "Test Facility", shortName: "TEST", color: "#000" },
        pppStartDate: null,
        governanceMetrics: {
          governanceReadiness: 20,
          riskLevel: "High",
          milestones: { complete: 1, total: 9 },
          progress: { planned: null, actual: 20, variance: null },
          ragStatus: "gray",
        },
        milestones: [],
        documentSummary: {
          totalDocuments: 10,
          byCategory: {},
          byWorkflowStatus: { accepted: 3, pendingReview: 5, returned: 0, missing: 2, overdue: 0, rejected: 0 },
          latestSubmissionDate: "2026-07-20",
        },
      }];
      
      const risks = buildPortfolioRisks(facilities);
      expect(risks.some(r => r.risk.includes("baseline"))).toBe(true);
    });
    
    it("should return empty for all green facilities with baseline", () => {
      const facilities: FacilityGovernanceData[] = [{
        facility: { slug: "test", name: "Test Facility", shortName: "TEST", color: "#000" },
        pppStartDate: "2026-01-01",
        governanceMetrics: {
          governanceReadiness: 90,
          riskLevel: "Low",
          milestones: { complete: 8, total: 9 },
          progress: { planned: 85, actual: 90, variance: 5 },
          ragStatus: "green",
        },
        milestones: [],
        documentSummary: {
          totalDocuments: 50,
          byCategory: {},
          byWorkflowStatus: { accepted: 48, pendingReview: 2, returned: 0, missing: 0, overdue: 0, rejected: 0 },
          latestSubmissionDate: "2026-07-20",
        },
      }];
      
      const risks = buildPortfolioRisks(facilities);
      expect(risks.filter(r => !r.risk.includes("proxy")).length).toBe(0);
    });
  });
  
  describe("milestone configuration", () => {
    it("should have 9 standard milestones", () => {
      expect(GOVERNANCE_MILESTONES.length).toBe(9);
    });
    
    it("should have weight property for calculations", () => {
      GOVERNANCE_MILESTONES.forEach(m => {
        expect(m.weight).toBeGreaterThan(0);
      });
    });
  });
});
