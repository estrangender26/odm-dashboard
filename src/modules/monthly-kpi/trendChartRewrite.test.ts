import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import { rewriteTrendChartCache, TRENDS_PANELS } from "./allBusinessUnitsDeck";
import type { BusinessUnitTrendPoint } from "./allBusinessUnitsData";

const TEMPLATE = "src/modules/executive-presentations/templates/MonthlyKpiAllBuExecutive.pptx";

let cached: Record<number, string> | null = null;
async function donorChart(panelId: number): Promise<string> {
  if (!cached) {
    const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
    cached = {};
    for (let id = 1; id <= 6; id++) {
      cached[id] = await zip.file(`ppt/charts/chart${id}.xml`)!.async("string");
    }
  }
  return cached![panelId];
}

function point(month: number, overrides: Partial<BusinessUnitTrendPoint> = {}): BusinessUnitTrendPoint {
  return {
    month,
    monthLabel: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][month - 1] ?? String(month),
    budgetSpend: null,
    pmCmWorkOrderRatio: null,
    pmCmCostRatio: null,
    mttrDays: null,
    budgetSpendMonthly: null,
    pmCmWorkOrderRatioMonthly: null,
    pmCmCostRatioMonthly: null,
    mttrDaysMonthly: null,
    pmComplianceMonthly: null,
    facilityUptimeMonthly: null,
    pmComplianceYtdAverage: null,
    facilityUptimeYtdAverage: null,
    ...overrides,
  };
}

function readCache(chartXml: string, seriesIndex: number): { cats: string[]; vals: Array<number | null> } {
  const sers = [...chartXml.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((m) => m[0]);
  const ser = sers[seriesIndex];
  if (!ser) return { cats: [], vals: [] };
  const catCache = ser.match(/<c:multiLvlStrCache>[\s\S]*?<\/c:multiLvlStrCache>/)?.[0] ?? "";
  const cats = [...catCache.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => m[1]);
  const numCache = ser.match(/<c:numCache>[\s\S]*?<\/c:numCache>/)?.[0] ?? "";
  const pts = [...numCache.matchAll(/<c:pt idx="(\d+)"><c:v>([^<]*)<\/c:v><\/c:pt>/g)].map((m) => ({ idx: Number(m[1]), v: Number(m[2]) }));
  const maxIdx = pts.length ? Math.max(...pts.map((p) => p.idx)) : -1;
  const vals: Array<number | null> = Array.from({ length: maxIdx + 1 }, () => null);
  for (const p of pts) vals[p.idx] = p.v;
  return { cats, vals };
}

function sectionFrom(trends: BusinessUnitTrendPoint[]) {
  return {
    businessUnit: "TEST",
    summary: [],
    trends,
    notes: null,
    situation: null,
    reportingMonth: 8,
    reportingMonthLabel: "August 2026",
  } as never as import("./allBusinessUnitsData").BusinessUnitDeckSection;
}

describe("Trend chart calendar alignment + Monthly Actual / YTD separation", () => {
  it("EWG sparse data stays at Apr-Aug positions, never compacted to Jan-May", async () => {
    const budgetDonor = await donorChart(2);
    const section = sectionFrom([
      point(1),
      point(2),
      point(3),
      point(4, { budgetSpend: 50.0072, budgetSpendMonthly: 50.01 }),
      point(5, { budgetSpend: 50.0072, budgetSpendMonthly: null }),
      point(6, { budgetSpend: 169.5036, budgetSpendMonthly: 169.5 }),
      point(7, { budgetSpend: 99.75293767714402, budgetSpendMonthly: 99.75 }),
      point(8, { budgetSpend: 85.19961259863214, budgetSpendMonthly: 85.2 }),
    ]);
    const out = rewriteTrendChartCache(budgetDonor, TRENDS_PANELS[1], section);
    expect(out).toContain("Monthly Actual");
    const monthly = readCache(out, 0);
    const ytd = readCache(out, 1);
    expect(monthly.cats).toEqual(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug"]);
    // Nothing in Jan-Mar; Apr at index 3 ... Aug at index 7.
    expect(monthly.vals.slice(0, 3).every((v) => v === null)).toBe(true);
    expect(monthly.vals[3]).toBeCloseTo(50.01, 1);
    expect(monthly.vals[7]).toBeCloseTo(85.2, 1);
    expect(ytd.vals[7]).toBeCloseTo(85.2, 1);
  });

  it("LARC August YTD value appears at August (position 7), not truncated earlier", async () => {
    const donor = await donorChart(2);
    const section = sectionFrom([
      point(1, { budgetSpend: null }),
      point(2, { budgetSpend: 49.74 }),
      point(3, { budgetSpend: 33.97 }),
      point(4, { budgetSpend: 53.37 }),
      point(5, { budgetSpend: 34.05 }),
      point(6, { budgetSpend: 26.68 }),
      point(7, { budgetSpend: 26.68 }),
      point(8, { budgetSpend: 22.47522765598651, budgetSpendMonthly: 55 }),
    ]);
    const out = rewriteTrendChartCache(donor, TRENDS_PANELS[1], section);
    const ytd = readCache(out, 1);
    expect(ytd.vals[7]).toBeCloseTo(22.48, 2);
  });

  it("TWCI effective August MTTR appears at August where authoritative data exists", async () => {
    const donor = await donorChart(5);
    const section = sectionFrom([
      point(1, { mttrDays: null }),
      point(2, { mttrDays: 56, mttrDaysMonthly: 56 }),
      point(3, { mttrDays: 44.88, mttrDaysMonthly: 44.9 }),
      point(4, { mttrDays: 41.5, mttrDaysMonthly: 41.5 }),
      point(5, { mttrDays: 37.5, mttrDaysMonthly: 37.5 }),
      point(6, { mttrDays: 42.28, mttrDaysMonthly: 42.3 }),
      point(7, { mttrDays: 42.28, mttrDaysMonthly: null }),
      point(8, { mttrDays: 42.25, mttrDaysMonthly: 41 }),
    ]);
    const out = rewriteTrendChartCache(donor, TRENDS_PANELS[4], section);
    expect(out).toContain("Monthly Actual");
    const monthly = readCache(out, 0);
    const ytd = readCache(out, 1);
    expect(monthly.cats).toHaveLength(8);
    expect(monthly.vals[7]).toBeCloseTo(41, 1);
    expect(ytd.vals[7]).toBeCloseTo(42.25, 2);
  });

  it("Monthly Actual and YTD are separate series for Budget, PM:CM WO, PM:CM Cost and MTTR", async () => {
    const trends = [
      point(1, { budgetSpend: 100, budgetSpendMonthly: 100, pmCmWorkOrderRatio: 90, pmCmWorkOrderRatioMonthly: 90, pmCmCostRatio: 80, pmCmCostRatioMonthly: 80, mttrDays: 5, mttrDaysMonthly: 5 }),
      point(2, { budgetSpend: 90, budgetSpendMonthly: 80, pmCmWorkOrderRatio: 88, pmCmWorkOrderRatioMonthly: 60, pmCmCostRatio: 78, pmCmCostRatioMonthly: 50, mttrDays: 6, mttrDaysMonthly: 12 }),
    ];
    const panels = [TRENDS_PANELS[1], TRENDS_PANELS[2], TRENDS_PANELS[3], TRENDS_PANELS[4]];
    for (const panel of panels) {
      const out = rewriteTrendChartCache(await donorChart(panel.id), panel, sectionFrom(trends));
      const monthly = readCache(out, 0);
      const ytd = readCache(out, 1);
      const differ = monthly.vals.findIndex((v, i) => v !== null && ytd.vals[i] !== null && Math.abs(v - ytd.vals[i]!) > 0.01);
      expect(differ, `panel ${panel.id} monthly != ytd`).toBeGreaterThanOrEqual(0);
    }
  });

  it("channels never plot future months (categories end at the effective month)", async () => {
    const donor = await donorChart(2);
    const out = rewriteTrendChartCache(donor, TRENDS_PANELS[1], sectionFrom([point(1), point(2)]));
    const cats = readCache(out, 0).cats;
    expect(cats).toEqual(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug"]);
  });
});
