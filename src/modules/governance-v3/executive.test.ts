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
    referenceCount: 1,
    milestoneFileCount: submittedCount,
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
  totalReferenceFiles: 4,
  totalMilestoneFiles: 19,
};

describe("generateExecutiveContent", () => {
  it("reports the actual high-compliance facility state including missing files and references", () => {
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
      { ...baseSummary, totalDocumentsSubmitted: 11, totalDocumentsRequired: 14, portfolioCompliancePercent: 79, totalReferenceFiles: 1, totalMilestoneFiles: 11 },
      [doc],
      new Date("2026-08-01")
    );
    expect(result.facilityObservations.htt).toContain("HTT: Active PPP with 79% documentation compliance");
    expect(result.facilityObservations.htt).toContain("3 TOC deliverables missing");
    expect(result.facilityObservations.htt).toContain("11 milestone files");
    expect(result.facilityObservations.htt).toContain("1 reference");
    expect(result.facilityObservations.htt).not.toContain("as-built");
    expect(result.facilityObservations.htt).not.toContain("handover");
  });

  it("reports the actual mid-compliance facility state including missing files and references", () => {
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
      { ...baseSummary, totalDocumentsSubmitted: 7, totalDocumentsRequired: 14, portfolioCompliancePercent: 50, totalReferenceFiles: 1, totalMilestoneFiles: 7 },
      [doc],
      new Date("2026-08-01")
    );
    expect(result.facilityObservations.eastbay).toContain("EASTBAY: Pre-PPP readiness with 50% documentation compliance");
    expect(result.facilityObservations.eastbay).toContain("7 TOC deliverables missing");
    expect(result.facilityObservations.eastbay).toContain("7 milestone files");
    expect(result.facilityObservations.eastbay).toContain("1 reference");
  });

  it("reports the actual low-compliance facility state including missing files and references", () => {
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
      { ...baseSummary, totalDocumentsSubmitted: 3, totalDocumentsRequired: 14, portfolioCompliancePercent: 21, totalReferenceFiles: 1, totalMilestoneFiles: 3 },
      [doc],
      new Date("2026-08-01")
    );
    expect(result.facilityObservations.aglipay).toContain("AGLIPAY: Active PPP with 21% documentation compliance");
    expect(result.facilityObservations.aglipay).toContain("11 TOC deliverables missing");
    expect(result.facilityObservations.aglipay).toContain("3 milestone files");
    expect(result.facilityObservations.aglipay).toContain("1 reference");
  });

  it("reports the actual very-low-compliance facility state including missing files and references", () => {
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
      { ...baseSummary, totalDocumentsSubmitted: 1, totalDocumentsRequired: 14, portfolioCompliancePercent: 7, totalReferenceFiles: 1, totalMilestoneFiles: 1 },
      [doc],
      new Date("2026-08-01")
    );
    expect(result.facilityObservations.kaysakat).toContain("KAYSAKAT: Pre-PPP readiness with 7% documentation compliance");
    expect(result.facilityObservations.kaysakat).toContain("13 TOC deliverables missing");
    expect(result.facilityObservations.kaysakat).toContain("1 milestone file");
    expect(result.facilityObservations.kaysakat).toContain("1 reference");
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
      referenceCount: 1,
      milestoneFileCount: 0,
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
      referenceCount: 1,
      milestoneFileCount: 0,
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
      referenceCount: 1,
      milestoneFileCount: 0,
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
      { ...baseSummary, totalDocumentsSubmitted: 1, totalDocumentsRequired: 14, portfolioCompliancePercent: 7 },
      [f1.doc],
      new Date("2026-08-01")
    );
    expect(result1.nextGateAction).toContain("HTT");

    const f2 = makeFacility("eastbay", "EASTBAY PH-2 TP", "2026-09-01", "PRE-PPP", "PRE-PPP • RECOVERY", 29);
    const result2 = generateExecutiveContent(
      [f2.facility],
      { ...baseSummary, totalDocumentsSubmitted: 1, totalDocumentsRequired: 14, portfolioCompliancePercent: 7 },
      [f2.doc],
      new Date("2026-08-01")
    );
    expect(result2.nextGateAction).toContain("EASTBAY");
    expect(result2.nextGateAction).not.toContain("HTT");
  });
});
