/**
 * Governance V3 milestone/phase semantics unit tests (no database required).
 *
 * Regression coverage for the presentation's core truth rules:
 * - milestone status is evidence-driven: calendar position alone can never
 *   mark a milestone achieved;
 * - "planned by now — still open" (gap) is distinct from achieved;
 * - ahead-of-plan completion is represented distinctly;
 * - upcoming milestones stay upcoming;
 * - lifecycle phase is derived from milestone completion;
 * - PPP start dates come from real facility milestone state, with no
 *   cross-facility leakage.
 */

import { describe, it, expect } from "vitest";
import {
  aggregatePortfolioSummary,
  derivePppStartDate,
  determineCurrentPhase,
  determineMilestoneStatus,
  determinePhaseStatus,
} from "./adapter.server";
import type { MilestoneData } from "./types";

/** Shape-compatible subset of the adapter's MilestoneStateRow (not exported). */
interface MilestoneStateRowLike {
  facilitySlug: string;
  milestoneId: string;
  pppDate: string | null;
  compDate: string | null;
  customPct: number | null;
  readyStatus: string | null;
}

const REPORTING = new Date("2026-07-31T00:00:00Z");

function state(overrides: Partial<MilestoneStateRowLike> = {}): MilestoneStateRowLike {
  return {
    facilitySlug: "aglipay",
    milestoneId: "M4",
    pppDate: null,
    compDate: null,
    customPct: null,
    readyStatus: null,
    ...overrides,
  };
}

function milestone(
  code: MilestoneData["code"],
  status: MilestoneData["status"],
  phase: MilestoneData["phase"] = "PPP"
): MilestoneData {
  return { code, name: code, phase, status };
}

describe("determineMilestoneStatus — evidence-driven achievement", () => {
  it("marks a milestone achieved as planned when completed on its PPP target date", () => {
    const s = state({ pppDate: "2026-03-13", compDate: "2026-03-13" });
    expect(determineMilestoneStatus("M4", s, REPORTING)).toBe("achieved");
  });

  it("marks a milestone achieved when completed after its planned date", () => {
    const s = state({ pppDate: "2026-03-13", compDate: "2026-05-01" });
    expect(determineMilestoneStatus("M4", s, REPORTING)).toBe("achieved");
  });

  it("marks a milestone achieved ahead of plan when completed before its planned date", () => {
    const s = state({ pppDate: "2026-03-13", compDate: "2026-02-01" });
    expect(determineMilestoneStatus("M4", s, REPORTING)).toBe("achieved_ahead");
  });

  it("does NOT mark a milestone achieved when the milestone has no completion evidence", () => {
    const s = state({ pppDate: "2026-03-13", compDate: null });
    expect(determineMilestoneStatus("M4", s, REPORTING)).toBe("gap");
  });

  it("does NOT mark a milestone achieved when its completion date is after the reporting date (calendar position alone)", () => {
    const s = state({ pppDate: "2026-03-13", compDate: "2026-10-01" });
    expect(determineMilestoneStatus("M4", s, REPORTING)).toBe("gap");
  });

  it("keeps a future-dated milestone upcoming even when a future completion is recorded", () => {
    const s = state({ pppDate: "2027-01-15", compDate: "2027-01-01" });
    expect(determineMilestoneStatus("M4", s, REPORTING)).toBe("upcoming");
  });

  it("marks a milestone with no state at all as upcoming", () => {
    expect(determineMilestoneStatus("M4", undefined, REPORTING)).toBe("upcoming");
  });

  it("distinguishes planned-but-open (gap) from achieved", () => {
    const open = state({ pppDate: "2026-03-13", compDate: null });
    const done = state({ pppDate: "2026-03-13", compDate: "2026-03-13" });
    expect(determineMilestoneStatus("M4", open, REPORTING)).toBe("gap");
    expect(determineMilestoneStatus("M4", done, REPORTING)).toBe("achieved");
  });

  it("keeps a milestone upcoming when its planned date is after the reporting date", () => {
    const s = state({ pppDate: "2026-09-01", compDate: null });
    expect(determineMilestoneStatus("M4", s, REPORTING)).toBe("upcoming");
  });
});

describe("determineCurrentPhase / determinePhaseStatus — lifecycle position", () => {
  it("returns PRE-PPP when pre-PPP milestones are not all complete", () => {
    const milestones = [
      milestone("M1", "achieved", "PRE-PPP"),
      milestone("M2", "gap", "PRE-PPP"),
      milestone("M3", "upcoming", "PRE-PPP"),
      milestone("M4", "upcoming", "PPP"),
    ];
    expect(determineCurrentPhase(milestones)).toBe("PRE-PPP");
    expect(determinePhaseStatus(milestones, "PRE-PPP")).toBe("PRE-PPP • RECOVERY");
  });

  it("returns PPP when all pre-PPP milestones are complete", () => {
    const milestones = [
      milestone("M1", "achieved", "PRE-PPP"),
      milestone("M2", "achieved_ahead", "PRE-PPP"),
      milestone("M3", "achieved", "PRE-PPP"),
      milestone("M4", "gap", "PPP"),
      milestone("M5", "upcoming", "PPP"),
    ];
    expect(determineCurrentPhase(milestones)).toBe("PPP");
    expect(determinePhaseStatus(milestones, "PPP")).toBe("PPP ACTIVE");
  });

  it("returns POST-PPP when all pre-PPP and PPP milestones are complete", () => {
    const milestones = [
      milestone("M1", "achieved", "PRE-PPP"),
      milestone("M2", "achieved", "PRE-PPP"),
      milestone("M3", "achieved", "PRE-PPP"),
      milestone("M4", "achieved", "PPP"),
      milestone("M5", "achieved", "PPP"),
      milestone("M6", "achieved_ahead", "PPP"),
      milestone("M7", "upcoming", "POST-PPP"),
    ];
    expect(determineCurrentPhase(milestones)).toBe("POST-PPP");
  });

  it("reports GATE READY when pre-PPP milestones are complete but PPP has not started", () => {
    const milestones = [
      milestone("M1", "achieved", "PRE-PPP"),
      milestone("M2", "achieved", "PRE-PPP"),
      milestone("M3", "achieved_ahead", "PRE-PPP"),
      milestone("M4", "upcoming", "PPP"),
    ];
    expect(determinePhaseStatus(milestones, "PRE-PPP")).toBe("PRE-PPP • GATE READY");
  });

  it("reports IN PROGRESS for a pre-PPP facility with no gaps and incomplete pre-PPP work", () => {
    const milestones = [
      milestone("M1", "upcoming", "PRE-PPP"),
      milestone("M2", "upcoming", "PRE-PPP"),
    ];
    expect(determinePhaseStatus(milestones, "PRE-PPP")).toBe("PRE-PPP • IN PROGRESS");
  });
});

describe("derivePppStartDate — real facility PPP start dates", () => {
  it("returns the earliest PPP target date from the facility's own milestone states", () => {
    const states = [
      state({ facilitySlug: "aglipay", milestoneId: "M1", pppDate: "2026-09-01" }),
      state({ facilitySlug: "aglipay", milestoneId: "M4", pppDate: "2026-03-13" }),
      state({ facilitySlug: "aglipay", milestoneId: "M6", pppDate: "2026-03-13" }),
    ];
    expect(derivePppStartDate("aglipay", states)).toBe("2026-03-13");
  });

  it("returns null when the facility has no PPP target dates", () => {
    expect(derivePppStartDate("aglipay", [])).toBeNull();
    expect(
      derivePppStartDate("aglipay", [state({ facilitySlug: "aglipay", pppDate: null })])
    ).toBeNull();
  });

  it("does not leak another facility's PPP dates into this facility's start date", () => {
    const states = [
      state({ facilitySlug: "aglipay", milestoneId: "M1", pppDate: "2026-03-13" }),
      state({ facilitySlug: "kaysakat", milestoneId: "M1", pppDate: "2026-09-01" }),
      state({ facilitySlug: "eastbay", milestoneId: "M2", pppDate: "2026-11-15" }),
    ];
    expect(derivePppStartDate("aglipay", states)).toBe("2026-03-13");
    expect(derivePppStartDate("kaysakat", states)).toBe("2026-09-01");
    expect(derivePppStartDate("eastbay", states)).toBe("2026-11-15");
  });
});

describe("aggregatePortfolioSummary — portfolio math without a database", () => {
  const docs = [
    { facilitySlug: "aglipay", submittedCount: 3, requiredCount: 14, referenceCount: 1, milestoneFileCount: 3 },
    { facilitySlug: "htt", submittedCount: 11, requiredCount: 14, referenceCount: 1, milestoneFileCount: 11 },
    { facilitySlug: "eastbay", submittedCount: 4, requiredCount: 14, referenceCount: 1, milestoneFileCount: 4 },
    { facilitySlug: "kaysakat", submittedCount: 1, requiredCount: 14, referenceCount: 1, milestoneFileCount: 1 },
  ] as unknown as Parameters<typeof aggregatePortfolioSummary>[1];

  const facilities = [
    { slug: "aglipay", currentPhase: "PPP", phaseStatus: "PPP ACTIVE" },
    { slug: "htt", currentPhase: "PPP", phaseStatus: "PPP ACTIVE" },
    { slug: "eastbay", currentPhase: "PRE-PPP", phaseStatus: "PRE-PPP • GATE READY" },
    { slug: "kaysakat", currentPhase: "PRE-PPP", phaseStatus: "PRE-PPP • RECOVERY" },
  ] as unknown as Parameters<typeof aggregatePortfolioSummary>[0];

  it("calculates portfolio submitted/required and compliance percent", () => {
    const summary = aggregatePortfolioSummary(facilities, docs);
    expect(summary.totalDocumentsSubmitted).toBe(19);
    expect(summary.totalDocumentsRequired).toBe(56);
    expect(summary.portfolioCompliancePercent).toBe(34);
  });

  it("rolls up reference and milestone file counts without inflating submissions", () => {
    const summary = aggregatePortfolioSummary(facilities, docs);
    expect(summary.totalReferenceFiles).toBe(4);
    expect(summary.totalMilestoneFiles).toBe(19);
    expect(summary.totalDocumentsSubmitted).toBe(19);
  });

  it("counts facilities per lifecycle phase from real phase status", () => {
    const summary = aggregatePortfolioSummary(facilities, docs);
    expect(summary.totalFacilities).toBe(4);
    expect(summary.facilitiesInPrePpp).toBe(2);
    expect(summary.facilitiesInPpp).toBe(2);
    expect(summary.facilitiesInPostPpp).toBe(0);
    expect(summary.gateReadyCount).toBe(1);
    expect(summary.recoveryCount).toBe(1);
  });

  it("is stable when documentation changes — different records produce different output", () => {
    const summaryA = aggregatePortfolioSummary(facilities, docs);
    const changed = docs.map((d) =>
      d.facilitySlug === "kaysakat" ? { ...d, submittedCount: 4 } : d
    ) as Parameters<typeof aggregatePortfolioSummary>[1];
    const summaryB = aggregatePortfolioSummary(facilities, changed);
    expect(summaryB.totalDocumentsSubmitted).toBe(22);
    expect(summaryB.portfolioCompliancePercent).toBe(39);
    expect(summaryB).not.toEqual(summaryA);
  });
});

describe("determineMilestoneStatus — authoritative in-progress (yellow)", () => {
  it("marks a milestone in progress when customPct is between 0 and 100 and no completion is evidenced", () => {
    const s = state({ customPct: 50, compDate: null });
    expect(determineMilestoneStatus("M5", s, REPORTING)).toBe("in_progress");
  });

  it("does NOT mark in progress from calendar position alone (customPct null, planned date passed)", () => {
    const s = state({ pppDate: "2026-03-13", compDate: null, customPct: null });
    expect(determineMilestoneStatus("M5", s, REPORTING)).toBe("gap");
  });

  it("does NOT mark in progress when customPct is 0 or null", () => {
    expect(determineMilestoneStatus("M5", state({ customPct: 0 }), REPORTING)).toBe("upcoming");
    expect(determineMilestoneStatus("M5", state({ customPct: null }), REPORTING)).toBe("upcoming");
  });

  it("does NOT mark in progress when customPct is 100 without a completion date (progress evidence incomplete)", () => {
    const s = state({ customPct: 100, compDate: null });
    expect(determineMilestoneStatus("M5", s, REPORTING)).toBe("upcoming");
  });

  it("does NOT treat a future compDate as in-progress evidence (no started evidence)", () => {
    const s = state({ compDate: "2026-09-01", customPct: null });
    expect(determineMilestoneStatus("M5", s, REPORTING)).toBe("upcoming");
  });

  it("keeps completion evidence dominant: compDate wins over customPct", () => {
    const s = state({ compDate: "2026-06-01", customPct: 60 });
    expect(determineMilestoneStatus("M5", s, REPORTING)).toBe("achieved");
  });

  it("keeps in-progress dominant over the calendar-derived gap", () => {
    const s = state({ pppDate: "2026-03-13", compDate: null, customPct: 40 });
    expect(determineMilestoneStatus("M5", s, REPORTING)).toBe("in_progress");
  });

  it("matches the production AGLIPAY/HTT M5 rows: future compDate, customPct null → upcoming", () => {
    const aglipayM5 = state({ facilitySlug: "aglipay", milestoneId: "M5", pppDate: null, compDate: "2026-09-01", customPct: null });
    const httM5 = state({ facilitySlug: "htt", milestoneId: "M5", pppDate: null, compDate: "2026-09-13", customPct: null });
    expect(determineMilestoneStatus("M5", aglipayM5, new Date("2026-08-26T00:00:00Z"))).toBe("upcoming");
    expect(determineMilestoneStatus("M5", httM5, new Date("2026-08-26T00:00:00Z"))).toBe("upcoming");
  });
});
