import { describe, it, expect } from "vitest";
import { generateExecutiveContent } from "./executive";
import type { FacilityData, FacilityDocumentation, PortfolioSummary } from "./types";

function makeFacility(
  slug: string,
  shortName: string,
  pppStartDate: string,
  currentPhase: "PRE-PPP" | "PPP" | "POST-PPP",
  phaseStatus: FacilityData["phaseStatus"],
  compliancePercent: number,
  milestones: FacilityData["milestones"] = []
): { facility: FacilityData; doc: FacilityDocumentation } {
  const submittedCount = Math.round((compliancePercent / 100) * 14);
  const doc: FacilityDocumentation = {
    facilitySlug: slug,
    facilityName: shortName,
    submittedCount,
    requiredCount: 14,
    compliancePercent,
    submissions: Array.from({ length: 14 }, (_, i) => ({
      tocId: (i + 1).toString(),
      submitted: i < submittedCount,
      documentCount: i < submittedCount ? 1 : 0,
    })),
  };
  const facility: FacilityData = {
    slug,
    name: shortName,
    shortName,
    color: "#000000",
    pppStartDate,
    currentPhase,
    phaseStatus,
    milestones,
    executiveObservation: "",
  };
  return { facility, doc };
}

const baseSummary: PortfolioSummary = {
  totalFacilities: 4,
  facilitiesInPrePpp: 2,
  facilitiesInPpp: 2,
  facilitiesInPostPpp: 0,
  gateReadyCount: 1,
  recoveryCount: 1,
  totalDocumentsSubmitted: 19,
  totalDocumentsRequired: 56,
  portfolioCompliancePercent: 34,
};

describe("generateExecutiveContent", () => {
  it("uses the high-compliance implication for facilities at or above 75%", () => {
    const { facility, doc } = makeFacility(
      "htt",
      "HTT STP",
      "2026-03-13",
      "PPP",
      "PPP ACTIVE",
      79
    );
    const result = generateExecutiveContent(
      [facility],
      { ...baseSummary, totalDocumentsSubmitted: 11, totalDocumentsRequired: 14, portfolioCompliancePercent: 79 },
      [doc],
      new Date("2026-08-01")
    );
    expect(result.facilityObservations.htt).toContain("Leads portfolio readiness");
    expect(result.facilityObservations.htt).toContain("outstanding governance deliverables");
    expect(result.facilityObservations.htt).not.toContain("as-built");
    expect(result.facilityObservations.htt).not.toContain("handover");
  });

  it("uses the mid-compliance implication for facilities between 30% and 74%", () => {
    const { facility, doc } = makeFacility(
      "eastbay",
      "EASTBAY PH-2 TP",
      "2026-09-01",
      "PRE-PPP",
      "PRE-PPP • GATE READY",
      50
    );
    const result = generateExecutiveContent(
      [facility],
      { ...baseSummary, totalDocumentsSubmitted: 7, totalDocumentsRequired: 14, portfolioCompliancePercent: 50 },
      [doc],
      new Date("2026-08-01")
    );
    expect(result.facilityObservations.eastbay).toContain(
      "Progressing but still requires focused documentation closure"
    );
  });

  it("uses the low-compliance implication for facilities between 10% and 29%", () => {
    const { facility, doc } = makeFacility(
      "aglipay",
      "AGLIPAY STP",
      "2026-03-13",
      "PPP",
      "PPP ACTIVE",
      21
    );
    const result = generateExecutiveContent(
      [facility],
      { ...baseSummary, totalDocumentsSubmitted: 3, totalDocumentsRequired: 14, portfolioCompliancePercent: 21 },
      [doc],
      new Date("2026-08-01")
    );
    expect(result.facilityObservations.aglipay).toContain(
      "Requires accelerated documentation recovery before the next gate"
    );
  });

  it("uses the very-low-compliance implication for facilities below 10%", () => {
    const { facility, doc } = makeFacility(
      "kaysakat",
      "KAYSAKAT TP",
      "2026-09-01",
      "PRE-PPP",
      "PRE-PPP • RECOVERY",
      7
    );
    const result = generateExecutiveContent(
      [facility],
      { ...baseSummary, totalDocumentsSubmitted: 1, totalDocumentsRequired: 14, portfolioCompliancePercent: 7 },
      [doc],
      new Date("2026-08-01")
    );
    expect(result.facilityObservations.kaysakat).toContain(
      "Early-stage readiness; immediate completion of core governance documentation is required"
    );
  });

  it("changes next-gate wording when PPP facilities have incomplete M4/M5 milestones", () => {
    const facility: FacilityData = {
      slug: "htt",
      name: "HTT Sewage Treatment Plant",
      shortName: "HTT STP",
      color: "#00A9C5",
      pppStartDate: "2026-03-13",
      currentPhase: "PPP",
      phaseStatus: "PPP ACTIVE",
      milestones: [
        { code: "M4", name: "PM task lists in SAP-PM", phase: "PPP", status: "gap" },
      ],
      executiveObservation: "",
    };
    const doc: FacilityDocumentation = {
      facilitySlug: "htt",
      facilityName: "HTT Sewage Treatment Plant",
      submittedCount: 11,
      requiredCount: 14,
      compliancePercent: 79,
      submissions: [],
    };
    const result = generateExecutiveContent(
      [facility],
      baseSummary,
      [doc],
      new Date("2026-08-01")
    );
    expect(result.nextGateAction).toContain("complete SAP-PM task list setup");
    expect(result.nextGateAction).toContain("HTT");
  });

  it("changes next-gate wording when PPP facilities have incomplete M1-M3 milestones", () => {
    const facility: FacilityData = {
      slug: "aglipay",
      name: "AGLIPAY Sewage Treatment Plant",
      shortName: "AGLIPAY STP",
      color: "#397DA4",
      pppStartDate: "2026-03-13",
      currentPhase: "PPP",
      phaseStatus: "PPP ACTIVE",
      milestones: [
        { code: "M2", name: "Wet/dry commissioning passed", phase: "PPP", status: "upcoming" },
      ],
      executiveObservation: "",
    };
    const doc: FacilityDocumentation = {
      facilitySlug: "aglipay",
      facilityName: "AGLIPAY Sewage Treatment Plant",
      submittedCount: 3,
      requiredCount: 14,
      compliancePercent: 21,
      submissions: [],
    };
    const result = generateExecutiveContent(
      [facility],
      baseSummary,
      [doc],
      new Date("2026-08-01")
    );
    expect(result.nextGateAction).toContain("close remaining commissioning and defect milestones");
    expect(result.nextGateAction).toContain("AGLIPAY");
  });

  it("drives next gate from future-PPP facilities when PPP milestones are complete", () => {
    const facility: FacilityData = {
      slug: "kaysakat",
      name: "KAYSAKAT Treatment Plant",
      shortName: "KAYSAKAT TP",
      color: "#F4A261",
      pppStartDate: "2026-09-01",
      currentPhase: "PRE-PPP",
      phaseStatus: "PRE-PPP • RECOVERY",
      milestones: [],
      executiveObservation: "",
    };
    const doc: FacilityDocumentation = {
      facilitySlug: "kaysakat",
      facilityName: "KAYSAKAT Treatment Plant",
      submittedCount: 1,
      requiredCount: 14,
      compliancePercent: 7,
      submissions: [],
    };
    const result = generateExecutiveContent(
      [facility],
      baseSummary,
      [doc],
      new Date("2026-08-01")
    );
    expect(result.nextGateAction).toContain("close remaining Pre-PPP readiness gaps");
    expect(result.nextGateAction).toContain("KAYSAKAT");
    expect(result.nextGateAction).toContain("September");
  });

  it("does not hard-code a specific facility pair in the next gate", () => {
    const f1 = makeFacility("htt", "HTT STP", "2026-03-13", "PPP", "PPP ACTIVE", 79, [
      { code: "M4", name: "PM task lists in SAP-PM", phase: "PPP", status: "gap" },
    ]);
    const result1 = generateExecutiveContent(
      [f1.facility],
      { ...baseSummary, totalDocumentsSubmitted: 11, totalDocumentsRequired: 14, portfolioCompliancePercent: 79 },
      [f1.doc],
      new Date("2026-08-01")
    );
    expect(result1.nextGateAction).toContain("HTT");

    const f2 = makeFacility("eastbay", "EASTBAY PH-2 TP", "2026-09-01", "PRE-PPP", "PRE-PPP • RECOVERY", 29);
    const result2 = generateExecutiveContent(
      [f2.facility],
      { ...baseSummary, totalDocumentsSubmitted: 4, totalDocumentsRequired: 14, portfolioCompliancePercent: 29 },
      [f2.doc],
      new Date("2026-08-01")
    );
    expect(result2.nextGateAction).toContain("EASTBAY");
    expect(result2.nextGateAction).not.toContain("HTT");
  });
});
