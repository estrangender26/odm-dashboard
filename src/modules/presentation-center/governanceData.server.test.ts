/**
 * @vitest-environment node
 * Tests for governance data server functions
 */
import { describe, it, expect } from "vitest";
import { 
  buildGovernanceReport,
  GOVERNANCE_MILESTONES,
  type FacilityGovernanceData,
} from "./governanceTypes";

describe("Governance Data Server", () => {
  describe("Facilities with missing milestone rows", () => {
    it("should return facility even when no milestone rows exist", () => {
      const testDate = new Date("2026-07-25T00:00:00Z");
      
      // Facility with no milestone states - should still be returned
      const facilityData: FacilityGovernanceData = {
        facility: {
          slug: "test-facility",
          name: "Test Facility",
          shortName: "Test",
          color: "#f97316",
        },
        pppStartDate: null,
        milestones: GOVERNANCE_MILESTONES.map(m => ({
          milestoneId: m.id,
          milestoneName: m.label,
          weight: m.weight,
          plannedDate: null,
          actualDate: null,
          actualProgress: null,
          status: null,
        })),
        documentSummary: {
          totalDocuments: 0,
          byCategory: {},
          byWorkflowStatus: { accepted: 0, pendingReview: 0, returned: 0, missing: 0, overdue: 0, rejected: 0 },
          latestSubmissionDate: null,
        },
        governanceMetrics: {
          governanceReadiness: 0,
          riskLevel: "Low",
          milestones: { complete: 0, total: GOVERNANCE_MILESTONES.length },
          progress: { planned: null, actual: 0, variance: null },
          ragStatus: "gray",
        },
      };

      const report = buildGovernanceReport([facilityData], testDate);
      
      // Facility should be in the report even with no milestone rows
      expect(report.facilities).toHaveLength(1);
      expect(report.facilities[0].facility.slug).toBe("test-facility");
      expect(report.portfolio.totalFacilities).toBe(1);
    });

    it("should return all configured facilities regardless of milestone data", () => {
      const testDate = new Date("2026-07-25T00:00:00Z");
      
      // Create four facilities with varying milestone data
      const facilities = [
        { slug: "aglipay", name: "AGLIPAY STP", hasMilestones: true },
        { slug: "htt", name: "HTT STP", hasMilestones: false },
        { slug: "eastbay", name: "EASTBAY", hasMilestones: false },
        { slug: "kaysakat", name: "KAYSAKAT", hasMilestones: true },
      ];
      
      const facilityData: FacilityGovernanceData[] = facilities.map((f, idx) => ({
        facility: {
          slug: f.slug,
          name: f.name,
          shortName: f.name,
          color: ["#f97316", "#3b82f6", "#10b981", "#8b5cf6"][idx],
        },
        pppStartDate: f.hasMilestones ? "2026-01-01" : null,
        milestones: GOVERNANCE_MILESTONES.map(m => ({
          milestoneId: m.id,
          milestoneName: m.label,
          weight: m.weight,
          plannedDate: f.hasMilestones ? "2026-01-01" : null,
          actualDate: null,
          actualProgress: f.hasMilestones ? 0 : null,
          status: null,
        })),
        documentSummary: {
          totalDocuments: 0,
          byCategory: {},
          byWorkflowStatus: { accepted: 0, pendingReview: 0, returned: 0, missing: 0, overdue: 0, rejected: 0 },
          latestSubmissionDate: null,
        },
        governanceMetrics: {
          governanceReadiness: f.hasMilestones ? 0 : 0,
          riskLevel: "Low",
          milestones: { complete: 0, total: GOVERNANCE_MILESTONES.length },
          progress: { planned: f.hasMilestones ? 0 : null, actual: 0, variance: null },
          ragStatus: "gray",
        },
      }));

      const report = buildGovernanceReport(facilityData, testDate);
      
      // All four facilities should be returned
      expect(report.facilities).toHaveLength(4);
      expect(report.portfolio.totalFacilities).toBe(4);
      
      // All facility slugs should be present
      const returnedSlugs = report.facilities.map(f => f.facility.slug);
      expect(returnedSlugs).toContain("aglipay");
      expect(returnedSlugs).toContain("htt");
      expect(returnedSlugs).toContain("eastbay");
      expect(returnedSlugs).toContain("kaysakat");
    });
  });

  describe("Endpoint JSON shape", () => {
    it("should produce report with expected structure", () => {
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
          { milestoneId: "M1", milestoneName: "M1 - Test", weight: 1, plannedDate: "2026-01-01", actualDate: null, actualProgress: 50, status: "in-progress" },
        ],
        documentSummary: {
          totalDocuments: 2,
          byCategory: { "TOC-01": 2 },
          byWorkflowStatus: { accepted: 0, pendingReview: 2, returned: 0, missing: 0, overdue: 0, rejected: 0 },
          latestSubmissionDate: "2026-07-20T10:00:00Z",
        },
        governanceMetrics: {
          governanceReadiness: 50,
          riskLevel: "Low",
          milestones: { complete: 0, total: 1 },
          progress: { planned: 50, actual: 50, variance: 0 },
          ragStatus: "green",
        },
      };

      const report = buildGovernanceReport([facilityData], testDate);
      
      // Verify expected structure
      expect(report).toHaveProperty("reportingDate");
      expect(report).toHaveProperty("facilities");
      expect(report).toHaveProperty("portfolio");
      
      expect(report).toHaveProperty("dataQuality");
      
      expect(Array.isArray(report.facilities)).toBe(true);
      expect(report.facilities.length).toBeGreaterThan(0);
      
      // Verify portfolio structure
      expect(report.portfolio).toHaveProperty("totalFacilities");
      expect(report.portfolio).toHaveProperty("submissionCoverageProxy");
      expect(report.portfolio).toHaveProperty("requiredMilestoneSubmissionProxy");
    });
  });

  describe("Generator receives non-empty array", () => {
    it("should return facilities array that can be consumed by generator", () => {
      const testDate = new Date("2026-07-25T00:00:00Z");
      
      const facilityData: FacilityGovernanceData[] = [
        {
          facility: {
            slug: "facility-1",
            name: "Facility One",
            shortName: "Fac1",
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
        },
        {
          facility: {
            slug: "facility-2",
            name: "Facility Two",
            shortName: "Fac2",
            color: "#3b82f6",
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
        },
      ];

      const report = buildGovernanceReport(facilityData, testDate);
      
      // Generator expects non-empty facilities array
      expect(report.facilities).toBeInstanceOf(Array);
      expect(report.facilities.length).toBeGreaterThan(0);
      expect(report.portfolio.totalFacilities).toBeGreaterThan(0);
    });
  });
});
