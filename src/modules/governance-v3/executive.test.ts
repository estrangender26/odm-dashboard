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
    expect(result.facilityObservations.htt).toContain("HTT: Active PPP at 79% compliance");
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
    expect(result.facilityObservations.eastbay).toContain("EASTBAY: Pre-PPP readiness at 50% compliance");
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
    expect(result.facilityObservations.aglipay).toContain("AGLIPAY: Active PPP at 21% compliance");
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
    expect(result.facilityObservations.kaysakat).toContain("KAYSAKAT: Pre-PPP readiness at 7% compliance");
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

describe("Data-derived NEXT GATE and GATE IMPLICATION", () => {
  const fourFacilities = () => [
    makeFacility("aglipay", "AGLIPAY STP", "2026-03-13", "PPP", "PPP ACTIVE", 21, [
      { code: "M4", name: "PM task lists in SAP-PM", phase: "PPP", status: "gap" },
    ]),
    makeFacility("htt", "HTT STP", "2026-03-13", "PPP", "PPP ACTIVE", 79, [
      { code: "M4", name: "PM task lists in SAP-PM", phase: "PPP", status: "gap" },
    ]),
    makeFacility("eastbay", "EASTBAY PH-2 TP", "2026-09-01", "PRE-PPP", "PRE-PPP • GATE READY", 29, [
      { code: "M1", name: "T&C Complete", phase: "PRE-PPP", status: "achieved" },
    ]),
    makeFacility("kaysakat", "KAYSAKAT TP", "2026-09-01", "PRE-PPP", "PRE-PPP • RECOVERY", 7, [
      { code: "M2", name: "Commissioning", phase: "PRE-PPP", status: "gap" },
    ]),
  ];

  it("derives NEXT GATE from actual open milestones, not hard-coded text", () => {
    const facilities = fourFacilities();
    const result = generateExecutiveContent(
      facilities.map(f => f.facility),
      baseSummary,
      facilities.map(f => f.doc),
      new Date("2026-08-01")
    );
    expect(result.nextGateAction).toContain("complete SAP-PM task list setup");
    expect(result.nextGateAction).toContain("AGLIPAY");
    expect(result.nextGateAction).toContain("HTT");
  });

  it("changes NEXT GATE when the underlying milestone state changes", () => {
    const facilities = fourFacilities();
    // Move every facility's PPP start into the past and close all open
    // milestones → no gaps, no future-PPP gate → fallback statement.
    for (const f of facilities) {
      f.facility.pppStartDate = "2026-03-13";
      f.facility.currentPhase = "PPP";
      f.facility.phaseStatus = "PPP ACTIVE";
    }
    facilities[0].facility.milestones = [{ code: "M4", name: "PM task lists in SAP-PM", phase: "PPP", status: "achieved" }];
    facilities[1].facility.milestones = [{ code: "M4", name: "PM task lists in SAP-PM", phase: "PPP", status: "achieved" }];
    facilities[2].facility.milestones = [
      { code: "M1", name: "T&C Complete", phase: "PRE-PPP", status: "achieved" },
      { code: "M2", name: "Commissioning", phase: "PRE-PPP", status: "achieved" },
      { code: "M3", name: "Punchlist Closed", phase: "PRE-PPP", status: "achieved" },
    ];
    facilities[3].facility.milestones = [
      { code: "M1", name: "T&C Complete", phase: "PRE-PPP", status: "achieved" },
      { code: "M2", name: "Commissioning", phase: "PRE-PPP", status: "achieved" },
      { code: "M3", name: "Punchlist Closed", phase: "PRE-PPP", status: "achieved" },
    ];
    const result = generateExecutiveContent(
      facilities.map(f => f.facility),
      baseSummary,
      facilities.map(f => f.doc),
      new Date("2026-08-01")
    );
    expect(result.nextGateAction).not.toContain("complete SAP-PM task list setup");
    expect(result.nextGateAction).not.toContain("close remaining Pre-PPP readiness gaps");
    expect(result.nextGateAction).toContain("Next gate: Continue milestone progression");
  });

  it("derives GATE IMPLICATION from future-PPP facilities and their real PPP start months", () => {
    const facilities = fourFacilities();
    const result = generateExecutiveContent(
      facilities.map(f => f.facility),
      baseSummary,
      facilities.map(f => f.doc),
      new Date("2026-08-01")
    );
    expect(result.gateImplication).toContain("EASTBAY");
    expect(result.gateImplication).toContain("KAYSAKAT");
    expect(result.gateImplication).toContain("September 2026");
  });

  it("changes GATE IMPLICATION when no facility is still pre-PPP", () => {
    const facilities = fourFacilities();
    facilities[2].facility.pppStartDate = "2026-03-13";
    facilities[2].facility.currentPhase = "PPP";
    facilities[2].facility.phaseStatus = "PPP ACTIVE";
    facilities[3].facility.pppStartDate = "2026-03-13";
    facilities[3].facility.currentPhase = "PPP";
    facilities[3].facility.phaseStatus = "PPP ACTIVE";
    const result = generateExecutiveContent(
      facilities.map(f => f.facility),
      baseSummary,
      facilities.map(f => f.doc),
      new Date("2026-08-01")
    );
    expect(result.gateImplication).not.toContain("EASTBAY and KAYSAKAT");
  });

  it("produces different commentary for different facility records (no stale text)", () => {
    const low = makeFacility("kaysakat", "KAYSAKAT TP", "2026-09-01", "PRE-PPP", "PRE-PPP • RECOVERY", 7);
    const high = makeFacility("htt", "HTT STP", "2026-03-13", "PPP", "PPP ACTIVE", 79);
    const resultLow = generateExecutiveContent([low.facility], baseSummary, [low.doc], new Date("2026-08-01"));
    const resultHigh = generateExecutiveContent([high.facility], baseSummary, [high.doc], new Date("2026-08-01"));
    expect(resultLow.facilityObservations.kaysakat).not.toBe(resultHigh.facilityObservations.htt);
    expect(resultLow.facilityObservations.kaysakat).toContain("7%");
    expect(resultHigh.facilityObservations.htt).toContain("79%");
  });
});

describe("Missing PPP start date — no fabricated dates in commentary", () => {
  it("renders TBD and never a fabricated date when a facility has no PPP start", () => {
    const facility: FacilityData = {
      slug: "kaysakat",
      name: "KAYSAKAT Treatment Plant",
      shortName: "KAYSAKAT TP",
      color: "#F4A261",
      pppStartDate: "",
      currentPhase: "PRE-PPP",
      phaseStatus: "PRE-PPP • RECOVERY",
      milestones: [
        { code: "M2", name: "Commissioning", phase: "PRE-PPP", status: "gap" },
      ],
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
    expect(result.nextGateAction).toContain("TBD");
    expect(result.nextGateAction).not.toContain("2026-01-01");
    expect(result.nextGateAction).not.toContain("Invalid Date");
    expect(result.gateImplication).toContain("TBD");
    expect(result.gateImplication).not.toContain("2026-01-01");
    expect(result.gateImplication).not.toContain("Invalid Date");
    expect(result.facilityObservations.kaysakat).not.toContain("2026-01-01");
  });

  it("derives the PPP start month and year from the real date (no hard-coded 2026)", () => {
    const facility: FacilityData = {
      slug: "eastbay",
      name: "EASTBAY Phase 2 Treatment Plant",
      shortName: "EASTBAY PH-2 TP",
      color: "#10B981",
      pppStartDate: "2027-03-01",
      currentPhase: "PRE-PPP",
      phaseStatus: "PRE-PPP • GATE READY",
      milestones: [
        { code: "M1", name: "T&C Complete", phase: "PRE-PPP", status: "achieved" },
      ],
      executiveObservation: "",
    };
    const doc: FacilityDocumentation = {
      facilitySlug: "eastbay",
      facilityName: "EASTBAY Phase 2 Treatment Plant",
      submittedCount: 4,
      requiredCount: 14,
      compliancePercent: 29,
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
    expect(result.nextGateAction).toContain("March 2027");
    expect(result.nextGateAction).not.toContain("2026-01-01");
  });
});

describe("Commentary rendering budget (fits fixed slide boxes)", () => {
  const smokeDocs = () => {
    const counts: Record<string, number> = { kaysakat: 1, eastbay: 5, aglipay: 3, htt: 11 };
    return (Object.keys(counts) as Array<keyof typeof counts>).map((slug) => {
      const submittedCount = counts[slug];
      return {
        facilitySlug: slug,
        facilityName: slug.toUpperCase() + (slug === "eastbay" ? " PH-2 TP" : " STP"),
        submittedCount,
        requiredCount: 14,
        compliancePercent: Math.round((submittedCount / 14) * 100),
        submissions: Array.from({ length: 14 }, (_, i) => ({
          tocId: (i + 1).toString(),
          submitted: i < submittedCount,
          documentCount: i < submittedCount ? 1 : 0,
        })),
        referenceCount: 1,
        milestoneFileCount: submittedCount,
      };
    }) as FacilityDocumentation[];
  };

  const smokeFacilities = () => [
    makeFacility("aglipay", "AGLIPAY STP", "2026-03-13", "PPP", "PPP ACTIVE", 21),
    makeFacility("htt", "HTT STP", "2026-03-13", "PPP", "PPP ACTIVE", 79),
    makeFacility("eastbay", "EASTBAY PH-2 TP", "2026-09-01", "PPP", "PPP ACTIVE", 36),
    makeFacility("kaysakat", "KAYSAKAT TP", "2026-09-01", "PRE-PPP", "PRE-PPP • RECOVERY", 7),
  ];

  it("keeps the slide 3 executive note within its box budget (<= 150 chars at 12pt)", () => {
    const facilities = smokeFacilities();
    const result = generateExecutiveContent(
      facilities.map(f => f.facility),
      { ...baseSummary, totalDocumentsSubmitted: 20, portfolioCompliancePercent: 36 },
      smokeDocs(),
      new Date("2026-08-26")
    );
    expect(result.portfolioObservation.length).toBeLessThanOrEqual(150);
    // The note still carries the real numbers and the gap list.
    expect(result.portfolioObservation).toContain("36%");
    expect(result.portfolioObservation).toContain("20 of 56");
    expect(result.portfolioObservation).toContain("KAYSAKAT 13");
    expect(result.portfolioObservation).toContain("HTT leads at 79%");
  });

  it("keeps facility observations on a single line inside the row box (<= 120 chars at 11pt)", () => {
    const facilities = smokeFacilities();
    const result = generateExecutiveContent(
      facilities.map(f => f.facility),
      { ...baseSummary, totalDocumentsSubmitted: 20, portfolioCompliancePercent: 36 },
      smokeDocs(),
      new Date("2026-08-26")
    );
    for (const obs of Object.values(result.facilityObservations)) {
      expect(obs.length).toBeLessThanOrEqual(120);
    }
    // Data is preserved in the compact wording.
    expect(result.facilityObservations.kaysakat).toContain("KAYSAKAT: Pre-PPP readiness at 7% compliance");
    expect(result.facilityObservations.kaysakat).toContain("13 TOC deliverables missing");
    expect(result.facilityObservations.kaysakat).toContain("1 reference");
  });
});
