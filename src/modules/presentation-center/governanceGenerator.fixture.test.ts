/**
 * Tests for the deterministic July 2026 fixture values
 */

import { describe, it, expect } from "vitest";
import { createDeterministicTestFixture } from "./governanceGenerator";
import { buildGovernanceReport } from "./governanceTypes";
import { getSCurveValueAtReportingDate } from "./governanceTemplateGenerator";

describe("July 2026 Fixture Values", () => {
  const reportingDate = new Date("2026-07-25T00:00:00Z");
  
  it("Aglipay STP should have 44% planned and 44% actual at 2026-07-25", () => {
    const facilities = createDeterministicTestFixture();
    const aglipay = facilities.find(f => f.facility.slug === "aglipay");
    
    expect(aglipay).toBeDefined();
    
    // Count milestones before reporting date
    const plannedBefore = aglipay!.milestones.filter(
      m => m.plannedDate && new Date(m.plannedDate) <= reportingDate
    ).length;
    const actualBefore = aglipay!.milestones.filter(
      m => m.actualDate && new Date(m.actualDate) <= reportingDate
    ).length;
    
    expect(plannedBefore).toBe(4); // 4/9 = 44%
    expect(actualBefore).toBe(4); // 4/9 = 44%
    
    // Verify using the S-curve calculation
    const report = buildGovernanceReport(facilities, reportingDate);
    const aglipaySummary = report.facilities.find(f => f.facility.slug === "aglipay");
    const planned = getSCurveValueAtReportingDate(aglipaySummary!.sCurve, reportingDate, "planned");
    const actual = getSCurveValueAtReportingDate(aglipaySummary!.sCurve, reportingDate, "actual");
    
    expect(planned).toBe(44);
    expect(actual).toBe(44);
  });
  
  it("HTT STP should have 44% planned and 44% actual at 2026-07-25", () => {
    const facilities = createDeterministicTestFixture();
    const htt = facilities.find(f => f.facility.slug === "htt");
    
    expect(htt).toBeDefined();
    
    const plannedBefore = htt!.milestones.filter(
      m => m.plannedDate && new Date(m.plannedDate) <= reportingDate
    ).length;
    const actualBefore = htt!.milestones.filter(
      m => m.actualDate && new Date(m.actualDate) <= reportingDate
    ).length;
    
    expect(plannedBefore).toBe(4); // 4/9 = 44%
    expect(actualBefore).toBe(4); // 4/9 = 44%
    
    const report = buildGovernanceReport(facilities, reportingDate);
    const httSummary = report.facilities.find(f => f.facility.slug === "htt");
    const planned = getSCurveValueAtReportingDate(httSummary!.sCurve, reportingDate, "planned");
    const actual = getSCurveValueAtReportingDate(httSummary!.sCurve, reportingDate, "actual");
    
    expect(planned).toBe(44);
    expect(actual).toBe(44);
  });
  
  it("Eastbay PH-2 TP should have 22% planned and 11% actual at 2026-07-25", () => {
    const facilities = createDeterministicTestFixture();
    const eastbay = facilities.find(f => f.facility.slug === "eastbay");
    
    expect(eastbay).toBeDefined();
    
    const plannedBefore = eastbay!.milestones.filter(
      m => m.plannedDate && new Date(m.plannedDate) <= reportingDate
    ).length;
    const actualBefore = eastbay!.milestones.filter(
      m => m.actualDate && new Date(m.actualDate) <= reportingDate
    ).length;
    
    expect(plannedBefore).toBe(2); // 2/9 = 22%
    expect(actualBefore).toBe(1); // 1/9 = 11%
    
    const report = buildGovernanceReport(facilities, reportingDate);
    const eastbaySummary = report.facilities.find(f => f.facility.slug === "eastbay");
    const planned = getSCurveValueAtReportingDate(eastbaySummary!.sCurve, reportingDate, "planned");
    const actual = getSCurveValueAtReportingDate(eastbaySummary!.sCurve, reportingDate, "actual");
    
    expect(planned).toBe(22);
    expect(actual).toBe(11);
  });
  
  it("Kaysakat TP should have 33% planned and 0% actual at 2026-07-25", () => {
    const facilities = createDeterministicTestFixture();
    const kaysakat = facilities.find(f => f.facility.slug === "kaysakat");
    
    expect(kaysakat).toBeDefined();
    
    const plannedBefore = kaysakat!.milestones.filter(
      m => m.plannedDate && new Date(m.plannedDate) <= reportingDate
    ).length;
    const actualBefore = kaysakat!.milestones.filter(
      m => m.actualDate && new Date(m.actualDate) <= reportingDate
    ).length;
    
    expect(plannedBefore).toBe(3); // 3/9 = 33%
    expect(actualBefore).toBe(0); // 0/9 = 0%
    
    const report = buildGovernanceReport(facilities, reportingDate);
    const kaysakatSummary = report.facilities.find(f => f.facility.slug === "kaysakat");
    const planned = getSCurveValueAtReportingDate(kaysakatSummary!.sCurve, reportingDate, "planned");
    const actual = getSCurveValueAtReportingDate(kaysakatSummary!.sCurve, reportingDate, "actual");
    
    expect(planned).toBe(33);
    expect(actual).toBe(0);
  });
});
