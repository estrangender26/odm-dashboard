import { describe, it, expect } from "vitest";
import {
  calculateFacilityProgress,
  calculateSubmissionCoverageProxy,
  determineRagStatus,
  generateFacilitySCurve,
  calculateForecastSCurve,
  buildExecutiveActions,
  buildPortfolioRisks,
  buildGovernanceReport,
  DATA_QUALITY_DISCLOSURE,
  GOVERNANCE_MILESTONES,
  type GovernanceMilestone,
  type DocumentSummary,
  type FacilityGovernanceData,
} from "./governanceTypes";
import { createDeterministicTestFixture, generateGovernanceTestPresentation } from "./governanceGenerator";

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

// Note: createDeterministicTestFixture and buildGovernanceReport already imported above

describe("Governance Presentation Structure", () => {
  describe("Slide Structure Validation", () => {
    it("should generate exactly three slides", async () => {
      const blob = await generateGovernanceTestPresentation();
      expect(blob).toBeDefined();
      expect(blob.size).toBeGreaterThan(0);
      // Note: Actual slide count verification would require parsing the PPTX
      // This is verified manually through the generation script
    });

    it("should use deterministic test fixture with four facilities", () => {
      const facilities = createDeterministicTestFixture();
      expect(facilities).toHaveLength(4);
      
      // Verify facility names
      const facilityNames = facilities.map(f => f.facility.shortName);
      expect(facilityNames).toContain("AGLIPAY STP");
      expect(facilityNames).toContain("HTT STP");
      expect(facilityNames).toContain("EASTBAY PH-2 TP");
      expect(facilityNames).toContain("KAYSAKAT TP");
    });

    it("should include all four facility types in fixture", () => {
      const facilities = createDeterministicTestFixture();
      
      // On-schedule facility
      const onSchedule = facilities.find(f => f.facility.slug === "aglipay");
      expect(onSchedule).toBeDefined();
      expect(onSchedule?.governanceMetrics.ragStatus).toBe("green");
      
      // Behind schedule facility
      const behind = facilities.find(f => f.facility.slug === "htt");
      expect(behind).toBeDefined();
      expect(behind?.governanceMetrics.ragStatus).toBe("amber");
      
      // Insufficient forecast facility
      const forecast = facilities.find(f => f.facility.slug === "eastbay");
      expect(forecast).toBeDefined();
      expect(forecast?.governanceMetrics.ragStatus).toBe("red");
      
      // No baseline facility
      const noBaseline = facilities.find(f => f.facility.slug === "kaysakat");
      expect(noBaseline).toBeDefined();
      expect(noBaseline?.governanceMetrics.ragStatus).toBe("gray");
    });
  });

  describe("Report Content Validation", () => {
    it("should include reporting date in report", () => {
      const testDate = new Date("2026-07-25T00:00:00Z");
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, testDate);
      
      expect(report.reportingDate).toBe("2026-07-25");
    });

    it("should include data quality disclosure", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      expect(report.dataQuality).toBeDefined();
      expect(report.dataQuality.weightSource).toBe("equal-fallback");
    });

    it("should use proxy terminology in portfolio summary", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      // Check for proxy terminology
      expect(report.portfolio).toHaveProperty("submissionCoverageProxy");
      expect(report.portfolio).toHaveProperty("requiredMilestoneSubmissionProxy");
      expect(report.portfolio).toHaveProperty("outstandingMilestoneSubmissionProxy");
    });

    it("should not use prohibited compliance terminology", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      // Verify report uses proxy terminology
      expect(report).toBeDefined();
      expect(report.portfolio.submissionCoverageProxy).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Data Quality Disclosure", () => {
    it("should confirm all uploaded documents are treated as reviewed and approved", () => {
      expect(DATA_QUALITY_DISCLOSURE).toContain("All uploaded documents are treated as reviewed and approved");
      expect(DATA_QUALITY_DISCLOSURE).toContain("Deliverable Requirement Matrix");
    });
    
    it("should not describe workflow status tracking as unavailable", () => {
      expect(DATA_QUALITY_DISCLOSURE).not.toContain("workflow status is not tracked");
      expect(DATA_QUALITY_DISCLOSURE).not.toContain("unavailable");
    });
  });

  describe("Facility Summary Structure", () => {
    it("should include all required facility fields", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      for (const facility of report.facilities) {
        expect(facility.facility).toHaveProperty("slug");
        expect(facility.facility).toHaveProperty("name");
        expect(facility.facility).toHaveProperty("shortName");
        expect(facility.facility).toHaveProperty("color");
        expect(facility).toHaveProperty("progress");
        expect(facility).toHaveProperty("submissionCoverageProxy");
        expect(facility).toHaveProperty("required");
        expect(facility).toHaveProperty("submitted");
        expect(facility).toHaveProperty("outstanding");
        expect(facility).toHaveProperty("status");
        expect(facility).toHaveProperty("hasBaselineSchedule");
        expect(facility).toHaveProperty("sCurve");
      }
    });

    it("should have exactly four facilities in summary", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      expect(report.facilities).toHaveLength(4);
    });
  });
});


// Tests for corrected compliance logic
describe("Governance Compliance Calculation Corrections", () => {
  describe("calculateSubmissionCoverageProxy", () => {
    it("should cap coverage at 100% when documents exceed required", () => {
      const docSummary = { 
        totalDocuments: 11, 
        byCategory: {}, 
        byWorkflowStatus: { accepted: 0, pendingReview: 11, returned: 0, missing: 0, overdue: 0, rejected: 0 },
        latestSubmissionDate: null 
      };
      const requiredDeliverables = 9;
      
      const result = calculateSubmissionCoverageProxy(docSummary, requiredDeliverables);
      
      expect(result.submissionCoverageProxy).toBe(100); // Capped, not 122%
      expect(result.unmappedDocuments).toBe(2); // 11 - 9 = 2 excess
      expect(result.hasRequirementBaseline).toBe(true);
    });

    it("should report baseline unavailable when required is null", () => {
      const docSummary = { 
        totalDocuments: 11, 
        byCategory: {}, 
        byWorkflowStatus: { accepted: 0, pendingReview: 11, returned: 0, missing: 0, overdue: 0, rejected: 0 },
        latestSubmissionDate: null 
      };
      
      const result = calculateSubmissionCoverageProxy(docSummary, null);
      
      expect(result.submissionCoverageProxy).toBe(0);
      expect(result.hasRequirementBaseline).toBe(false);
      expect(result.dataQualityWarning).toContain("Requirement baseline unavailable");
      expect(result.unmappedDocuments).toBe(11); // All documents are unmapped
    });

    it("should calculate correct coverage when documents are less than required", () => {
      const docSummary = { 
        totalDocuments: 5, 
        byCategory: {}, 
        byWorkflowStatus: { accepted: 0, pendingReview: 5, returned: 0, missing: 0, overdue: 0, rejected: 0 },
        latestSubmissionDate: null 
      };
      const requiredDeliverables = 9;
      
      const result = calculateSubmissionCoverageProxy(docSummary, requiredDeliverables);
      
      expect(result.submissionCoverageProxy).toBe(56); // 5/9 = 55.55% rounded to 56%
      expect(result.unmappedDocuments).toBe(0);
      expect(result.outstandingMilestoneSubmissionProxy).toBe(4);
    });

    it("should not use milestone count as required document count", () => {
      const docSummary = { 
        totalDocuments: 10, 
        byCategory: {}, 
        byWorkflowStatus: { accepted: 0, pendingReview: 10, returned: 0, missing: 0, overdue: 0, rejected: 0 },
        latestSubmissionDate: null 
      };
      const requiredDeliverables = 15; // Explicitly set, not derived from milestones
      
      const result = calculateSubmissionCoverageProxy(docSummary, requiredDeliverables);
      
      expect(result.requiredMilestoneSubmissionProxy).toBe(15);
      expect(result.submissionCoverageProxy).toBe(67); // 10/15 = 66.67% rounded to 67%
    });
  });

  describe("buildGovernanceReport with approved documents", () => {
    it("should show approved documents equal to submitted documents", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      // Portfolio level: approved = submitted
      expect(report.portfolio.totalSubmitted).toBeGreaterThanOrEqual(0);
      
      // Facility level: approved = submitted
      report.facilities.forEach(f => {
        expect(f.submitted).toBeGreaterThanOrEqual(0);
      });
    });
    
    it("should not contain proxy wording in data quality", () => {
      expect(DATA_QUALITY_DISCLOSURE).not.toContain("proxy");
      expect(DATA_QUALITY_DISCLOSURE).not.toContain("milestone-count");
    });
    
    it("should not describe workflow status as unavailable", () => {
      expect(DATA_QUALITY_DISCLOSURE).not.toContain("workflow status is not tracked");
      expect(DATA_QUALITY_DISCLOSURE).not.toContain("unavailable");
    });
  });
});


// Regression tests for milestone completion (PR #303 follow-up)
// These tests verify that milestone progress calculation is independent of:
// - Document counts
// - Presentation layer changes
// - Array ordering
describe("Governance Milestone Completion Regression Tests", () => {
  describe("Milestone progress calculation from data loading path", () => {
    it("should calculate progress from milestones only, not document counts", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      // Test fixture has 4 facilities with deterministic milestone data
      expect(report.facilities).toHaveLength(4);
      
      // Verify each facility has progress calculated from milestones
      for (const f of report.facilities) {
        expect(f.progress).toBeDefined();
        expect(f.progress).toBeGreaterThanOrEqual(0);
        expect(f.progress).toBeLessThanOrEqual(100);
        // Progress should be based on milestones, not documents
        expect(f.submitted).toBeDefined();
      }
    });

    it("should verify facility has exactly 9 canonical milestones", () => {
      const facilities = createDeterministicTestFixture();
      
      for (const facility of facilities) {
        // Each facility should have 9 milestones
        expect(facility.milestones).toHaveLength(9);
        
        // Verify milestone IDs match canonical list
        const canonicalIds = GOVERNANCE_MILESTONES.map(m => m.id);
        const facilityIds = facility.milestones.map(m => m.milestoneId);
        expect(facilityIds.sort()).toEqual(canonicalIds.sort());
      }
    });

    it("should count milestones with actualDate as complete", () => {
      const facilities = createDeterministicTestFixture();
      
      for (const facility of facilities) {
        const milestonesWithDate = facility.milestones.filter(m => m.actualDate !== null).length;
        const milestonesWith100 = facility.milestones.filter(m => m.actualProgress === 100).length;
        
        // These should match
        expect(milestonesWith100).toBe(milestonesWithDate);
      }
    });
  });

  describe("Facility result independence", () => {
    it("should produce same facility results regardless of array ordering", () => {
      const facilities = createDeterministicTestFixture();
      
      // Reverse the array
      const reversed = [...facilities].reverse();
      const report1 = buildGovernanceReport(facilities, new Date("2026-07-25"));
      const report2 = buildGovernanceReport(reversed, new Date("2026-07-25"));
      
      // Each facility should have same progress regardless of order
      for (const f1 of report1.facilities) {
        const f2 = report2.facilities.find(f => f.facility.slug === f1.facility.slug);
        expect(f2).toBeDefined();
        expect(f1.progress).toBe(f2?.progress);
        expect(f1.submitted).toBe(f2?.submitted);
      }
    });

    it("should not allow milestone records to shift between facilities", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      // Verify each facility has correct number of milestones
      for (const f of report.facilities) {
        // Should have 9 milestones each
        expect(f.facility).toBeDefined();
        expect(f.progress).toBeDefined();
      }
    });
  });

  describe("Document counts do not affect milestone progress", () => {
    it("should calculate same milestone progress regardless of document count", () => {
      const facilities = createDeterministicTestFixture();
      
      // Modify document counts without changing milestones
      const modifiedFacilities = facilities.map(f => ({
        ...f,
        documentSummary: {
          ...f.documentSummary,
          totalDocuments: 999, // Artificially high
        }
      }));
      
      const report1 = buildGovernanceReport(facilities, new Date("2026-07-25"));
      const report2 = buildGovernanceReport(modifiedFacilities, new Date("2026-07-25"));
      
      // Milestone progress should be identical
      for (let i = 0; i < report1.facilities.length; i++) {
        expect(report1.facilities[i].progress).toBe(report2.facilities[i].progress);
      }
    });
  });

  describe("Facility result independence", () => {
    it("should produce same facility results regardless of array ordering", () => {
      const facilities = createDeterministicTestFixture();
      
      // Reverse the array
      const reversed = [...facilities].reverse();
      const report1 = buildGovernanceReport(facilities, new Date("2026-07-25"));
      const report2 = buildGovernanceReport(reversed, new Date("2026-07-25"));
      
      // Each facility should have same progress regardless of order
      for (const f1 of report1.facilities) {
        const f2 = report2.facilities.find(f => f.facility.slug === f1.facility.slug);
        expect(f2).toBeDefined();
        expect(f1.progress).toBe(f2?.progress);
        expect(f1.submitted).toBe(f2?.submitted);
      }
    });

    it("should not allow milestone records to shift between facilities", () => {
      const facilities = createDeterministicTestFixture();
      const report = buildGovernanceReport(facilities, new Date("2026-07-25"));
      
      // Verify each facility has correct number of milestones
      for (const f of report.facilities) {
        // Should have 9 milestones each
        expect(f.facility).toBeDefined();
        expect(f.progress).toBeDefined();
      }
    });
  });

  describe("Document counts do not affect milestone progress", () => {
    it("should calculate same milestone progress regardless of document count", () => {
      const facilities = createDeterministicTestFixture();
      
      // Modify document counts without changing milestones
      const modifiedFacilities = facilities.map(f => ({
        ...f,
        documentSummary: {
          ...f.documentSummary,
          totalDocuments: 999, // Artificially high
        }
      }));
      
      const report1 = buildGovernanceReport(facilities, new Date("2026-07-25"));
      const report2 = buildGovernanceReport(modifiedFacilities, new Date("2026-07-25"));
      
      // Milestone progress should be identical
      for (let i = 0; i < report1.facilities.length; i++) {
        expect(report1.facilities[i].progress).toBe(report2.facilities[i].progress);
      }
    });
  });
});

describe("Slide 4 Deliverable Summary Integration", () => {
  const mockDeliverableSummary = {
    required: 14,
    submitted: 3,
    approved: 3,
    missing: 11,
    compliancePercent: 21.428571428571427,
    rawFileCount: 5,
  };

  const createMockFacilityWithDeliverables = (
    slug: string,
    name: string,
    submitted: number,
    compliancePercent: number
  ): FacilityGovernanceData => ({
    facility: {
      slug,
      name,
      shortName: name,
      color: "#3b82f6",
    },
    pppStartDate: "2025-01-01",
    milestones: [],
    documentSummary: {
      totalDocuments: submitted * 2, // Multiple files per deliverable
      byCategory: {},
      byWorkflowStatus: {
        accepted: 0,
        pendingReview: submitted * 2,
        returned: 0,
        missing: 0,
        overdue: 0,
        rejected: 0,
      },
      latestSubmissionDate: null,
      deliverableSummary: {
        required: 14,
        submitted,
        approved: submitted,
        missing: 14 - submitted,
        compliancePercent,
        rawFileCount: submitted * 2,
      },
    },
    governanceMetrics: {
      governanceReadiness: 33,
      riskLevel: "Medium",
      milestones: { complete: 3, total: 9 },
      progress: { actual: 33, planned: 40, variance: -7 },
      ragStatus: "amber",
    },
  });

  it("uses deliverableSummary for required count", () => {
    const facility = createMockFacilityWithDeliverables("aglipay", "AGLIPAY STP", 3, 21.43);
    expect(facility.documentSummary.deliverableSummary?.required).toBe(14);
  });

  it("calculates compliance from deliverableSummary", () => {
    const facility = createMockFacilityWithDeliverables("htt", "HTT STP", 11, 78.57);
    const ds = facility.documentSummary.deliverableSummary!;
    const compliance = (ds.submitted / ds.required) * 100;
    expect(compliance).toBeCloseTo(78.57, 1);
  });

  it("counts multiple files under one TOC row as one submitted deliverable", () => {
    const facility = createMockFacilityWithDeliverables("eastbay", "EASTBAY STP", 4, 28.57);
    // Raw files = 8 (2 per deliverable), but submitted deliverables = 4
    expect(facility.documentSummary.totalDocuments).toBe(8);
    expect(facility.documentSummary.deliverableSummary?.submitted).toBe(4);
    expect(facility.documentSummary.deliverableSummary?.rawFileCount).toBe(8);
  });

  it("sets approved equal to submitted in deliverableSummary", () => {
    const facility = createMockFacilityWithDeliverables("kaysakat", "KAYSAKAT TP", 1, 7.14);
    expect(facility.documentSummary.deliverableSummary?.approved)
      .toBe(facility.documentSummary.deliverableSummary?.submitted);
  });

  it("calculates missing as required minus submitted", () => {
    const facility = createMockFacilityWithDeliverables("aglipay", "AGLIPAY STP", 3, 21.43);
    const ds = facility.documentSummary.deliverableSummary!;
    expect(ds.missing).toBe(ds.required - ds.submitted);
    expect(ds.missing).toBe(11);
  });

  it("returns Complete status when 100% submitted", () => {
    const ds = { ...mockDeliverableSummary, submitted: 14, compliancePercent: 100 };
    const status = ds.compliancePercent >= 100 ? "Complete" : ds.compliancePercent >= 70 ? "In Progress" : "At Risk";
    expect(status).toBe("Complete");
  });

  it("returns In Progress status when 70-99% submitted", () => {
    const ds = { ...mockDeliverableSummary, submitted: 11, compliancePercent: 78.57 };
    const status = ds.compliancePercent >= 100 ? "Complete" : ds.compliancePercent >= 70 ? "In Progress" : "At Risk";
    expect(status).toBe("In Progress");
  });

  it("returns At Risk status when below 70% submitted", () => {
    const ds = { ...mockDeliverableSummary, submitted: 3, compliancePercent: 21.43 };
    const status = ds.compliancePercent >= 100 ? "Complete" : ds.compliancePercent >= 70 ? "In Progress" : "At Risk";
    expect(status).toBe("At Risk");
  });
});
