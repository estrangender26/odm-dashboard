/**
 * Tests for Governance Template Generator
 */

import { describe, it, expect } from "vitest";
import {
  getSCurveValueAtReportingDate,
  calculateConsolidatedSCurve,
} from "./governanceTemplateGenerator";
import type { SCurvePoint, FacilityPresentationSummary } from "./governanceTypes";

describe("getSCurveValueAtReportingDate", () => {
  const mockPoints: SCurvePoint[] = [
    { date: "2026-01-01", planned: 11, actual: 11, forecast: null },
    { date: "2026-02-01", planned: 22, actual: 22, forecast: null },
    { date: "2026-03-01", planned: 33, actual: 33, forecast: null },
    { date: "2026-04-01", planned: 44, actual: 44, forecast: null },
    { date: "2026-05-01", planned: 55, actual: 55, forecast: null },
    { date: "2026-06-01", planned: 66, actual: 66, forecast: null },
    { date: "2026-07-01", planned: 77, actual: 77, forecast: null },
  ];

  it("should return value at exact reporting date", () => {
    const reportingDate = new Date("2026-04-01");
    const result = getSCurveValueAtReportingDate(mockPoints, reportingDate, "planned");
    expect(result).toBe(44);
  });

  it("should return value at date immediately before reporting date", () => {
    const reportingDate = new Date("2026-04-15");
    const result = getSCurveValueAtReportingDate(mockPoints, reportingDate, "planned");
    expect(result).toBe(44);
  });

  it("should ignore future points", () => {
    const reportingDate = new Date("2026-03-15");
    const result = getSCurveValueAtReportingDate(mockPoints, reportingDate, "planned");
    expect(result).toBe(33);
  });

  it("should handle unsorted points", () => {
    const unsortedPoints = [
      { date: "2026-04-01", planned: 44, actual: 44, forecast: null },
      { date: "2026-01-01", planned: 11, actual: 11, forecast: null },
      { date: "2026-03-01", planned: 33, actual: 33, forecast: null },
    ];
    const reportingDate = new Date("2026-02-15");
    const result = getSCurveValueAtReportingDate(unsortedPoints, reportingDate, "planned");
    expect(result).toBe(11);
  });

  it("should return null when no points before reporting date", () => {
    const reportingDate = new Date("2025-12-01");
    const result = getSCurveValueAtReportingDate(mockPoints, reportingDate, "planned");
    expect(result).toBeNull();
  });

  it("should return null for empty series", () => {
    const result = getSCurveValueAtReportingDate([], new Date("2026-04-01"), "planned");
    expect(result).toBeNull();
  });
});

describe("July 2026 Regression Fixture", () => {
  const julyReportingDate = new Date("2026-07-25");

  // Aglipay: 44% = 4/9 milestones at or before 2026-07-25
  const aglipaySCurve: SCurvePoint[] = [
    { date: "2026-01-01", planned: 0, actual: 0, forecast: null },
    { date: "2026-02-01", planned: 11, actual: 11, forecast: null },
    { date: "2026-03-01", planned: 22, actual: 22, forecast: null },
    { date: "2026-04-01", planned: 33, actual: 33, forecast: null },
    { date: "2026-05-01", planned: 44, actual: 44, forecast: null }, // 44% at July 25
    { date: "2026-08-01", planned: 55, actual: 55, forecast: null }, // Future (Aug > July 25)
  ];

  // HTT: Same as Aglipay
  const httSCurve: SCurvePoint[] = [
    { date: "2026-01-01", planned: 0, actual: 0, forecast: null },
    { date: "2026-02-01", planned: 11, actual: 11, forecast: null },
    { date: "2026-03-01", planned: 22, actual: 22, forecast: null },
    { date: "2026-04-01", planned: 33, actual: 33, forecast: null },
    { date: "2026-05-01", planned: 44, actual: 44, forecast: null }, // 44% at July 25
    { date: "2026-08-01", planned: 55, actual: null, forecast: null },
  ];

  // Eastbay: 22% planned = 2/9, 11% actual = 1/9
  const eastbaySCurve: SCurvePoint[] = [
    { date: "2026-01-01", planned: 0, actual: 0, forecast: null },
    { date: "2026-02-01", planned: 11, actual: 11, forecast: null }, // 1/9 actual
    { date: "2026-03-01", planned: 22, actual: 11, forecast: null }, // 22% planned, 11% actual at July 25
    { date: "2026-08-01", planned: 33, actual: 22, forecast: null }, // Future (Aug > July 25)
  ];

  // Kaysakat: 33% planned = 3/9, 0% actual = 0/9
  const kaysakatSCurve: SCurvePoint[] = [
    { date: "2026-01-01", planned: 0, actual: 0, forecast: null },
    { date: "2026-02-01", planned: 11, actual: 0, forecast: null },
    { date: "2026-03-01", planned: 22, actual: 0, forecast: null },
    { date: "2026-04-01", planned: 33, actual: 0, forecast: null }, // 33% planned at July 25
    { date: "2026-08-01", planned: 44, actual: 0, forecast: null }, // Future (Aug > July 25)
  ];

  it("Aglipay = 44% planned, 44% actual at July 25, 2026", () => {
    expect(getSCurveValueAtReportingDate(aglipaySCurve, julyReportingDate, "planned")).toBe(44);
    expect(getSCurveValueAtReportingDate(aglipaySCurve, julyReportingDate, "actual")).toBe(44);
  });

  it("HTT = 44% planned, 44% actual at July 25, 2026", () => {
    expect(getSCurveValueAtReportingDate(httSCurve, julyReportingDate, "planned")).toBe(44);
    expect(getSCurveValueAtReportingDate(httSCurve, julyReportingDate, "actual")).toBe(44);
  });

  it("Eastbay = 22% planned, 11% actual at July 25, 2026", () => {
    expect(getSCurveValueAtReportingDate(eastbaySCurve, julyReportingDate, "planned")).toBe(22);
    expect(getSCurveValueAtReportingDate(eastbaySCurve, julyReportingDate, "actual")).toBe(11);
  });

  it("Kaysakat = 33% planned, 0% actual at July 25, 2026", () => {
    expect(getSCurveValueAtReportingDate(kaysakatSCurve, julyReportingDate, "planned")).toBe(33);
    expect(getSCurveValueAtReportingDate(kaysakatSCurve, julyReportingDate, "actual")).toBe(0);
  });
});

describe("calculateConsolidatedSCurve", () => {
  const mockFacilities: FacilityPresentationSummary[] = [
    {
      facility: { slug: "aglipay", name: "Aglipay STP", shortName: "AGLIPAY STP", color: "#f97316" },
      progress: 44,
      deliverablesCompliance: 0,
      submissionCoverageProxy: 0,
      required: 0,
      submitted: 0,
      approved: 0,
      outstanding: 0,
      unmappedDocuments: 0,
      hasRequirementBaseline: false,
      dataQualityWarning: null,
      scheduleVariance: 0,
      status: "green",
      sCurve: [
        { date: "2026-04-01", planned: 44, actual: 44, forecast: null },
      ],
      hasBaselineSchedule: true,
      dataQuality: { weightSource: "equal-fallback", hasWorkflowStatus: false, hasRequirementMatrix: false },
    },
    {
      facility: { slug: "htt", name: "HTT STP", shortName: "HTT STP", color: "#3b82f6" },
      progress: 44,
      deliverablesCompliance: 0,
      submissionCoverageProxy: 0,
      required: 0,
      submitted: 0,
      approved: 0,
      outstanding: 0,
      unmappedDocuments: 0,
      hasRequirementBaseline: false,
      dataQualityWarning: null,
      scheduleVariance: 0,
      status: "green",
      sCurve: [
        { date: "2026-04-01", planned: 44, actual: 44, forecast: null },
      ],
      hasBaselineSchedule: true,
      dataQuality: { weightSource: "equal-fallback", hasWorkflowStatus: false, hasRequirementMatrix: false },
    },
  ];

  it("should calculate portfolio averages", () => {
    const result = calculateConsolidatedSCurve(mockFacilities);
    expect(result).toHaveLength(1);
    expect(result[0].planned).toBe(44);
    expect(result[0].actual).toBe(44);
  });
});
