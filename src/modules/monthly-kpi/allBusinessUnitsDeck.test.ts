import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildAllBusinessUnitsDeckData,
  normalizeCommentaryBullets,
} from "./allBusinessUnitsData";
import { generateAllBusinessUnitsMonthlyKpiDeck } from "./allBusinessUnitsDeck";
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

function makeBusinessUnitRecords(businessUnit: string, options: FixtureOptions = {}): PersistedMonthlyKpiRecord[] {
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
      pm_compliance: omit.pmCompliance ? null : 100 - month,
      pm_orders_completed_on_time: omit.pmCompliance ? null : 100 - month,
      total_pm_orders: 100,
      actual_spend: omit.budget ? null : v.actualSpend,
      budget: omit.budget ? 0 : 200,
      budget_spend: omit.budget ? null : (v.actualSpend / 200) * 100,
      pm_work_orders: omit.pmCmWo ? null : v.pmWo,
      cm_work_orders: omit.pmCmWo ? null : v.cmWo,
      pm_cm_work_order_ratio: omit.pmCmWo ? null : (v.pmWo / (v.pmWo + v.cmWo)) * 100,
      pm_cost: omit.pmCost ? null : v.pmCost,
      cm_cost: omit.cmCost ? null : v.cmCost,
      pm_cm_cost_ratio:
        omit.pmCost || omit.cmCost ? null : (v.pmCost / (v.pmCost + v.cmCost)) * 100,
      mttr_downtime: omit.mttr ? null : v.downtime,
      repair_count: omit.mttr ? null : v.repairs,
      mttr_days: omit.mttr ? null : v.downtime / v.repairs,
      facility_operating_time: 1000,
      facility_downtime: v.facilityDowntime,
      facility_uptime: ((1000 - v.facilityDowntime) / 1000) * 100,
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
          facility_operating_time: 1000,
          facility_downtime: v.facilityDowntime,
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
  });
  const clark = makeBusinessUnitRecords("Clark Water", {
    notesByMonth: {
      8: "MTTR improved after spare parts availability.",
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
  return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
}

async function readSlideTexts(zip: JSZip): Promise<string[]> {
  const texts: string[] = [];
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  for (const name of names) {
    const xml = await zip.file(name)!.async("string");
    const matches = xml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) ?? [];
    texts.push(matches.map((match) => match.replace(/<\/?a:t\b[^>]*>/g, "")).join("\n"));
  }
  return texts;
}

describe("All-Business-Units Monthly KPI deck data", () => {
  it("resolves the effective reporting month over the full portfolio (September request -> August)", () => {
    expect(resolveEffectiveReportingMonth(records, 9)).toBe(8);
    expect(resolveEffectiveReportingMonth(records)).toBe(8);
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    expect(data.effectiveReportingMonth).toBe(8);
    expect(data.effectiveReportingMonthLabel).toContain("August");
    // Requesting a submitted earlier month keeps that month.
    expect(buildAllBusinessUnitsDeckData(records, 2026, 3).effectiveReportingMonth).toBe(3);
  });

  it("every active BU gets a section on the ONE common effective reporting period", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const names = data.sections.map((section) => section.businessUnit);
    expect(names).toContain("AMD-EZ");
    expect(names).toContain("Clark Water");
    expect(names).toContain("Tagum Water");
    expect(data.sections.every((section) => section.summary.length === 6)).toBe(true);
    // The whole deck reports August 2026 (portfolio effective month), never a
    // per-BU relabel. Tagum lags the portfolio (last submission June) but its
    // slides still say August 2026; only its chart data stops in June.
    for (const section of data.sections) {
      expect(section.reportingMonth).toBe(data.effectiveReportingMonth);
      expect(section.reportingMonthLabel).toBe("August 2026");
    }
    const tagum = data.sections.find((section) => section.businessUnit === "Tagum Water")!;
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
      const summaryByKey = Object.fromEntries(section.summary.map((row) => [row.key, row.value]));
      expect(summaryByKey.pmCompliance).toBeCloseTo(liveRows.pmCompliance as number, 6);
      expect(summaryByKey.budgetSpend).toBeCloseTo(liveRows.budgetSpend as number, 6);
      expect(summaryByKey.pmCmWorkOrderRatio).toBeCloseTo(liveRows.pmCmWorkOrderRatio as number, 6);
      expect(summaryByKey.mttrDays).toBeCloseTo(liveRows.mttrDays as number, 6);
      expect(summaryByKey.facilityUptime).toBeCloseTo(liveRows.facilityUptime as number, 6);
    }
  });

  it("Group A final trend point equals the summary value; Group B YTD average ends at the summary value", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    for (const section of data.sections) {
      const last = section.trends[section.trends.length - 1];
      const summaryByKey = Object.fromEntries(section.summary.map((row) => [row.key, row.value]));
      expect(last.budgetSpend).toBeCloseTo(summaryByKey.budgetSpend as number, 6);
      expect(last.pmCmWorkOrderRatio).toBeCloseTo(summaryByKey.pmCmWorkOrderRatio as number, 6);
      expect(last.pmCmCostRatio).toBeCloseTo(summaryByKey.pmCmCostRatio as number, 6);
      expect(last.mttrDays).toBeCloseTo(summaryByKey.mttrDays as number, 6);
      expect(last.pmComplianceYtdAverage).toBeCloseTo(summaryByKey.pmCompliance as number, 6);
      expect(last.facilityUptimeYtdAverage).toBeCloseTo(summaryByKey.facilityUptime as number, 6);
    }
  });

  it("charts stop at the effective month and never include future months", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    for (const section of data.sections) {
      const months = section.trends.map((point) => point.month);
      expect(Math.max(...months)).toBeLessThanOrEqual(data.effectiveReportingMonth);
      expect(Math.max(...months)).toBeLessThanOrEqual(8);
      expect(months).not.toContain(9);
      expect(months).not.toContain(12);
    }
  });

  it("commentary uses each BU's own Notes and Situation without leaking or inventing content", () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const amdEz = data.sections.find((section) => section.businessUnit === "AMD-EZ")!;
    const clark = data.sections.find((section) => section.businessUnit === "Clark Water")!;
    // AMD-EZ notes = its August note (effective month), not Clark's.
    expect(amdEz.notes).toContain("Transformer overhaul completed.");
    expect(amdEz.notes).not.toContain("spare parts availability");
    // Clark's own note only.
    expect(clark.notes).toContain("MTTR improved after spare parts availability.");
    expect(clark.notes).not.toContain("Transformer overhaul");
    // Clark omitted PM/CM cost data, so a Situation bullet is produced from its
    // own record - and no fabricated KPI praise is added.
    expect(clark.situationBullets.join(" ").toLowerCase()).toContain("pm:cm cost not submitted");
    const amdBullets = normalizeCommentaryBullets([amdEz.notes, ...amdEz.situationBullets]);
    expect(amdBullets.some((bullet) => bullet.toLowerCase().includes("transformer overhaul"))).toBe(true);
    const invented = ["pm compliance remains strong", "budget needs monitoring", "mttr requires improvement"];
    for (const bullet of [...amdBullets, ...normalizeCommentaryBullets([clark.notes, ...clark.situationBullets])]) {
      expect(invented.some((phrase) => bullet.toLowerCase().includes(phrase))).toBe(false);
    }
  });

  it("earlier-month Notes are not silently reused for the effective month", () => {
    const tagum = buildAllBusinessUnitsDeckData(records, 2026, 9).sections.find(
      (section) => section.businessUnit === "Tagum Water"
    )!;
    // Tagum has a June note but no August note; the deck must not relabel it.
    expect(tagum.notes).toBeNull();
    expect(tagum.situationBullets.join(" ").toLowerCase()).toContain("not submitted");
    const bullets = normalizeCommentaryBullets([tagum.notes, ...tagum.situationBullets]);
    expect(bullets.some((bullet) => bullet.includes("VFD failure investigated."))).toBe(false);
  });
});

describe("Situation bullets are factual (no false not-submitted)", () => {
  function sectionFor(buRecords: PersistedMonthlyKpiRecord[], bu: string) {
    return buildAllBusinessUnitsDeckData(buRecords, 2026, 9).sections.find(
      (section) => section.businessUnit === bu
    )!;
  }
  function allBullets(section: { notes: string | null; situationBullets: string[] }) {
    return normalizeCommentaryBullets([section.notes, ...section.situationBullets]).map((b) => b.toLowerCase());
  }

  it("a fully valid six-KPI record produces zero false 'not submitted' Situation bullets", () => {
    const section = sectionFor(records, "AMD-EZ");
    const bullets = allBullets(section);
    expect(section.situationBullets.length).toBe(0);
    for (const phrase of [
      "pm compliance not submitted",
      "facility uptime not submitted",
      "budget spend not submitted",
      "pm:cm work orders not submitted",
      "pm:cm cost not submitted",
      "mttr not submitted",
    ]) {
      expect(bullets.some((bullet) => bullet.includes(phrase))).toBe(false);
    }
  });

  it("valid PM/CM WO, MTTR, and PM/CM Cost data never produce their own 'not submitted' bullets", () => {
    // AMD-EZ submitted all six KPIs for the effective month.
    const section = sectionFor(records, "AMD-EZ");
    const bullets = allBullets(section);
    expect(bullets.some((b) => b.includes("pm:cm work orders not submitted"))).toBe(false);
    expect(bullets.some((b) => b.includes("mttr not submitted"))).toBe(false);
    expect(bullets.some((b) => b.includes("pm:cm cost not submitted"))).toBe(false);
    expect(bullets.some((b) => b.includes("pm compliance not submitted"))).toBe(false);
  });

  it("truly missing PM:CM Cost data produces exactly the correct neutral missing bullet", () => {
    const section = sectionFor(records, "Clark Water");
    // Clark submitted every KPI except PM:CM cost.
    expect(section.situationBullets.some((b) => b.toLowerCase().includes("pm:cm cost not submitted"))).toBe(true);
    const bullets = allBullets(section);
    expect(bullets.some((b) => b.includes("pm compliance not submitted"))).toBe(false);
    expect(bullets.some((b) => b.includes("facility uptime not submitted"))).toBe(false);
    expect(bullets.some((b) => b.includes("budget spend not submitted"))).toBe(false);
  });

  it("emits neutral reasons only when their exact conditions are met (No Budget / No Work Orders / No Qualifying Downtime / Not Applicable)", () => {
    const full = (overrides: Partial<PersistedMonthlyKpiRecord>, omit?: (key: string) => boolean) => {
      const monthValues = (month: number) => ({
        pmDone: 100 - month, actual: 100 * month + 10, budget: 200,
        pmWo: 40 + month, cmWo: 20 - (month % 3),
        pmCost: 1000 + 50 * month, cmCost: 500 - 10 * month,
        downtime: 60 * month + 5, repairs: month + 2, facilityDowntime: month,
      });
      const out: PersistedMonthlyKpiRecord[] = [];
      for (let m = 1; m <= 8; m += 1) {
        const v = monthValues(m);
        const rec: Record<string, unknown> = {
          ...base, business_unit: "Special BU", reporting_year: 2026, reporting_month: m,
          pm_orders_completed_on_time: 100 - m, total_pm_orders: 100,
          actual_spend: v.actual, budget: v.budget,
          pm_work_orders: v.pmWo, cm_work_orders: v.cmWo,
          pm_cost: v.pmCost, cm_cost: v.cmCost,
          mttr_downtime: v.downtime, repair_count: v.repairs,
          facility_operating_time: 1000, facility_downtime: v.facilityDowntime,
          notes: null, raw_imported_values: { values: {} },
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

    const noBudget = sectionFor(full({ budget: 0, actual_spend: null }), "Special BU");
    expect(noBudget.situationBullets).toContain("No Budget");
    expect(noBudget.situationBullets.some((b) => b.toLowerCase().includes("budget spend not submitted"))).toBe(false);

    const noWorkOrders = sectionFor(full({ pm_work_orders: 0, cm_work_orders: 0 }), "Special BU");
    expect(noWorkOrders.situationBullets).toContain("No Work Orders");
    expect(noWorkOrders.situationBullets.some((b) => b.toLowerCase().includes("pm:cm work orders not submitted"))).toBe(false);

    const noDowntime = sectionFor(full({ repair_count: 0, mttr_downtime: null, mttr_days: null }), "Special BU");
    expect(noDowntime.situationBullets).toContain("No Qualifying Downtime");
    expect(noDowntime.situationBullets.some((b) => b.toLowerCase().includes("mttr not submitted"))).toBe(false);

    const noOrders = sectionFor(full({ pm_orders_completed_on_time: null, total_pm_orders: 0 }), "Special BU");
    expect(noOrders.situationBullets).toContain("Not Applicable (no PM orders)");
    expect(noOrders.situationBullets.some((b) => b.toLowerCase().includes("pm compliance not submitted"))).toBe(false);
  });
});

describe("All-Business-Units Monthly KPI deck structure", () => {
  it("produces one cover slide plus two slides per BU, ordered Summary then Trends per BU", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slideCount = slideCountFromZip(zip);
    expect(slideCount).toBe(1 + 2 * data.sections.length);
    expect(slideCount).toBe(7);

    const slideTexts = await readSlideTexts(zip);
    expect(slideTexts[0]).toContain("All Business Units");
    const expectedOrder: string[] = [];
    for (const section of data.sections) {
      expectedOrder.push(`${section.businessUnit} — Monthly KPI Scorecard`, "KPI Summary");
      expectedOrder.push(`${section.businessUnit} — Monthly KPI Scorecard`, "KPI Trends");
    }
    // Slide texts include each BU summary then its trends before the next BU.
    for (let index = 0; index < data.sections.length; index += 1) {
      const section = data.sections[index];
      const summarySlide = slideTexts[1 + index * 2];
      const trendsSlide = slideTexts[2 + index * 2];
      expect(summarySlide).toContain(section.businessUnit);
      expect(summarySlide).toContain("KPI Summary");
      expect(summarySlide).not.toContain("KPI Trends");
      expect(trendsSlide).toContain(section.businessUnit);
      expect(trendsSlide).toContain("KPI Trends");
      expect(trendsSlide).not.toContain("KPI Summary");
    }
    void expectedOrder;
  });

  it("summary slides carry the BU's Notes/Situation commentary text", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slideTexts = await readSlideTexts(zip);
    const amdEzIndex = data.sections.findIndex((section) => section.businessUnit === "AMD-EZ");
    expect(slideTexts[1 + amdEzIndex * 2]).toContain("Transformer overhaul completed.");
    const clarkIndex = data.sections.findIndex((section) => section.businessUnit === "Clark Water");
    expect(slideTexts[1 + clarkIndex * 2]).toContain("MTTR improved after spare parts availability.");
    // No cross-BU commentary leakage on either summary slide.
    expect(slideTexts[1 + amdEzIndex * 2]).not.toContain("spare parts availability");
    expect(slideTexts[1 + clarkIndex * 2]).not.toContain("Transformer overhaul");
  });

  it("cover, every BU Summary slide, and every BU Trends slide report the one common effective month", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    expect(data.effectiveReportingMonthLabel).toBe("August 2026");
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slideTexts = await readSlideTexts(zip);
    expect(slideTexts[0]).toContain("August 2026"); // cover
    for (let index = 0; index < data.sections.length; index += 1) {
      expect(slideTexts[1 + index * 2]).toContain("August 2026"); // Summary header
      expect(slideTexts[2 + index * 2]).toContain("August 2026"); // Trends header
      // No lagging BU is relabeled to its own last submitted month.
      expect(slideTexts[1 + index * 2]).not.toContain("May 2026");
      expect(slideTexts[1 + index * 2]).not.toContain("June 2026");
      expect(slideTexts[2 + index * 2]).not.toContain("May 2026");
    }
    // Tagum (last submission June) never fabricates Jul/Aug chart categories.
    const tagumIndex = data.sections.findIndex((section) => section.businessUnit === "Tagum Water");
    expect(data.sections[tagumIndex].trends.map((point) => point.month)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("every trends slide embeds six charts and every chart title appears", async () => {
    const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
    const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const chartFileCount = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name)).length;
    expect(chartFileCount).toBe(6 * data.sections.length);
    const slideTexts = await readSlideTexts(zip);
    const chartTitles = [
      "PM Compliance (%)",
      "Budget Spend (%)",
      "PM:CM — Work Orders (%)",
      "PM:CM — Cost (%)",
      "MTTR (Days)",
      "Facility Uptime (%)",
    ];
    for (let index = 0; index < data.sections.length; index += 1) {
      const trendsText = slideTexts[2 + index * 2];
      for (const title of chartTitles) {
        expect(trendsText, `${data.sections[index].businessUnit} should chart ${title}`).toContain(title);
      }
    }
  });
});
