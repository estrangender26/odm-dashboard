import { describe, expect, it } from "vitest";
import { formatMttrDays } from "./mttrDisplay";
import { formatScorecardCell } from "./allBusinessUnitsDeck";
import { formatExecutiveKpiValue } from "./executiveReadout";
import {
  aggregateMonthlyKpiRecords,
  computeMonthlyKpiValuesFromRaw,
  type PersistedMonthlyKpiRecord,
} from "./kpiAggregation";

/**
 * End-to-end guard for the MTTR display fix:
 *
 *  1. the AUTHORITATIVE MTTR calculation is unchanged (still the full-precision
 *     weighted value, here 2/3 = 0.6666666666666666);
 *  2. every scorecard presentation path renders that value with at most two
 *     decimals instead of rounding it to a whole "1";
 *  3. the scorecard formatter used for the MONTHLY rows and the YTD row is one
 *     and the same function, so those two values cannot diverge;
 *  4. every unrelated KPI keeps its existing formatting.
 */

function record(overrides: Partial<PersistedMonthlyKpiRecord>): PersistedMonthlyKpiRecord {
  return {
    business_unit: "CWC",
    reporting_month: 1,
    reporting_year: 2026,
    pm_compliance: null,
    budget_spend: null,
    pm_cm_work_order_ratio: null,
    pm_cm_cost_ratio: null,
    mttr_days: null,
    facility_uptime: null,
    ...overrides,
  };
}

// Monthly MTTR = downtime / repairs -> 2 / 3 = 0.6666666666666666
const MONTH_1 = record({ reporting_month: 1, mttr_downtime: 2, repair_count: 3 });
// Month 2 -> 4 / 3 = 1.3333333333333333
const MONTH_2 = record({ reporting_month: 2, mttr_downtime: 4, repair_count: 3 });

const MTTR_RAW = 2 / 3; // 0.6666666666666666

describe("MTTR calculation is unchanged (display-only fix)", () => {
  it("keeps the full-precision monthly MTTR (never pre-rounded)", () => {
    const monthly = computeMonthlyKpiValuesFromRaw(MONTH_1);
    expect(monthly.mttrDays).toBe(MTTR_RAW);
    expect(monthly.mttrDays).toBeCloseTo(0.6666666666666666, 15);
    expect(monthly.mttrDays).not.toBe(1);
  });

  it("keeps the full-precision YTD cumulative MTTR (SUM downtime / SUM repairs)", () => {
    const result = aggregateMonthlyKpiRecords([MONTH_1, MONTH_2], 2026, 2);
    const bu = result.byBusinessUnitMap.CWC;
    // YTD = (2 + 4) / (3 + 3) = 1
    expect(bu.mttrDays).toBe(1);
    // Month 2 alone is still the unrounded 4 / 3.
    expect(computeMonthlyKpiValuesFromRaw(MONTH_2).mttrDays).toBe(4 / 3);

    // A partial-year YTD stays a genuine fraction: only month 1 -> 2 / 3.
    const monthOneOnly = aggregateMonthlyKpiRecords([MONTH_1, MONTH_2], 2026, 1);
    expect(monthOneOnly.byBusinessUnitMap.CWC.mttrDays).toBe(MTTR_RAW);
    expect(monthOneOnly.byBusinessUnitMap.CWC.mttrDays).not.toBe(1);
  });

  it("keeps the portfolio (All-BU) MTTR weighted, not display-rounded", () => {
    const result = aggregateMonthlyKpiRecords([MONTH_1], 2026, 1);
    expect(result.portfolioYearAverage.mttrDays).toBe(MTTR_RAW);
    expect(result.portfolioYearAverage.mttrDays).not.toBe(1);
  });
});

describe("scorecard presentation renders MTTR with at most two decimals", () => {
  it("formats a sub-day MTTR as 0.67, never as a whole 1", () => {
    expect(formatScorecardCell("mttrDays", MTTR_RAW)).toBe("0.67");
    expect(formatScorecardCell("mttrDays", MTTR_RAW)).not.toBe("1");
    expect(formatScorecardCell("mttrDays", 0.67)).toBe("0.67");
    expect(formatScorecardCell("mttrDays", 1.2366666666666666)).toBe("1.24");
  });

  it("keeps whole MTTR values whole and trims needless trailing zeros", () => {
    expect(formatScorecardCell("mttrDays", 0)).toBe("0");
    expect(formatScorecardCell("mttrDays", 1)).toBe("1");
    expect(formatScorecardCell("mttrDays", 2)).toBe("2");
    expect(formatScorecardCell("mttrDays", 1.2)).toBe("1.2");
    expect(formatScorecardCell("mttrDays", 0.5)).toBe("0.5");
    expect(formatScorecardCell("mttrDays", 1.25)).toBe("1.25");
    expect(formatScorecardCell("mttrDays", 2.5)).toBe("2.5");
  });

  it("uses ONE formatter for both the monthly cells and the YTD cell", () => {
    // The deck writes monthly rows and the YTD row through the same
    // formatScorecardCell() call, so applying it to the same authoritative
    // number twice must produce identical text (no monthly/YTD divergence).
    for (const value of [MTTR_RAW, 1, 2.5, 1.25, 0]) {
      expect(formatScorecardCell("mttrDays", value)).toBe(formatMttrDays(value));
    }
  });

  it("renders the executive readout MTTR line with the same rule", () => {
    expect(formatExecutiveKpiValue("mttrDays", MTTR_RAW)).toBe("0.67 days");
    expect(formatExecutiveKpiValue("mttrDays", MTTR_RAW)).not.toBe("1 days");
    expect(formatExecutiveKpiValue("mttrDays", 0)).toBe("0 days");
    expect(formatExecutiveKpiValue("mttrDays", 1)).toBe("1 days");
    expect(formatExecutiveKpiValue("mttrDays", 2.5)).toBe("2.5 days");
    expect(formatExecutiveKpiValue("mttrDays", 1.2366666666666666)).toBe("1.24 days");
    expect(formatExecutiveKpiValue("mttrDays", null)).toBe("no data");
  });

  it("preserves empty / no-data handling in the scorecard cell", () => {
    expect(formatScorecardCell("mttrDays", null)).toBe("");
    expect(formatScorecardCell("mttrDays", undefined)).toBe("");
    expect(formatScorecardCell("mttrDays", Number.NaN)).toBe("");
  });
});

describe("unrelated KPI formatting is untouched", () => {
  it("keeps PM Compliance, Budget Spend, PM:CM ratios and Facility Uptime as-is", () => {
    expect(formatScorecardCell("pmCompliance", 95.1234)).toBe("95.12%");
    expect(formatScorecardCell("budgetSpend", 88.8888)).toBe("89%");
    expect(formatScorecardCell("pmCmWorkOrderRatio", 75)).toBe("75% (3.0:1)");
    expect(formatScorecardCell("pmCmCostRatio", 50)).toBe("50% (1.0:1)");
    expect(formatScorecardCell("facilityUptime", 99.99621384219294)).toBe("99.99%");
    expect(formatScorecardCell("facilityUptime", 100)).toBe("100%");
    // Non-MTTR KPIs keep the untouched percent formatter.
    expect(formatExecutiveKpiValue("pmCompliance", 62.3059)).toBe("62.31%");
    expect(formatExecutiveKpiValue("budgetSpend", 65.6151)).toBe("65.62%");
    expect(formatExecutiveKpiValue("facilityUptime", 99.99621384219294)).toBe("99.99%");
  });
});
