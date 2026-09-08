import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildAllBusinessUnitsDeckData,
  deriveMissingDataReasons,
  normalizeStoredCommentary,
} from "./allBusinessUnitsData";
import { formatScorecardCell, generateAllBusinessUnitsMonthlyKpiDeck } from "./allBusinessUnitsDeck";
import { parseXml } from "../executive-presentations/framework";
import {
  NO_COMMENTARY_SUBMITTED,
  NO_SITUATION_SUBMITTED,
  storedNotesSituationLines,
} from "../executive-presentations/framework/readoutText";
import {
  aggregateMonthlyKpiRecords,
  resolveEffectiveReportingMonth,
  type PersistedMonthlyKpiRecord,
} from "./kpiAggregation";

/**
 * All-Business-Units Monthly KPI deck:
 *  - data semantics agree with the live scorecard (effective month, Group A
 *    cumulative, Group B YTD average);
 *  - commentary bullets come only from each BU's Notes + Situation and never
 *    leak between BUs;
 *  - the generated PPTX contains one cover slide plus two slides per BU
 *    (KPI Summary then KPI Trends), six charts per trends slide, and stops at
 *    the effective reporting month.
 */
const base = {
  pm_compliance: null,
  budget_spend: null,
  pm_cm_work_order_ratio: null,
  pm_cm_cost_ratio: null,
  mttr_days: null,
  facility_uptime: null,
};

function monthValues(month: number) {
  return {
    pmDone: 100 - month,
    pmTotal: 100,
    actualSpend: 100 * month + 10,
    budget: 200,
    pmWo: 40 + month,
    cmWo: 20 - (month % 3),
    pmCost: 1000 + 50 * month,
    cmCost: 500 - 10 * month,
    downtime: 60 * month + 5,
    repairs: month + 2,
    operating: 1000,
    facilityDowntime: month,
  };
}

type FixtureOptions = {
  through?: number;
  notesByMonth?: Record<number, string>;
  situationByMonth?: Record<number, string>;
  omit?: {
    pmCost?: boolean;
    cmCost?: boolean;
    mttr?: boolean;
    budget?: boolean;
    facilityUptime?: boolean;
    pmCompliance?: boolean;
    pmCmWo?: boolean;
  };
};

function makeBusinessUnitRecords(
  businessUnit: string,
  options: FixtureOptions = {}
): PersistedMonthlyKpiRecord[] {
  const through = options.through ?? 8;
  const records: PersistedMonthlyKpiRecord[] = [];
  for (let month = 1; month <= 12; month += 1) {
    if (month > through) {
      // Not Submitted trailing month: planned budget only.
      records.push({
        ...base,
        business_unit: businessUnit,
        reporting_year: 2026,
        reporting_month: month,
        budget: 1000 * month,
        notes: null,
        situation: null,
      } as PersistedMonthlyKpiRecord);
      continue;
    }
    const v = monthValues(month);
    const omit = options.omit ?? {};
    records.push({
      ...base,
      business_unit: businessUnit,
      reporting_year: 2026,
      reporting_month: month,
      notes: options.notesByMonth?.[month] ?? null,
      situation: options.situationByMonth?.[month] ?? null,
      pm_compliance: omit.pmCompliance ? null : 100 - month,
      pm_orders_completed_on_time: omit.pmCompliance ? null : 100 - month,
      total_pm_orders: 100,
      actual_spend: omit.budget ? null : v.actualSpend,
      budget: omit.budget ? 0 : 200,
      budget_spend: omit.budget ? null : (v.actualSpend / 200) * 100,
      pm_work_orders: omit.pmCmWo ? null : v.pmWo,
      cm_work_orders: omit.pmCmWo ? null : v.cmWo,
      pm_cm_work_order_ratio: omit.pmCmWo
        ? null
        : (v.pmWo / (v.pmWo + v.cmWo)) * 100,
      pm_cost: omit.pmCost ? null : v.pmCost,
      cm_cost: omit.cmCost ? null : v.cmCost,
      pm_cm_cost_ratio:
        omit.pmCost || omit.cmCost
          ? null
          : (v.pmCost / (v.pmCost + v.cmCost)) * 100,
      mttr_downtime: omit.mttr ? null : v.downtime,
      repair_count: omit.mttr ? null : v.repairs,
      mttr_days: omit.mttr ? null : v.downtime / v.repairs,
      facility_operating_time: omit.facilityUptime ? null : 1000,
      facility_downtime: omit.facilityUptime ? null : v.facilityDowntime,
      facility_uptime: omit.facilityUptime
        ? null
        : ((1000 - v.facilityDowntime) / 1000) * 100,
      raw_imported_values: {
        values: {
          pm_orders_completed_on_time: omit.pmCompliance ? null : 100 - month,
          total_pm_orders: 100,
          actual_spend: omit.budget ? null : v.actualSpend,
          budget: omit.budget ? 0 : 200,
          pm_work_orders: omit.pmCmWo ? null : v.pmWo,
          cm_work_orders: omit.pmCmWo ? null : v.cmWo,
          pm_cost: omit.pmCost ? null : v.pmCost,
          cm_cost: omit.cmCost ? null : v.cmCost,
          mttr_downtime: omit.mttr ? null : v.downtime,
          repair_count: omit.mttr ? null : v.repairs,
          facility_operating_time: omit.facilityUptime ? null : 1000,
          facility_downtime: omit.facilityUptime ? null : v.facilityDowntime,
        },
      },
    } as unknown as PersistedMonthlyKpiRecord);
  }
  return records;
}

function buildFixture() {
  const amdEz = makeBusinessUnitRecords("AMD-EZ", {
    notesByMonth: {
      3: "Q1 planned outages completed.",
      8: "Transformer overhaul completed.\nSpare delivery tracked.",
    },
    situationByMonth: {
      8: "Corrective maintenance was completed inside the August window.",
    },
  });
  const clark = makeBusinessUnitRecords("Clark Water", {
    notesByMonth: {
      8: "MTTR improved after spare parts availability.",
    },
    situationByMonth: {
      8: "PM:CM cost data for August is still pending validation.",
    },
    omit: { pmCost: true, cmCost: true },
  });
  // Third BU: no August submission (lags the portfolio); ends in June.
  const tagum = makeBusinessUnitRecords("Tagum Water", {
    through: 6,
    notesByMonth: { 6: "VFD failure investigated." },
  });
  return [...amdEz, ...clark, ...tagum];
}

const records = buildFixture();

function slideCountFromZip(zip: JSZip) {
  return Object.keys(zip.files).filter(name =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name)
  ).length;
}

describe("All-Business-Units Monthly KPI deck data", () => {
  it("resolves the effective reporting month over the full portfolio (September request -> August)", () => {
    expect(resolveEffectiveReportingMonth(records, 9)).toBe(8);
    expect(resolveEffectiveReportingMonth(records)).toBe(8);
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    expect(data.effectiveReportingMonth).toBe(8);
    expect(data.effectiveReportingMonthLabel).toContain("August");
    // Requesting a submitted earlier month keeps that month.
    expect(
      buildAllBusinessUnitsDeckData(records, 2026, 3).effectiveReportingMonth
    ).toBe(3);
  });

  it("every active BU gets a section on the ONE common effective reporting period", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const names = data.sections.map(section => section.businessUnit);
    expect(names).toContain("AMD-EZ");
    expect(names).toContain("Clark Water");
    expect(names).toContain("Tagum Water");
    expect(data.sections.every(section => section.summary.length === 6)).toBe(
      true
    );
    // The whole deck reports August 2026 (portfolio effective month), never a
    // per-BU relabel. Tagum lags the portfolio (last submission June) but its
    // slides still say August 2026; only its chart data stops in June.
    for (const section of data.sections) {
      expect(section.reportingMonth).toBe(data.effectiveReportingMonth);
      expect(section.reportingMonthLabel).toBe("August 2026");
    }
    const tagum = data.sections.find(
      section => section.businessUnit === "Tagum Water"
    )!;
    expect(tagum.reportingMonth).toBe(8);
    expect(tagum.trends.length).toBe(6); // Jan-Jun only; no Jul/Aug zeros.
    expect(tagum.trends[tagum.trends.length - 1].month).toBe(6);
  });

  it("summary values match the live scorecard aggregate at the effective month", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const effective = data.effectiveReportingMonth;
    const live = aggregateMonthlyKpiRecords(records, 2026, effective);
    for (const section of data.sections) {
      const liveAggregate = live.byBusinessUnitMap[section.businessUnit];
      if (!liveAggregate) continue;
      const liveRows = liveAggregate;
      const summaryByKey = Object.fromEntries(
        section.summary.map(row => [row.key, row.value])
      );
      expect(summaryByKey.pmCompliance).toBeCloseTo(
        liveRows.pmCompliance as number,
        6
      );
      expect(summaryByKey.budgetSpend).toBeCloseTo(
        liveRows.budgetSpend as number,
        6
      );
      expect(summaryByKey.pmCmWorkOrderRatio).toBeCloseTo(
        liveRows.pmCmWorkOrderRatio as number,
        6
      );
      expect(summaryByKey.mttrDays).toBeCloseTo(liveRows.mttrDays as number, 6);
      expect(summaryByKey.facilityUptime).toBeCloseTo(
        liveRows.facilityUptime as number,
        6
      );
    }
  });

  it("Group A final trend point equals the summary value; Group B YTD average ends at the summary value", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    for (const section of data.sections) {
      const last = section.trends[section.trends.length - 1];
      const summaryByKey = Object.fromEntries(
        section.summary.map(row => [row.key, row.value])
      );
      expect(last.budgetSpend).toBeCloseTo(
        summaryByKey.budgetSpend as number,
        6
      );
      expect(last.pmCmWorkOrderRatio).toBeCloseTo(
        summaryByKey.pmCmWorkOrderRatio as number,
        6
      );
      expect(last.pmCmCostRatio).toBeCloseTo(
        summaryByKey.pmCmCostRatio as number,
        6
      );
      expect(last.mttrDays).toBeCloseTo(summaryByKey.mttrDays as number, 6);
      expect(last.pmComplianceYtdAverage).toBeCloseTo(
        summaryByKey.pmCompliance as number,
        6
      );
      expect(last.facilityUptimeYtdAverage).toBeCloseTo(
        summaryByKey.facilityUptime as number,
        6
      );
    }
  });

  it("charts stop at the effective month and never include future months", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    for (const section of data.sections) {
      const months = section.trends.map(point => point.month);
      expect(Math.max(...months)).toBeLessThanOrEqual(
        data.effectiveReportingMonth
      );
      expect(Math.max(...months)).toBeLessThanOrEqual(8);
      expect(months).not.toContain(9);
      expect(months).not.toContain(12);
    }
  });

  it("stores each BU's own Notes and Situation for the effective month only", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const amdEz = data.sections.find(
      section => section.businessUnit === "AMD-EZ"
    )!;
    const clark = data.sections.find(
      section => section.businessUnit === "Clark Water"
    )!;
    // AMD-EZ: stored Notes + stored Situation from its August record only.
    expect(amdEz.notes).toBe(
      "Transformer overhaul completed.\nSpare delivery tracked."
    );
    expect(amdEz.situation).toBe(
      "Corrective maintenance was completed inside the August window."
    );
    expect(amdEz.notes).not.toContain("spare parts availability from Clark");
    expect(amdEz.situation).not.toContain("pending validation");
    // Clark: its own stored Notes + stored Situation (August only).
    expect(clark.notes).toContain(
      "MTTR improved after spare parts availability."
    );
    expect(clark.situation).toContain("PM:CM cost data for August");
    expect(clark.notes).not.toContain("Transformer overhaul");
    expect(clark.situation).not.toContain("August window");
    // Readout text = section headings + stored wording bullets (no prefixes,
    // no missing-data phrases).
    const amdLines = storedNotesSituationLines(amdEz.notes, amdEz.situation);
    expect(amdLines.map(line => line.text)).toEqual([
      "Notes / Commentary",
      "Transformer overhaul completed.",
      "Spare delivery tracked.",
      "Situation",
      "Corrective maintenance was completed inside the August window.",
    ]);
    const clarkLines = storedNotesSituationLines(clark.notes, clark.situation);
    const clarkText = clarkLines.map(line => line.text);
    expect(clarkText.some(t => t.includes("not submitted"))).toBe(false);
    expect(clarkText).toContain(
      "PM:CM cost data for August is still pending validation."
    );
    const invented = [
      "pm compliance remains strong",
      "budget needs monitoring",
      "mttr requires improvement",
      "below benchmark",
      "key exceptions",
    ];
    for (const line of [...amdLines, ...clarkLines]) {
      expect(
        invented.some(phrase => line.text.toLowerCase().includes(phrase))
      ).toBe(false);
    }
  });

  it("earlier-month Notes/Situation are not silently reused for the effective month", () => {
    const tagum = buildAllBusinessUnitsDeckData(records, 2026, 9).sections.find(
      section => section.businessUnit === "Tagum Water"
    )!;
    // Tagum has a June note/situation but nothing stored for August; the deck
    // must not relabel June commentary as the August commentary.
    expect(tagum.notes).toBeNull();
    expect(tagum.situation).toBeNull();
    const lines = storedNotesSituationLines(tagum.notes, tagum.situation);
    expect(lines.map(line => line.text)).toEqual([
      "Notes / Commentary",
      NO_COMMENTARY_SUBMITTED,
      "Situation",
      NO_SITUATION_SUBMITTED,
    ]);
    expect(
      lines.some(line => line.text.includes("VFD failure investigated."))
    ).toBe(false);
    expect(
      lines.some(line => line.text.toLowerCase().includes("not submitted"))
    ).toBe(false);
  });
});

describe("deriveMissingDataReasons — explicit missing-data helper (never presentation Situation)", () => {
  function reasonsFor(buRecords: PersistedMonthlyKpiRecord[], bu: string, month = 8) {
    return deriveMissingDataReasons(buRecords, bu, 2026, month);
  }
  const asLower = (reasons: string[]) => reasons.map((r) => r.toLowerCase());

  it("a fully valid six-KPI record produces zero missing-data reasons", () => {
    const reasons = reasonsFor(records, "AMD-EZ");
    expect(reasons.length).toBe(0);
    for (const phrase of [
      "pm compliance not submitted",
      "facility uptime not submitted",
      "budget spend not submitted",
      "pm:cm work orders not submitted",
      "pm:cm cost not submitted",
      "mttr not submitted",
    ]) {
      expect(reasons.some((r) => r.toLowerCase().includes(phrase))).toBe(false);
    }
  });

  it("valid PM/CM WO, MTTR and PM/CM Cost data never yield their own 'not submitted' reasons", () => {
    const reasons = reasonsFor(records, "AMD-EZ");
    expect(reasons.some((r) => r.toLowerCase().includes("pm:cm work orders not submitted"))).toBe(false);
    expect(reasons.some((r) => r.toLowerCase().includes("mttr not submitted"))).toBe(false);
    expect(reasons.some((r) => r.toLowerCase().includes("pm:cm cost not submitted"))).toBe(false);
    expect(reasons.some((r) => r.toLowerCase().includes("pm compliance not submitted"))).toBe(false);
  });

  it("truly missing PM:CM Cost data yields exactly the correct reason and nothing else", () => {
    const reasons = reasonsFor(records, "Clark Water");
    expect(reasons.some((r) => r.toLowerCase().includes("pm:cm cost not submitted"))).toBe(true);
    expect(reasons.some((r) => r.toLowerCase().includes("pm compliance not submitted"))).toBe(false);
    expect(reasons.some((r) => r.toLowerCase().includes("facility uptime not submitted"))).toBe(false);
    expect(reasons.some((r) => r.toLowerCase().includes("budget spend not submitted"))).toBe(false);
  });

  it("emits neutral reasons only when their exact conditions are met (No Budget / No Work Orders / No Qualifying Downtime / Not Applicable)", () => {
    const full = (
      overrides: Partial<PersistedMonthlyKpiRecord>,
      omit?: (key: string) => boolean
    ) => {
      const monthValues = (month: number) => ({
        pmDone: 100 - month,
        actual: 100 * month + 10,
        budget: 200,
        pmWo: 40 + month,
        cmWo: 20 - (month % 3),
        pmCost: 1000 + 50 * month,
        cmCost: 500 - 10 * month,
        downtime: 60 * month + 5,
        repairs: month + 2,
        facilityDowntime: month,
      });
      const out: PersistedMonthlyKpiRecord[] = [];
      for (let m = 1; m <= 8; m += 1) {
        const v = monthValues(m);
        const rec: Record<string, unknown> = {
          ...base,
          business_unit: "Special BU",
          reporting_year: 2026,
          reporting_month: m,
          pm_orders_completed_on_time: 100 - m,
          total_pm_orders: 100,
          actual_spend: v.actual,
          budget: v.budget,
          pm_work_orders: v.pmWo,
          cm_work_orders: v.cmWo,
          pm_cost: v.pmCost,
          cm_cost: v.cmCost,
          mttr_downtime: v.downtime,
          repair_count: v.repairs,
          facility_operating_time: 1000,
          facility_downtime: v.facilityDowntime,
          notes: null,
          situation: null,
          raw_imported_values: { values: {} },
          ...overrides,
        };
        if (omit) {
          for (const [key, value] of Object.entries(rec)) {
            if (omit(key) && typeof value !== "object") rec[key] = null;
          }
        }
        out.push(rec as unknown as PersistedMonthlyKpiRecord);
      }
      return out;
    };

    const noBudget = reasonsFor(full({ budget: 0, actual_spend: null }), "Special BU");
    expect(noBudget).toContain("No Budget");
    expect(asLower(noBudget).some((r) => r.includes("budget spend not submitted"))).toBe(false);

    const noWorkOrders = reasonsFor(full({ pm_work_orders: 0, cm_work_orders: 0 }), "Special BU");
    expect(noWorkOrders).toContain("No Work Orders");
    expect(asLower(noWorkOrders).some((r) => r.includes("pm:cm work orders not submitted"))).toBe(false);

    const noDowntime = reasonsFor(full({ repair_count: 0, mttr_downtime: null, mttr_days: null }), "Special BU");
    expect(noDowntime).toContain("No Qualifying Downtime");
    expect(asLower(noDowntime).some((r) => r.includes("mttr not submitted"))).toBe(false);

    const noOrders = reasonsFor(full({ pm_orders_completed_on_time: null, total_pm_orders: 0 }), "Special BU");
    expect(noOrders).toContain("Not Applicable (no PM orders)");
    expect(asLower(noOrders).some((r) => r.includes("pm compliance not submitted"))).toBe(false);

    const noCmCost = reasonsFor(full({ pm_cost: 0, cm_cost: 0 }), "Special BU");
    expect(noCmCost).toContain("No CM Cost");
    expect(asLower(noCmCost).some((r) => r.includes("pm:cm cost not submitted"))).toBe(false);
  });

  it("valid PM/CM WO, MTTR, and PM/CM Cost source data never yield their OWN reasons when other KPIs are missing", () => {
    const buRecords = makeBusinessUnitRecords("Partial BU", {
      through: 8,
      omit: { pmCompliance: true, facilityUptime: true },
    });
    const reasons = reasonsFor(buRecords, "Partial BU");
    const lower = asLower(reasons);
    expect(lower.some((r) => r.includes("pm compliance not submitted"))).toBe(true);
    expect(lower.some((r) => r.includes("facility uptime not submitted"))).toBe(true);
    expect(lower.some((r) => r.includes("pm:cm work orders not submitted"))).toBe(false);
    expect(lower.some((r) => r.includes("mttr not submitted"))).toBe(false);
    expect(lower.some((r) => r.includes("pm:cm cost not submitted"))).toBe(false);
    expect(lower.some((r) => r.includes("budget spend not submitted"))).toBe(false);
  });

  it("a BU with no valid submission anywhere yields the six missing-data reasons - and nothing invented", () => {
    // Planned-budget-only rows are NOT submissions (live scorecard rule).
    const neverSubmitted = makeBusinessUnitRecords("Never Submitted BU", {
      through: 0,
    });
    const reasons = reasonsFor(neverSubmitted, "Never Submitted BU", 9);
    expect(reasons.length).toBe(6);
    for (const phrase of [
      "pm compliance not submitted",
      "facility uptime not submitted",
      "budget spend not submitted",
      "pm:cm work orders not submitted",
      "pm:cm cost not submitted",
      "mttr not submitted",
    ]) {
      expect(reasons.some((r) => r.toLowerCase().includes(phrase))).toBe(true);
    }
    for (const invented of ["improved", "remains strong", "needs monitoring", "risk", "concern"]) {
      expect(reasons.some((r) => r.toLowerCase().includes(invented))).toBe(false);
    }
  });
});

// Stored Notes/Situation are the ONLY source for deck commentary bullets.
describe("Deck commentary uses stored Notes + Situation (never missing-data reasons)", () => {
  it("stored Situation renders under the Situation heading with raw wording", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const amdEz = data.sections.find((section) => section.businessUnit === "AMD-EZ")!;
    expect(amdEz.situation).toBe(
      "Corrective maintenance was completed inside the August window."
    );
    const lines = storedNotesSituationLines(amdEz.notes, amdEz.situation);
    const texts = lines.map((line) => line.text);
    expect(texts).toContain("Situation");
    expect(texts).toContain(
      "Corrective maintenance was completed inside the August window."
    );
    expect(texts[0]).toBe("Notes / Commentary");
    // No missing-data phrase is treated as a business Situation bullet.
    for (const line of lines) {
      expect(line.text.toLowerCase()).not.toContain("not submitted");
      expect(line.text.toLowerCase()).not.toContain("no budget");
    }
  });

  it("missing Notes and missing Situation render per-field neutral lines under the headings", () => {
    const tagum = buildAllBusinessUnitsDeckData(records, 2026, 9).sections.find(
      (section) => section.businessUnit === "Tagum Water"
    )!;
    expect(tagum.notes).toBeNull();
    expect(tagum.situation).toBeNull();
    const lines = storedNotesSituationLines(tagum.notes, tagum.situation);
    const texts = lines.map((line) => line.text);
    expect(texts).toEqual([
      "Notes / Commentary",
      NO_COMMENTARY_SUBMITTED,
      "Situation",
      NO_SITUATION_SUBMITTED,
    ]);
    expect(texts.some((t) => t.toLowerCase().includes("not submitted"))).toBe(false);
  });

  it("stored text is trimmed and line endings normalized, never rewritten", () => {
    const data = buildAllBusinessUnitsDeckData(
      makeBusinessUnitRecords("Trim BU", {
        through: 8,
        notesByMonth: { 8: "  Line one.\r\nLine two.  " },
        situationByMonth: { 8: "\rStored situation text.\r\n" },
      }),
      2026,
      9
    );
    const section = data.sections.find((s) => s.businessUnit === "Trim BU")!;
    expect(section.notes).toBe("Line one.\nLine two.");
    expect(section.situation).toBe("Stored situation text.");
    expect(normalizeStoredCommentary("  x\r\ny  ")).toBe("x\ny");
    expect(normalizeStoredCommentary(null)).toBeNull();
    expect(normalizeStoredCommentary("   ")).toBeNull();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Manila Water master-clone deck structure (regression suite)
// ─────────────────────────────────────────────────────────────────────────────

const SCORECARD_KPI_KEYS_T = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mttrDays",
  "facilityUptime",
] as const;

function normalizeJoin(value: string): string {
  return value.replace(/[\s/]+/g, "");
}

async function orderedSlideXml(zip: JSZip): Promise<{ name: string; xml: string }[]> {
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const targetById = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
    targetById.set(m[1], m[2]);
  }
  const order: string[] = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*r:id="(rId\d+)"[^>]*\/>/g)) {
    const target = targetById.get(m[1]);
    if (target) order.push(target.replace("slides/", "ppt/slides/"));
  }
  const slides: { name: string; xml: string }[] = [];
  for (const name of order) {
    slides.push({ name, xml: await zip.file(name)!.async("string") });
  }
  return slides;
}

function tableRowTexts(xml: string): string[][] {
  return [...xml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((tr) => {
    const cells = [...tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((tc) =>
      [...tc[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
        .map((t) => t[1])
        .join("")
    );
    return cells;
  });
}

function shapeTextsByGroup(xml: string, shapeName: string): string[] {
  const spStart = xml.indexOf(`name="${shapeName}"`);
  if (spStart < 0) return [];
  // Walk back to the enclosing <p:sp> start.
  const spStartTag = xml.lastIndexOf("<p:sp>", spStart);
  const segment = xml.slice(spStartTag, spStart + 12000);
  const endIdx = segment.indexOf("</p:sp>");
  const sp = endIdx >= 0 ? segment.slice(0, endIdx) : segment;
  return [...sp.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((t) => t[1])
    .filter((t) => t.trim().length > 0);
}

function hasShape(xml: string, shapeName: string): boolean {
  return xml.includes(`name="${shapeName}"`);
}

function graphicFrameNames(xml: string): string[] {
  return [...xml.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((name, i, all) => all.indexOf(name) === i);
}

async function usesMasterLayout(zip: JSZip, slideName: string, xml: string): Promise<boolean> {
  // No explicit <p:bg> means the slide inherits the Manila Water master
  // background (which carries the lower-right logo). The slide must also be
  // laid out on the committed MW layout (slideLayout12).
  if (/<p:bg>[\s\S]*?<\/p:bg>/.test(xml)) return false;
  const relName = slideName.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
  const rels = await zip.file(relName)!.async("string");
  return rels.includes("slideLayout12.xml");
}

async function chartPartsForSlide(zip: JSZip, slideName: string): Promise<string[]> {
  const relName = slideName.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
  const rels = await zip.file(relName)!.async("string");
  return [...rels.matchAll(/Target="\.\.\/charts\/(chart\d+\.xml)"/g)].map((m) => m[1]);
}

async function chartCache(zip: JSZip, chartPart: string, seriesIndex: number): Promise<{ cats: string[]; vals: Array<number | null> }> {
  const xml = await zip.file(`ppt/charts/${chartPart}`)!.async("string");
  const sers = [...xml.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((m) => m[0]);
  const ser = sers[seriesIndex];
  if (!ser) return { cats: [], vals: [] };
  const catCache = ser.match(/<c:multiLvlStrCache>[\s\S]*?<\/c:multiLvlStrCache>/)?.[0] ?? "";
  const cats = [...catCache.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => m[1]);
  const numCache = ser.match(/<c:numCache>[\s\S]*?<\/c:numCache>/)?.[0] ?? "";
  const vals = [...numCache.matchAll(/<c:pt idx="(\d+)"><c:v>([^<]*)<\/c:v><\/c:pt>/g)].map((m) => ({
    idx: Number(m[1]),
    v: Number(m[2]),
  }));
  const maxIdx = vals.length ? Math.max(...vals.map((v) => v.idx)) : -1;
  const out: Array<number | null> = Array.from({ length: maxIdx + 1 }, () => null);
  for (const { idx, v } of vals) out[idx] = v;
  return { cats, vals: out };
}

describe("All-Business-Units deck — Manila Water master-clone structure", () => {
  it("produces one cover slide plus exactly two slides per BU, ordered Scorecard then Trends per BU", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(slideCountFromZip(zip)).toBe(1 + 2 * data.sections.length);

    const slides = await orderedSlideXml(zip);
    expect(slides.length).toBe(1 + 2 * data.sections.length);
    expect(slides[0].xml).toContain("All Business Units");
    expect(slides[0].xml).toContain(data.effectiveReportingMonthLabel);
    expect(slides[0].xml).toContain(`${data.sections.length} business unit(s)`);
    for (let i = 0; i < data.sections.length; i++) {
      const section = data.sections[i];
      const scorecard = slides[1 + i * 2];
      const trends = slides[2 + i * 2];
      expect(scorecard.xml).toContain(`Monthly Reliability KPI Scorecard, ${section.businessUnit}`);
      expect(trends.xml).toContain(`Monthly Reliability KPI Trends, ${section.businessUnit}`);
      expect(scorecard.xml).toContain("AMD-EZ Monthly KPI Scorecard");
      expect(trends.xml).not.toContain("AMD-EZ Monthly KPI Scorecard");
    }
  });

  it("every Scorecard slide uses the Manila Water master structure and no other slide type is generated", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);
    const deckText = slides.map((s) => s.xml).join("\n");
    // No portfolio matrix or issues-matrix slide types.
    expect(deckText).not.toContain("Reliability KPI Scorecard – All BUs");
    expect(deckText).not.toContain("Maintenance KPI issues matrix");

    for (let i = 0; i < data.sections.length; i++) {
      const xml = slides[1 + i * 2].xml;
      expect(hasShape(xml, "Slide Title")).toBe(true);
      expect(hasShape(xml, "RAG Legend")).toBe(true);
      expect(hasShape(xml, "Executive Readout")).toBe(true);
      expect(graphicFrameNames(xml)).toContain("AMD-EZ Monthly KPI Scorecard");
      expect(await usesMasterLayout(zip, slides[1 + i * 2].name, xml)).toBe(true);
    }
  });

  it("Scorecard tables keep the master header, YTD row, TARGET row and a monthly row per Jan..effective month", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);

    for (let i = 0; i < data.sections.length; i++) {
      const xml = slides[1 + i * 2].xml;
      const rows = tableRowTexts(xml);
      const effective = data.effectiveReportingMonth;
      // header + effective months + YTD + TARGET
      expect(rows.length).toBe(1 + effective + 2);
      const header = normalizeJoin(rows[0].join("|"));
      expect(header).toContain("Month");
      for (const expected of [
        "PMCompliance",
        "BudgetSpend",
        "PM:CMRatio(#ofWO's)",
        "PM:CMRatio(Cost)",
        "MTTR*(days)",
        "FacilityUptime",
      ]) {
        expect(header).toContain(expected);
      }
      expect(rows[rows.length - 2][0]).toBe("YTD");
      expect(rows[rows.length - 1][0]).toBe("TARGET");
      expect(rows[rows.length - 1].slice(1)).toEqual([
        "≥98%",
        "95%–105%",
        "≥86% (6:1)",
        "≥80% (4:1)",
        "DOWNWARD",
        "=100%",
      ]);
      // Month column reads Jan..E in order.
      const months = rows.slice(1, rows.length - 2).map((r) => r[0]);
      expect(months).toEqual(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].slice(0, effective)
      );
    }
  });

  it("monthly table rows are authoritative: Group A rows = cumulative Jan..M, Group B rows = standalone month, YTD row = live aggregate", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const effective = data.effectiveReportingMonth;
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);

    for (let i = 0; i < data.sections.length; i++) {
      const section = data.sections[i];
      const xml = slides[1 + i * 2].xml;
      const rows = tableRowTexts(xml);
      const aggregate = aggregateMonthlyKpiRecords(records, 2026, effective);
      const live = aggregate.byBusinessUnitMap[section.businessUnit];

      for (let month = 1; month <= effective; month++) {
        const rowIndex = month; // 1-based below header
        const cells = rows[rowIndex].slice(1);
        const trend = section.trends.find((point) => point.month === month);
        const cumulative = trend ? aggregateMonthlyKpiRecords(records, 2026, month).byBusinessUnitMap[section.businessUnit] : null;
        for (const key of SCORECARD_KPI_KEYS_T) {
          const colIndex = SCORECARD_KPI_KEYS_T.indexOf(key);
          const cell = cells[colIndex] ?? "";
          // Months after a lagging BU's last submitted month stay blank: the
          // scorecard never fabricates values for unsubmitted months.
          const expected = !trend
            ? ""
            : (() => {
                const monthlyCumulative = cumulative ? (cumulative[key] as number | null) : null;
                const standalone =
                  key === "pmCompliance" ? trend.pmComplianceMonthly ?? null :
                  key === "facilityUptime" ? trend.facilityUptimeMonthly ?? null : null;
                const groupA = key !== "pmCompliance" && key !== "facilityUptime";
                return formatScorecardCell(
                  key,
                  groupA ? monthlyCumulative : (standalone as number | null)
                );
              })();
          expect(cell, `${section.businessUnit} month ${month} ${key}`).toBe(expected);
        }
      }

      // YTD row equals the live Monthly KPI aggregate for the BU/month.
      const ytdCells = rows[rows.length - 2].slice(1);
      SCORECARD_KPI_KEYS_T.forEach((key, colIndex) => {
        const expected = formatScorecardCell(key, live ? (live[key] as number | null) : null);
        expect(ytdCells[colIndex], `${section.businessUnit} YTD ${key}`).toBe(expected);
      });
    }
  });

  it("commentary bullets come only from each BU's Notes + Situation; no threshold-generated 'Key exceptions' text and no leakage", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);

    const deckText = slides.map((s) => s.xml).join("\n");
    expect(deckText.toLowerCase()).not.toContain("key exceptions");

    for (let i = 0; i < data.sections.length; i++) {
      const section = data.sections[i];
      const readoutTexts = shapeTextsByGroup(
        slides[1 + i * 2].xml,
        "Executive Readout"
      );
      const expectedTexts = storedNotesSituationLines(
        section.notes,
        section.situation
      ).map((line) => line.text);
      expect(readoutTexts).toEqual(expectedTexts);
      // Both section headings always render, and the neutral line appears
      // exactly for the field that is blank (never inventing content).
      expect(readoutTexts[0]).toBe("Notes / Commentary");
      expect(readoutTexts).toContain("Situation");
      expect(readoutTexts.some((t) => t === NO_COMMENTARY_SUBMITTED)).toBe(
        section.notes === null
      );
      expect(readoutTexts.some((t) => t === NO_SITUATION_SUBMITTED)).toBe(
        section.situation === null
      );
      // Commentary must never leak from a different BU (notes or situation).
      for (const other of data.sections) {
        if (other.businessUnit === section.businessUnit) continue;
        for (const text of [other.notes, other.situation]) {
          for (const part of (text ?? "").split(/\n+/)) {
            const trimmed = part.trim();
            if (trimmed) {
              expect(readoutTexts.some((t) => t.includes(trimmed))).toBe(false);
            }
          }
        }
      }
    }
  });

  it("every Trends slide carries six charts plus the shared MW layout/logo, and chart titles match the six KPI panels", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);
    const chartCount = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length;
    expect(chartCount).toBe(6 * data.sections.length);

    const titles = [
      "PM Compliance (%)",
      "Budget Spend (%)",
      "PM:CM WO (%)",
      "PM:CM Cost (%)",
      "MTTR (Days)",
      "Facility Uptime (%)",
    ];
    for (let i = 0; i < data.sections.length; i++) {
      const xml = slides[2 + i * 2].xml;
      expect(await usesMasterLayout(zip, slides[1 + i * 2].name, xml)).toBe(true);
      const frames = (xml.match(/<c:chart\b/g) ?? []).length;
      expect(frames).toBe(6);
      const chartParts = await chartPartsForSlide(zip, slides[2 + i * 2].name);
      expect(chartParts.length).toBe(6);
      for (const title of titles) {
        expect(xml, `${data.sections[i].businessUnit} should show ${title}`).toContain(title);
      }
      // The same Manila Water logo (master background media) is present.
      expect(zip.file("ppt/media/image1.jpeg")).toBeTruthy();
    }
  });

  it("trends chart windows stop at the common effective month (or the BU's real last data month) and never plot future months", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    expect(data.effectiveReportingMonth).toBe(8);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);

    for (let i = 0; i < data.sections.length; i++) {
      const section = data.sections[i];
      const expectedMonths = section.trends.length;
      const chartParts = await chartPartsForSlide(zip, slides[2 + i * 2].name);
      for (const part of chartParts) {
        const { cats } = await chartCache(zip, part, 0);
        expect(cats.length).toBe(expectedMonths);
        expect(cats).not.toContain("Sep");
        expect(cats).not.toContain("Dec");
      }
      // Slide headers still report the common portfolio month, never a relabel.
      expect(slides[2 + i * 2].xml).toContain(`Reporting period: ${data.effectiveReportingMonthLabel}`);
    }
    const tagum = data.sections.find((s) => s.businessUnit === "Tagum Water")!;
    expect(tagum.trends.length).toBe(6);
  });

  it("Trends chart grid is exactly 3 equal columns x 2 equal rows (dashboard layout)", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);
    for (let i = 0; i < data.sections.length; i++) {
      const xml = slides[2 + i * 2].xml;
      const frames: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (const m of xml.matchAll(/<p:graphicFrame>([\s\S]*?)<\/p:graphicFrame>/g)) {
        const off = m[1].match(/<a:off x="(\d+)" y="(\d+)"\/>/);
        const ext = m[1].match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
        if (off && ext && m[1].includes("<c:chart")) {
          frames.push({
            x: Number(off[1]) / 914400,
            y: Number(off[2]) / 914400,
            w: Number(ext[1]) / 914400,
            h: Number(ext[2]) / 914400,
          });
        }
      }
      expect(frames.length).toBe(6);
      const topY = Math.min(...frames.map((f) => f.y));
      const bottomY = Math.max(...frames.map((f) => f.y));
      const topRow = frames.filter((f) => f.y === topY).sort((a, b) => a.x - b.x);
      const bottomRow = frames.filter((f) => f.y === bottomY).sort((a, b) => a.x - b.x);
      expect(topRow.length).toBe(3);
      expect(bottomRow.length).toBe(3);
      const widths = frames.map((f) => f.w);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.02);
      for (let c = 0; c < 3; c++) {
        expect(topRow[c].x).toBeCloseTo(bottomRow[c].x, 2);
      }
      // Top row sits strictly above the bottom row and the grid stays inside
      // the logo-safe area.
      expect(topY).toBeGreaterThan(0.9);
      expect(bottomY - topY).toBeGreaterThan(1.5);
      expect(Math.max(...frames.map((f) => f.y + f.h))).toBeLessThan(6.6);
    }
  });

  it("combo series structure: Monthly Actual is a column and YTD/YTD-average is a line where both exist", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);
    const chartParts = await chartPartsForSlide(zip, slides[2].name);
    expect(chartParts.length).toBe(6);
    const xmlOf = async (part: string) => zip.file(`ppt/charts/${part}`)!.async("string");

    // PM Compliance: bar group (Monthly Actual) + line group (YTD Average + Benchmark).
    const pmXml = await xmlOf(chartParts[0]);
    expect(pmXml).toContain("<c:barChart>");
    expect(pmXml).toContain('<c:barDir val="col"/>');
    expect(pmXml).toContain("<c:lineChart>");
    expect(pmXml).toContain("Monthly Actual");
    expect(pmXml).toContain("YTD Average");
    expect(pmXml).toContain("Benchmark ≥98%");
    expect(pmXml).toContain('prstDash val="dash"');

    // Facility Uptime: same combo shape.
    const fuXml = await xmlOf(chartParts[5]);
    expect(fuXml).toContain("<c:barChart>");
    expect(fuXml).toContain('<c:barDir val="col"/>');
    expect(fuXml).toContain("Monthly Actual");
    expect(fuXml).toContain("YTD Average");
    expect(fuXml).toContain("Benchmark =100%");
    expect(fuXml).toContain('prstDash val="dash"');

    // Group A panels (Budget/WO/Cost/MTTR): no bars - the authoritative trend
    // model exposes only the cumulative YTD series for these KPIs, so monthly
    // bars would be invented presentation data.
    const budgetXml = await xmlOf(chartParts[1]);
    expect(budgetXml).not.toContain("<c:barChart>");
    expect(budgetXml).toContain("Benchmark 95%");
    expect(budgetXml).toContain("Benchmark 105%");
    const woXml = await xmlOf(chartParts[2]);
    expect(woXml).not.toContain("<c:barChart>");
    expect(woXml).toContain("Benchmark ≥86%");
    const costXml = await xmlOf(chartParts[3]);
    expect(costXml).not.toContain("<c:barChart>");
    expect(costXml).toContain("Benchmark ≥80%");
    const mttrXml = await xmlOf(chartParts[4]);
    expect(mttrXml).not.toContain("<c:barChart>");
    expect(mttrXml).not.toContain("Benchmark");
    expect(mttrXml).not.toContain("dash");

    // Every chart still carries its own six series totals (bar group + line
    // group share the same underlying series).
    const seriesCounts: number[] = [];
    for (const part of chartParts) {
      const xml = await xmlOf(part);
      seriesCounts.push((xml.match(/<c:ser>/g) ?? []).length);
    }
    expect(seriesCounts).toEqual([3, 3, 2, 2, 1, 3]);
  });

  it("Group A trend final points and Group B YTD-average final points match the Slide 1 YTD values", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);

    for (let i = 0; i < data.sections.length; i++) {
      const section = data.sections[i];
      const last = section.trends[section.trends.length - 1];
      if (!last) continue;
      const summaryByKey = Object.fromEntries(section.summary.map((r) => [r.key, r.value]));
      const chartParts = await chartPartsForSlide(zip, slides[2 + i * 2].name);
      const panelKeys = [
        "pmCompliance",
        "budgetSpend",
        "pmCmWorkOrderRatio",
        "pmCmCostRatio",
        "mttrDays",
        "facilityUptime",
      ] as const;
      for (let panel = 0; panel < 6; panel++) {
        const key = panelKeys[panel];
        const firstSeries = await chartCache(zip, chartParts[panel], 0);
        const final = firstSeries.vals[firstSeries.vals.length - 1];
        // The chart series carrying the YTD value is the 2nd for Group B, 1st for Group A.
        const secondSeries = await chartCache(zip, chartParts[panel], 1);
        const ytdValue =
          key === "pmCompliance" || key === "facilityUptime"
            ? secondSeries.vals[secondSeries.vals.length - 1]
            : final;
        const expectedRaw = summaryByKey[key] as number | null;
        if (expectedRaw !== null && expectedRaw !== undefined) {
          expect(Math.abs(Number(ytdValue) - expectedRaw)).toBeLessThanOrEqual(0.6);
        }
      }
    }
  });
});

describe("Monthly Actuals in Trend Charts (Group B) and Group A containment", () => {
  function fixtureTrendActuals(section: { businessUnit: string; trends: { month: number; pmComplianceMonthly: number | null; facilityUptimeMonthly: number | null }[] }) {
    // Underlying raw inputs per month for the standard fixture:
    // pm compliance = (100 - month)/100*100, facility uptime = (1000-month)/1000*100.
    for (const point of section.trends) {
      expect(point.pmComplianceMonthly).toBeCloseTo(100 - point.month, 6);
      expect(point.facilityUptimeMonthly).toBeCloseTo((1000 - point.month) / 1000 * 100, 6);
    }
  }

  it("PM Compliance and Facility Uptime monthly actuals exist for every valid submitted month and equal the authoritative standalone values", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    for (const section of data.sections) {
      expect(section.trends.length).toBeGreaterThan(0);
      fixtureTrendActuals(section);
      // No future/unsubmitted months and no fabricated zeros.
      expect(Math.max(...section.trends.map((p) => p.month))).toBeLessThanOrEqual(
        data.effectiveReportingMonth
      );
      expect(
        section.trends.every(
          (p) =>
            p.pmComplianceMonthly === null || p.pmComplianceMonthly > 0
        )
      ).toBe(true);
    }
  });

  it("PM Compliance / Facility Uptime YTD averages match the running mean of the monthly actuals", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    for (const section of data.sections) {
      let sumPm = 0;
      let sumFu = 0;
      let count = 0;
      for (const point of section.trends) {
        if (point.pmComplianceMonthly !== null && point.facilityUptimeMonthly !== null) {
          sumPm += point.pmComplianceMonthly;
          sumFu += point.facilityUptimeMonthly;
          count += 1;
          expect(point.pmComplianceYtdAverage).toBeCloseTo(sumPm / count, 6);
          expect(point.facilityUptimeYtdAverage).toBeCloseTo(sumFu / count, 6);
        }
      }
      const last = section.trends[section.trends.length - 1];
      const summaryByKey = Object.fromEntries(
        section.summary.map((row) => [row.key, row.value])
      );
      expect(last.pmComplianceYtdAverage).toBeCloseTo(summaryByKey.pmCompliance as number, 6);
      expect(last.facilityUptimeYtdAverage).toBeCloseTo(summaryByKey.facilityUptime as number, 6);
    }
  });

  it("writes the monthly-actual bar series values + month labels into the chart caches", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);

    for (let i = 0; i < data.sections.length; i++) {
      const section = data.sections[i];
      const chartParts = await chartPartsForSlide(zip, slides[2 + i * 2].name);
      // Panel order: 0 = PM Compliance (bar series 0), 5 = Facility Uptime (bar series 0).
      for (const panel of [0, 5]) {
        const cache = await chartCache(zip, chartParts[panel], 0);
        expect(cache.cats).toEqual(section.trends.map((p) => p.monthLabel));
        section.trends.forEach((point, idx) => {
          const monthly =
            panel === 0 ? point.pmComplianceMonthly : point.facilityUptimeMonthly;
          if (monthly === null || monthly === undefined) return;
          expect(cache.vals[idx]).toBeCloseTo(Math.round(monthly * 100) / 100, 5);
        });
      }
    }
  });

  it("never introduces standalone monthly series into Group A cumulative charts", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);
    const chartParts = await chartPartsForSlide(zip, slides[2].name);
    for (const idx of [1, 2, 3, 4]) {
      const xml = await zip.file(`ppt/charts/${chartParts[idx]}`)!.async("string");
      expect(xml).not.toContain("<c:barChart>");
      expect(xml).not.toContain("Monthly Actual");
    }
  });

  it("chart monthly-actual values never leak between BUs", async () => {
    const base: Record<string, unknown> = {
      pm_compliance: null,
      budget_spend: null,
      pm_cm_work_order_ratio: null,
      pm_cm_cost_ratio: null,
      mttr_days: null,
      facility_uptime: null,
    };
    const distinct: PersistedMonthlyKpiRecord[] = [];
    for (const [bu, pmBase] of [
      ["Alpha", 40],
      ["Beta", 60],
    ] as const) {
      for (let m = 1; m <= 8; m++) {
        distinct.push({
          ...(base as PersistedMonthlyKpiRecord),
          business_unit: bu,
          reporting_year: 2026,
          reporting_month: m,
          notes: null,
          pm_compliance: pmBase,
          pm_orders_completed_on_time: pmBase,
          total_pm_orders: 100,
          facility_uptime: 99,
          facility_operating_time: 1000,
          facility_downtime: 10,
          raw_imported_values: { values: {} },
        } as unknown as PersistedMonthlyKpiRecord);
      }
    }
    const data = buildAllBusinessUnitsDeckData(distinct, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);
    const alphaIndex = data.sections.findIndex((s) => s.businessUnit === "Alpha");
    const betaIndex = data.sections.findIndex((s) => s.businessUnit === "Beta");
    const alphaParts = await chartPartsForSlide(zip, slides[2 + alphaIndex * 2].name);
    const betaParts = await chartPartsForSlide(zip, slides[2 + betaIndex * 2].name);
    const alphaPm = await chartCache(zip, alphaParts[0], 0);
    const betaPm = await chartCache(zip, betaParts[0], 0);
    for (let i = 0; i < alphaPm.vals.length; i++) {
      if (alphaPm.vals[i] !== null) expect(alphaPm.vals[i]).toBeCloseTo(40, 5);
      if (betaPm.vals[i] !== null) expect(betaPm.vals[i]).toBeCloseTo(60, 5);
    }
  });
});

describe("Generated PPTX package validation (Monthly KPI deck)", () => {
  it("is a valid PPTX package whose native chart parts carry populated series names and value caches", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file("ppt/presentation.xml")).toBeTruthy();
    expect(zip.file("ppt/slides/slide1.xml")).toBeTruthy();

    const chartNames = Object.keys(zip.files).filter((n) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(n)
    );
    expect(chartNames.length).toBe(6 * data.sections.length);

    const slides = await orderedSlideXml(zip);
    const amdIndex = data.sections.findIndex((s) => s.businessUnit === "AMD-EZ");
    const parts = await chartPartsForSlide(zip, slides[2 + amdIndex * 2].name);
    expect(parts.length).toBe(6);

    const pmXml = await zip.file(`ppt/charts/${parts[0]}`)!.async("string");
    expect(pmXml).toContain("Monthly Actual");
    expect(pmXml).toContain("YTD Average");
    expect(pmXml).toContain("Benchmark ≥98%");
    const fuXml = await zip.file(`ppt/charts/${parts[5]}`)!.async("string");
    expect(fuXml).toContain("Monthly Actual");
    expect(fuXml).toContain("YTD Average");
    expect(fuXml).toContain("Benchmark =100%");
    const mttrXml = await zip.file(`ppt/charts/${parts[4]}`)!.async("string");
    expect(mttrXml).toContain("YTD / Cumulative");

    // Cached values are populated for a fully-submitted BU.
    for (const part of parts) {
      const xml = await zip.file(`ppt/charts/${part}`)!.async("string");
      expect(xml).toContain("<c:ptCount");
      expect(xml).toContain("<c:pt idx=");
    }
  });
});

function readoutInnerBody(xml: string): string {
  const start = xml.indexOf('name="Executive Readout"');
  const bodyStart = xml.indexOf("<p:txBody>", start);
  const openEnd = xml.indexOf(">", bodyStart) + 1;
  const bodyEnd = xml.indexOf("</p:txBody>", openEnd);
  return xml.slice(openEnd, bodyEnd);
}

function readoutParagraphFlags(xml: string): Array<{ text: string; bullet: boolean; heading: boolean }> {
  const body = readoutInnerBody(xml);
  const out: Array<{ text: string; bullet: boolean; heading: boolean }> = [];
  for (const m of body.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
    const p = m[0];
    const text = [...p.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((x) => x[1])
      .join("");
    const hasBuNone = /<a:buNone\b[^>]*\/>/.test(p);
    const hasBullet = /<a:buChar\b[^>]*char="•"/.test(p);
    out.push({ text, bullet: hasBullet && !hasBuNone, heading: hasBuNone });
  }
  return out;
}


const DRAWINGML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

function hasNestedRun(body: string): boolean {
  const doc = parseXml(
    `<?xml version="1.0"?><root xmlns:a="${DRAWINGML_NS}">${body}</root>`
  );
  const runs = doc.getElementsByTagNameNS(DRAWINGML_NS, "r");
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const children = run.childNodes;
    for (let c = 0; c < children.length; c++) {
      const child = children[c] as unknown as Element;
      if (
        child &&
        child.localName === "r" &&
        child.namespaceURI === DRAWINGML_NS
      ) {
        return true;
      }
    }
  }
  return false;
}

describe("Readout heading/bullet XML structure (no buNone leakage, no nested runs)", () => {
  async function slidesOfDeck() {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return orderedSlideXml(zip);
  }

  it("headings have no bullet; content lines keep the bullet marker", async () => {
    const slides = await slidesOfDeck();
    // AMD slide (index 1): notes has 2 lines + situation 1 line.
    const flags = readoutParagraphFlags(slides[1].xml);
    expect(flags.map((f) => f.text)).toEqual([
      "Notes / Commentary",
      "Transformer overhaul completed.",
      "Spare delivery tracked.",
      "Situation",
      "Corrective maintenance was completed inside the August window.",
    ]);
    expect(flags[0].heading).toBe(true);
    expect(flags[0].bullet).toBe(false);
    expect(flags[1].bullet).toBe(true);
    expect(flags[2].bullet).toBe(true);
    expect(flags[3].heading).toBe(true);
    expect(flags[4].bullet).toBe(true);
  });

  it("neutral placeholder lines keep the bullet marker under their headings", async () => {
    const slides = await slidesOfDeck();
    // Tagum slide (index 5) has no stored notes/situation.
    const flags = readoutParagraphFlags(slides[5].xml);
    expect(flags.map((f) => f.text)).toEqual([
      "Notes / Commentary",
      "No commentary submitted.",
      "Situation",
      "No situation submitted.",
    ]);
    expect(flags[0].heading).toBe(true);
    expect(flags[1].bullet).toBe(true);
    expect(flags[2].heading).toBe(true);
    expect(flags[3].bullet).toBe(true);
  });

  it("production-shaped CWC/LARC/AMD-EZ records render their exact readout sections without leakage", async () => {
    const named = [
      ...makeBusinessUnitRecords("AMD-EZ", { through: 8 }),
      ...makeBusinessUnitRecords("CWC", {
        through: 8,
        notesByMonth: {
          8: "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
        },
      }),
      ...makeBusinessUnitRecords("LARC", {
        through: 8,
        notesByMonth: {
          8: "Budget Spend: Replacement of filters; Facility Uptime: Genset breakdown (Facility Primary Power Supply)",
        },
      }),
    ];
    const data = buildAllBusinessUnitsDeckData(named, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);
    const byIndex = new Map<string, string>();
    for (let i = 0; i < data.sections.length; i++) {
      byIndex.set(data.sections[i].businessUnit, slides[1 + i * 2].xml);
    }
    const textsFor = (bu: string) =>
      readoutParagraphFlags(byIndex.get(bu)!).map((f) => f.text);

    expect(textsFor("AMD-EZ")).toEqual([
      "Notes / Commentary",
      NO_COMMENTARY_SUBMITTED,
      "Situation",
      NO_SITUATION_SUBMITTED,
    ]);
    expect(textsFor("CWC")).toEqual([
      "Notes / Commentary",
      "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
      "Situation",
      NO_SITUATION_SUBMITTED,
    ]);
    expect(textsFor("LARC")).toEqual([
      "Notes / Commentary",
      "Budget Spend: Replacement of filters; Facility Uptime: Genset breakdown (Facility Primary Power Supply)",
      "Situation",
      NO_SITUATION_SUBMITTED,
    ]);
    // No cross-BU leakage of note text.
    expect(textsFor("CWC").join(" ")).not.toContain("Replacement of filters");
    expect(textsFor("LARC").join(" ")).not.toContain("Exceed budget");
    expect(textsFor("AMD-EZ").join(" ")).not.toContain("Exceed budget");
    expect(textsFor("AMD-EZ").join(" ")).not.toContain("Replacement of filters");
  });

  it("every section readout run carries deterministic visible formatting (headings 172B47 bold, bullets 111111, Aptos)", async () => {
    const named = [
      ...makeBusinessUnitRecords("AMD-EZ", { through: 8 }),
      ...makeBusinessUnitRecords("CWC", {
        through: 8,
        notesByMonth: {
          8: "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
        },
      }),
      ...makeBusinessUnitRecords("LARC", {
        through: 8,
        notesByMonth: {
          8: "Budget Spend: Replacement of filters; Facility Uptime: Genset breakdown (Facility Primary Power Supply)",
        },
      }),
    ];
    const data = buildAllBusinessUnitsDeckData(named, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slides = await orderedSlideXml(zip);
    const byIndex = new Map<string, string>();
    for (let i = 0; i < data.sections.length; i++) {
      byIndex.set(data.sections[i].businessUnit, slides[1 + i * 2].xml);
    }

    const parse = (xml: string) => {
      const body = readoutInnerBody(xml);
      type RunInfo = { text: string; rPr: string; buNone: boolean; buChar: boolean };
      const runs: RunInfo[] = [];
      for (const pm of body.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
        const p = pm[0];
        const text = [...p.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
          .map((x) => x[1])
          .join("");
        runs.push({
          text,
          rPr: p.match(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/)?.[0] ?? "",
          buNone: /<a:buNone\b[^>]*\/>/.test(p),
          buChar: /<a:buChar\b[^>]*char="•"/.test(p),
        });
      }
      return { runs, body };
    };

    const assertHeading = (r: { text: string; rPr: string; buNone: boolean }) => {
      expect(r.text === "Notes / Commentary" || r.text === "Situation").toBe(true);
      expect(r.buNone).toBe(true);
      expect(r.rPr).toMatch(/lang="en-PH"/);
      expect(r.rPr).toMatch(/sz="1200"/);
      expect(r.rPr).toMatch(/ b="1"/);
      expect(r.rPr).toContain('<a:srgbClr val="172B47"/>');
      expect((r.rPr.match(/typeface="Aptos"/g) || []).length).toBe(3);
      expect(r.rPr).not.toContain("schemeClr");
      expect((r.rPr.match(/<a:solidFill>/g) || []).length).toBe(1);
    };
    const assertBullet = (r: { rPr: string; buChar: boolean }) => {
      expect(r.buChar).toBe(true);
      expect(r.rPr).toMatch(/lang="en-PH"/);
      expect(r.rPr).toMatch(/sz="1200"/);
      expect(r.rPr).toMatch(/ b="0"/);
      expect(r.rPr).toContain('<a:srgbClr val="111111"/>');
      expect((r.rPr.match(/typeface="Aptos"/g) || []).length).toBe(3);
      expect(r.rPr).not.toContain("schemeClr");
    };

    for (const buName of ["CWC", "LARC", "AMD-EZ"]) {
      const { runs, body } = parse(byIndex.get(buName)!);
      assertHeading(runs[0]);
      assertHeading(runs[2]);
      expect(runs[0].text).toBe("Notes / Commentary");
      expect(runs[2].text).toBe("Situation");
      // Every content line (stored note or neutral) is a formatted bullet.
      for (const content of [runs[1], runs[3]]) {
        assertBullet(content);
      }
      if (buName === "CWC") {
        expect(runs[1].text).toBe(
          "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44"
        );
      }
      if (buName === "LARC") {
        expect(runs[1].text).toBe(
          "Budget Spend: Replacement of filters; Facility Uptime: Genset breakdown (Facility Primary Power Supply)"
        );
      }
      if (buName === "AMD-EZ") {
        expect(runs[1].text).toBe(NO_COMMENTARY_SUBMITTED);
      }
      expect(runs[3].text).toBe(NO_SITUATION_SUBMITTED);
      // No nested a:r; exactly one rPr per run inside the readout body.
      expect(body).not.toContain("<a:r><a:r>");
      expect((body.match(/<a:rPr\b/g) || []).length).toBe(
        (body.match(/<a:r\b/g) || []).length
      );
    }
  });

  it("never produces nested a:r elements inside the readout", async () => {
    const slides = await slidesOfDeck();
    for (const slide of slides) {
      if (!slide.xml.includes('name="Executive Readout"')) continue;
      expect(hasNestedRun(readoutInnerBody(slide.xml))).toBe(false);
    }
  });
});
describe("OPC/package integrity audit (generated All-BU deck)", () => {
  function resolveTarget(relsFile: string, target: string): string {
    if (target.startsWith("/")) return target.slice(1);
    let base = relsFile.slice(0, relsFile.lastIndexOf("/") + 1);
    if (base.endsWith("_rels/")) base = base.slice(0, -"_rels/".length);
    const combined = (base + target).split("/");
    const stack: string[] = [];
    for (const part of combined) {
      if (part === "..") stack.pop();
      else if (part && part !== ".") stack.push(part);
    }
    return stack.join("/");
  }

  it("every relationship target exists; relationship ids are unique; xml parts parse; content types cover slides/charts", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    const partNames = new Set(Object.keys(zip.files).filter((n) => !zip.files[n].dir));
    const relFiles = [...partNames].filter((n) => n.endsWith(".rels"));
    expect(relFiles.length).toBeGreaterThan(10);

    for (const relFile of relFiles) {
      const xml = await zip.file(relFile)!.async("string");
      const ids = [...xml.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length); // no duplicate relationship ids
      for (const m of xml.matchAll(/<Relationship\b[^>]*Target="([^"]+)"/g)) {
        const resolved = resolveTarget(relFile, m[1]);
        expect(
          partNames.has(resolved),
          `dangling target in ${relFile}: "${m[1]}" resolved to "${resolved}"`
        ).toBe(true);
      }
    }

    // Every XML part parses.
    for (const name of partNames) {
      if (!name.endsWith(".xml")) continue;
      const text = await zip.file(name)!.async("string");
      expect(() => parseXml(text)).not.toThrow();
    }

    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
    const slideNames = [...partNames].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const chartNames = [...partNames].filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    for (const slide of slideNames) {
      expect(contentTypes).toContain(`/${slide}`);
    }
    for (const chart of chartNames) {
      expect(contentTypes).toContain(`/${chart}`);
    }
    expect(chartNames.length).toBe(6 * data.sections.length);
  });
});
