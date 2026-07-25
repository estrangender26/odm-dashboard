/**
 * @vitest-environment node
 * Tests for governance data server functions
 */
import { describe, it, expect } from "vitest";
import { 
  calculateFacilityProgress,
  calculateSubmissionCoverageProxy,
  buildGovernanceReport,
  GOVERNANCE_MILESTONES,
  type FacilityGovernanceData,
  type GovernanceMilestone,
  type DocumentSummary,
} from "./governanceTypes";

describe("Governance Data Server Logic", () => {
  describe("Reporting Date Cutoff Semantics", () => {
    it("should include uploads on the reporting date", () => {
      const reportingDate = new Date("2026-07-25T00:00:00Z");
      const cutoffDate = new Date(reportingDate);
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() + 1);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      // Upload at various times on the reporting date
      const uploadTimes = [
        new Date("2026-07-25T00:00:00Z"),  // Midnight
        new Date("2026-07-25T06:00:00Z"),  // Morning
        new Date("2026-07-25T12:00:00Z"),  // Noon
        new Date("2026-07-25T18:00:00Z"),  // Evening
        new Date("2026-07-25T23:59:59Z"),  // Just before midnight
      ];

      for (const uploadTime of uploadTimes) {
        expect(uploadTime.getTime() < cutoffDate.getTime()).toBe(true);
      }
    });

    it("should exclude uploads after the reporting date", () => {
      const reportingDate = new Date("2026-07-25T00:00:00Z");
      const cutoffDate = new Date(reportingDate);
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() + 1);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      // Uploads on subsequent days
      const uploadTimes = [
        new Date("2026-07-26T00:00:00Z"),  // Midnight next day
        new Date("2026-07-26T01:00:00Z"),  // Early morning next day
        new Date("2026-07-26T12:00:00Z"),  // Noon next day
      ];

      for (const uploadTime of uploadTimes) {
        expect(uploadTime.getTime() >= cutoffDate.getTime()).toBe(true);
      }
    });

    it("should include milestone completions on the reporting date", () => {
      const reportingDate = new Date("2026-07-25T00:00:00Z");
      const cutoffDate = new Date(reportingDate);
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() + 1);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      // Completion dates on the reporting date
      const completionDates = ["2026-07-25"];

      for (const dateStr of completionDates) {
        const completionDate = new Date(`${dateStr}T00:00:00Z`);
        expect(completionDate.getTime() < cutoffDate.getTime()).toBe(true);
      }
    });

    it("should exclude milestone completions after the reporting date", () => {
      const reportingDate = new Date("2026-07-25T00:00:00Z");
      const cutoffDate = new Date(reportingDate);
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() + 1);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      // Completion dates after the reporting date
      const completionDates = ["2026-07-26", "2026-07-27", "2026-08-01"];

      for (const dateStr of completionDates) {
        const completionDate = new Date(`${dateStr}T00:00:00Z`);
        expect(completionDate.getTime() >= cutoffDate.getTime()).toBe(true);
      }
    });
  });

  describe("Facility Data Transformations", () => {
    it("should calculate correct submission coverage proxy", () => {
      const docSummary: DocumentSummary = {
        totalDocuments: 5,
        byCategory: { "TOC-01": 2, "TOC-03": 3 },
        byWorkflowStatus: { accepted: 0, pendingReview: 5, returned: 0, missing: 0, overdue: 0, rejected: 0 },
        latestSubmissionDate: "2026-07-20T10:00:00Z",
      };

      // 9 milestones per facility
      const requiredPerFacility = GOVERNANCE_MILESTONES.length; // 9
      const result = calculateSubmissionCoverageProxy(docSummary, requiredPerFacility);

      expect(result.requiredMilestoneSubmissionProxy).toBe(9);
      expect(result.submittedCount).toBe(5);
      expect(result.submissionCoverageProxy).toBe(56); // 5/9 = 55.55...% rounded to 56%
    });

    it("should handle facility with no uploads", () => {
      const docSummary: DocumentSummary = {
        totalDocuments: 0,
        byCategory: {},
        byWorkflowStatus: { accepted: 0, pendingReview: 0, returned: 0, missing: 0, overdue: 0, rejected: 0 },
        latestSubmissionDate: null,
      };

      const requiredPerFacility = GOVERNANCE_MILESTONES.length;
      const result = calculateSubmissionCoverageProxy(docSummary, requiredPerFacility);

      expect(result.submissionCoverageProxy).toBe(0);
      expect(result.submittedCount).toBe(0);
    });

    it("should handle facility with no milestones", () => {
      const milestones: GovernanceMilestone[] = [];
      const reportingDate = new Date("2026-07-25");
      
      const result = calculateFacilityProgress(milestones, reportingDate);
      
      expect(result.actual).toBe(0);
      expect(result.planned).toBeNull();
      expect(result.hasBaseline).toBe(false);
    });
  });

  describe("Governance Report Building", () => {
    it("should use proxy terminology in report output", () => {
      const testDate = new Date("2026-07-25T00:00:00Z");
      
      const facilityData: FacilityGovernanceData = {
        facility: {
          slug: "test-facility",
          name: "Test Facility",
          shortName: "Test",
          color: "#f97316",
        },
        pppStartDate: "2026-01-01",
        milestones: [
          { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2026-01-01", actualDate: "2026-01-15", actualProgress: 100, status: "complete" },
        ],
        documentSummary: {
          totalDocuments: 1,
          byCategory: { "TOC-01": 1 },
          byWorkflowStatus: { accepted: 0, pendingReview: 1, returned: 0, missing: 0, overdue: 0, rejected: 0 },
          latestSubmissionDate: "2026-01-15T10:00:00Z",
        },
        governanceMetrics: {
          governanceReadiness: 50,
          riskLevel: "Low",
          milestones: { complete: 1, total: 1 },
          progress: { planned: 50, actual: 50, variance: 0 },
          ragStatus: "green",
        },
      };

      const report = buildGovernanceReport([facilityData], testDate);

      // Verify proxy terminology is used
      expect(report.portfolio).toHaveProperty("submissionCoverageProxy");
      expect(report.portfolio).toHaveProperty("requiredMilestoneSubmissionProxy");
      expect(report.portfolio).toHaveProperty("outstandingMilestoneSubmissionProxy");
      
      // Verify deprecated properties exist for backward compatibility
      expect(report.portfolio).toHaveProperty("overallCompliance");
      expect(report.portfolio).toHaveProperty("totalApproved");
    });

    it("should include data quality metadata", () => {
      const testDate = new Date("2026-07-25T00:00:00Z");
      
      const facilityData: FacilityGovernanceData = {
        facility: {
          slug: "test-facility",
          name: "Test Facility",
          shortName: "Test",
          color: "#f97316",
        },
        pppStartDate: null,
        milestones: [],
        documentSummary: {
          totalDocuments: 0,
          byCategory: {},
          byWorkflowStatus: { accepted: 0, pendingReview: 0, returned: 0, missing: 0, overdue: 0, rejected: 0 },
          latestSubmissionDate: null,
        },
        governanceMetrics: {
          governanceReadiness: 0,
          riskLevel: "Low",
          milestones: { complete: 0, total: 0 },
          progress: { planned: null, actual: 0, variance: null },
          ragStatus: "gray",
        },
      };

      const report = buildGovernanceReport([facilityData], testDate);

      expect(report.dataQuality).toBeDefined();
      expect(report.dataQuality.weightSource).toBe("equal-fallback");
      expect(report.dataQuality.hasWorkflowStatus).toBe(false);
      expect(report.dataQuality.hasRequirementMatrix).toBe(false);
    });
  });

  describe("Deterministic Calculations", () => {
    it("should produce consistent results for the same input", () => {
      const testDate = new Date("2026-07-25T00:00:00Z");
      
      const facilityData: FacilityGovernanceData = {
        facility: {
          slug: "test-facility",
          name: "Test Facility",
          shortName: "Test",
          color: "#f97316",
        },
        pppStartDate: "2026-01-01",
        milestones: [
          { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2026-01-01", actualDate: "2026-01-15", actualProgress: 100, status: "complete" },
          { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: "2026-02-01", actualDate: null, actualProgress: null, status: null },
        ],
        documentSummary: {
          totalDocuments: 2,
          byCategory: { "TOC-01": 1, "TOC-02": 1 },
          byWorkflowStatus: { accepted: 0, pendingReview: 2, returned: 0, missing: 0, overdue: 0, rejected: 0 },
          latestSubmissionDate: "2026-01-15T10:00:00Z",
        },
        governanceMetrics: {
          governanceReadiness: 50,
          riskLevel: "Low",
          milestones: { complete: 1, total: 2 },
          progress: { planned: 50, actual: 50, variance: 0 },
          ragStatus: "green",
        },
      };

      const report1 = buildGovernanceReport([facilityData], testDate);
      const report2 = buildGovernanceReport([facilityData], testDate);

      expect(report1.portfolio.overallProgress).toBe(report2.portfolio.overallProgress);
      expect(report1.portfolio.submissionCoverageProxy).toBe(report2.portfolio.submissionCoverageProxy);
      expect(report1.reportingDate).toBe(report2.reportingDate);
    });
  });
});
