import { describe, expect, it } from "vitest";
import { formatMttrDaysDisplay } from "./mttrDisplay";
import {
  aggregateMonthlyKpiRecords,
  computeMonthlyKpiValuesFromRaw,
  type PersistedMonthlyKpiRecord,
} from "./kpiAggregation";

/**
 * MTTR display precision — monthly KPI scorecard.
 *
 * Max two decimals; no redundant trailing zeros; whole numbers stay whole, so
 * a calculated MTTR of 0.666666... days reads "0.67" and is NEVER rounded up
 * to the whole number "1".
 */
describe("formatMttrDaysDisplay — MTTR display rule", () => {
  it("renders the required display examples exactly", () => {
    expect(formatMttrDaysDisplay(0)).toBe("0");
    expect(formatMttrDaysDisplay(1)).toBe("1");
    expect(formatMttrDaysDisplay(2)).toBe("2");
    expect(formatMttrDaysDisplay(1.2)).toBe("1.2");
    expect(formatMttrDaysDisplay(0.5)).toBe("0.5");
    expect(formatMttrDaysDisplay(1.25)).toBe("1.25");
    expect(formatMttrDaysDisplay(0.6666666666666666)).toBe("0.67");
    expect(formatMttrDaysDisplay(1.2366666666666666)).toBe("1.24");
    expect(formatMttrDaysDisplay(2.5)).toBe("2.5");
    expect(formatMttrDaysDisplay(2)).toBe("2");
  });

  it("never displays trailing zeros", () => {
    // 2.50 -> "2.5" and 2.00 -> "2" (not "2.50" / "2.00").
    expect(formatMttrDaysDisplay(2.5)).not.toBe("2.50");
    expect(formatMttrDaysDisplay(2)).not.toBe("2.00");
    expect(formatMttrDaysDisplay(1)).not.toBe("1.00");
    expect(formatMttrDaysDisplay(0)).not.toBe("0.0");
    expect(formatMttrDaysDisplay(1.1)).toBe("1.1");
    expect(formatMttrDaysDisplay(1.1)).not.toBe("1.10");
  });

  it("keeps whole numbers whole", () => {
    for (const value of [0, 1, 2, 27, 63, 100, 365]) {
      const display = formatMttrDaysDisplay(value);
      expect(display).toBe(String(value));
      expect(display).not.toContain(".");
    }
  });

  it("rounds sub-day MTTR to two decimals instead of to a whole day", () => {
    // The defect: an actual MTTR of 0.67 days must not display as "1".
    expect(formatMttrDaysDisplay(0.6666666666666666)).toBe("0.67");
    expect(formatMttrDaysDisplay(0.6666666666666666)).not.toBe("1");
    expect(formatMttrDaysDisplay(0.4)).toBe("0.4");
    expect(formatMttrDaysDisplay(0.4)).not.toBe("0");
    expect(formatMttrDaysDisplay(0.04)).toBe("0.04");
    expect(formatMttrDaysDisplay(0.04)).not.toBe("0");
    expect(formatMttrDaysDisplay(1.5)).toBe("1.5");
    expect(formatMttrDaysDisplay(1.5)).not.toBe("2");
  });

  it("rounds (does not truncate) at the second decimal", () => {
    expect(formatMttrDaysDisplay(1.235)).toBe("1.24");
    expect(formatMttrDaysDisplay(1.234)).toBe("1.23");
    expect(formatMttrDaysDisplay(9.999)).toBe("10");
    expect(formatMttrDaysDisplay(0.005)).toBe("0.01");
  });

  it("stays within two decimals and never overstates by more than half a cent for any input", () => {
    const samples = [
      0, 0.001, 0.0049, 0.21, 0.67, 0.999, 1.01, 1.005, 1.25, 2.5, 8.505,
      12.345, 29.25, 42.255, 63.64, 99.995,
    ];
    for (const value of samples) {
      const display = formatMttrDaysDisplay(value);
      // No exponential notation and never more than two decimals.
      expect(display).not.toMatch(/e/i);
      const decimals = display.includes(".") ? display.split(".")[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
      // The displayed value stays within the two-decimal rounding envelope.
      expect(Math.abs(Number(display) - value)).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  it("returns an empty display for non-finite input", () => {
    expect(formatMttrDaysDisplay(Number.NaN)).toBe("");
    expect(formatMttrDaysDisplay(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatMttrDaysDisplay(Number.NEGATIVE_INFINITY)).toBe("");
  });
});

/**
 * Guard: this change is display-only. The MTTR calculation (monthly downtime /
 * repairs and the cumulative YTD downtime / repairs aggregate) must keep
 * returning the untouched authoritative value, and must NOT be rounded.
 */
describe("MTTR calculation is unchanged by the display fix", () => {
  const baseRecord = {
    pm_compliance: null,
    budget_spend: null,
    pm_cm_work_order_ratio: null,
    pm_cm_cost_ratio: null,
    mttr_days: null,
    facility_uptime: null,
  } as const;

  it("keeps the monthly MTTR unrounded (2 / 3 stays 0.6666666666666666)", () => {
    const monthly = computeMonthlyKpiValuesFromRaw({
      ...baseRecord,
      business_unit: "AMD-EZ",
      reporting_year: 2026,
      reporting_month: 1,
      mttr_downtime: 2,
      repair_count: 3,
    } as unknown as PersistedMonthlyKpiRecord);

    expect(monthly.mttrDays).toBe(2 / 3);
    expect(monthly.mttrDays).not.toBe(1);
    // Only the presentation string is rounded to two decimals.
    expect(formatMttrDaysDisplay(monthly.mttrDays as number)).toBe("0.67");
  });

  it("keeps the YTD cumulative MTTR unrounded (cumulative downtime / cumulative repairs)", () => {
    const records = [
      { ...baseRecord, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_downtime: 10, repair_count: 2 },
      { ...baseRecord, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_downtime: 12, repair_count: 3 },
    ] as unknown as PersistedMonthlyKpiRecord[];

    const result = aggregateMonthlyKpiRecords(records, 2026, 2);
    const ytd = result.byBusinessUnitMap["AMD-EZ"].mttrDays;

    // 22 / 5 = 4.4 days, unchanged by the display rule.
    expect(ytd).toBe(22 / 5);
    expect(formatMttrDaysDisplay(ytd as number)).toBe("4.4");
  });

  it("keeps a sub-day YTD MTTR unrounded while displaying two decimals", () => {
    const records = [
      { ...baseRecord, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_downtime: 1, repair_count: 2 },
      { ...baseRecord, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_downtime: 1, repair_count: 1 },
    ] as unknown as PersistedMonthlyKpiRecord[];

    const result = aggregateMonthlyKpiRecords(records, 2026, 2);
    const ytd = result.byBusinessUnitMap["AMD-EZ"].mttrDays;

    // Cumulative downtime 2 / cumulative repairs 3 = 0.6666666666666666.
    expect(ytd).toBe(2 / 3);
    expect(ytd).not.toBe(1);
    expect(formatMttrDaysDisplay(ytd as number)).toBe("0.67");
  });
});
