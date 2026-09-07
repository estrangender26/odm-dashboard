import { describe, expect, it } from "vitest";
import { aggregateMonthlyKpiRecords } from "../src/modules/monthly-kpi/kpiAggregation";

/**
 * Monthly KPI Scorecard — YTD scorecard rules.
 *
 * The selected month is the reporting cutoff. On the scorecard (Summary Matrix
 * rows, the "All Business Units" row, and the Portfolio Average KPI Cards):
 *  - Budget Spend, PM:CM Work Orders, PM:CM Cost, and MTTR are YTD cumulative
 *    values computed from the underlying January-through-selected-month inputs
 *    (never an average of the already-calculated monthly KPIs);
 *  - PM Compliance and Facility Uptime remain the selected month's standalone
 *    value only.
 */
const base = {
  pm_compliance: null,
  budget_spend: null,
  pm_cm_work_order_ratio: null,
  pm_cm_cost_ratio: null,
  mttr_days: null,
  facility_uptime: null,
};

type MonthValues = {
  pmDone: number;
  pmTotal: number;
  actualSpend: number;
  budget: number;
  pmWo: number;
  cmWo: number;
  pmCost: number;
  cmCost: number;
  downtime: number;
  repairs: number;
  operating: number;
  facilityDowntime: number;
};

/**
 * Deterministic 12-month dataset for a business unit. Every month differs so a
 * monthly KPI can never be confused with a YTD/cumulative figure and vice
 * versa:
 *  - PM Compliance  = (100 - m)%          -> January 99%, December 88%
 *  - Facility Uptime = 100 - m/10         -> January 99.9%, December 98.8%
 *  - monthly Budget Spend % = 200m/(2m+1) -> non-linear so an average of the
 *    monthly percentages differs from the cumulative ratio
 *  - MTTR monthly = (60m + 5)/(m + 2)     -> non-linear
 */
function makeMonthValues(month: number): MonthValues {
  return {
    pmDone: 100 - month,
    pmTotal: 100,
    actualSpend: 200 * month,
    budget: 2 * month + 1,
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

function makeYearRecords(businessUnit: string) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const v = makeMonthValues(month);
    return {
      ...base,
      business_unit: businessUnit,
      reporting_year: 2026,
      reporting_month: month,
      pm_orders_completed_on_time: v.pmDone,
      total_pm_orders: v.pmTotal,
      actual_spend: v.actualSpend,
      budget: v.budget,
      pm_work_orders: v.pmWo,
      cm_work_orders: v.cmWo,
      pm_cost: v.pmCost,
      cm_cost: v.cmCost,
      mttr_downtime: v.downtime,
      repair_count: v.repairs,
      facility_operating_time: v.operating,
      facility_downtime: v.facilityDowntime,
    };
  });
}

function sum(records: Array<Record<string, unknown>>, field: string) {
  return records.reduce(
    (total, record) => total + (typeof record[field] === "number" ? (record[field] as number) : 0),
    0
  );
}

function sliceRecords(records: Array<Record<string, unknown>>, throughMonth: number) {
  return records.filter((record) => Number(record.reporting_month) <= throughMonth);
}

function expectedYtd(records: Array<Record<string, unknown>>, throughMonth: number) {
  const period = sliceRecords(records, throughMonth);
  const pm = sum(period, "pm_work_orders");
  const cm = sum(period, "cm_work_orders");
  const pmCost = sum(period, "pm_cost");
  const cmCost = sum(period, "cm_cost");
  const downtime = sum(period, "mttr_downtime");
  const repairs = sum(period, "repair_count");
  return {
    budgetSpend: (sum(period, "actual_spend") / sum(period, "budget")) * 100,
    pmCmWorkOrderRatio: (pm / (pm + cm)) * 100,
    pmCmCostRatio: (pmCost / (pmCost + cmCost)) * 100,
    mttrDays: downtime / repairs,
  };
}

function expectedMonthlyKpi(records: Array<Record<string, unknown>>, month: number) {
  const record = records.find((r) => Number(r.reporting_month) === month)!;
  return {
    pmCompliance: (Number(record.pm_orders_completed_on_time) / Number(record.total_pm_orders)) * 100,
    facilityUptime: ((Number(record.facility_operating_time) - Number(record.facility_downtime)) / Number(record.facility_operating_time)) * 100,
  };
}

const AMD_EZ = makeYearRecords("AMD-EZ");

function buildAggregateForMonths(records: typeof AMD_EZ, months: number[]) {
  return months.map((month) => aggregateMonthlyKpiRecords(records, 2026, month));
}

describe("Monthly KPI Scorecard YTD rules", () => {
  it("January selected: YTD KPIs equal January values and monthly KPIs equal January values", () => {
    const result = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 1);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    const ytd = expectedYtd(AMD_EZ, 1);
    const monthly = expectedMonthlyKpi(AMD_EZ, 1);

    expect(bu.budgetSpend).toBeCloseTo(ytd.budgetSpend, 6);
    expect(bu.pmCmWorkOrderRatio).toBeCloseTo(ytd.pmCmWorkOrderRatio, 6);
    expect(bu.pmCmCostRatio).toBeCloseTo(ytd.pmCmCostRatio, 6);
    expect(bu.mttrDays).toBeCloseTo(ytd.mttrDays, 6);
    expect(bu.pmCompliance).toBeCloseTo(monthly.pmCompliance, 6);
    expect(bu.facilityUptime).toBeCloseTo(monthly.facilityUptime, 6);
  });

  it("March selected: the four YTD KPIs are cumulative January-March", () => {
    const result = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 3);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    const ytd = expectedYtd(AMD_EZ, 3);
    const monthly = expectedMonthlyKpi(AMD_EZ, 3);

    expect(bu.budgetSpend).toBeCloseTo(ytd.budgetSpend, 6);
    expect(bu.pmCmWorkOrderRatio).toBeCloseTo(ytd.pmCmWorkOrderRatio, 6);
    expect(bu.pmCmCostRatio).toBeCloseTo(ytd.pmCmCostRatio, 6);
    expect(bu.mttrDays).toBeCloseTo(ytd.mttrDays, 6);
    // PM Compliance and Facility Uptime remain March-only, never Jan-Mar
    // averages/cumulative values.
    expect(bu.pmCompliance).toBeCloseTo(monthly.pmCompliance, 6);
    expect(bu.facilityUptime).toBeCloseTo(monthly.facilityUptime, 6);
  });

  it("September selected: cumulative January-September for the four YTD KPIs", () => {
    const result = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 9);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    const ytd = expectedYtd(AMD_EZ, 9);
    const monthly = expectedMonthlyKpi(AMD_EZ, 9);

    expect(bu.budgetSpend).toBeCloseTo(ytd.budgetSpend, 6);
    expect(bu.pmCmWorkOrderRatio).toBeCloseTo(ytd.pmCmWorkOrderRatio, 6);
    expect(bu.pmCmCostRatio).toBeCloseTo(ytd.pmCmCostRatio, 6);
    expect(bu.mttrDays).toBeCloseTo(ytd.mttrDays, 6);
    expect(bu.pmCompliance).toBeCloseTo(monthly.pmCompliance, 6);
    expect(bu.facilityUptime).toBeCloseTo(monthly.facilityUptime, 6);
  });

  it("December selected: full-year cumulative for the four YTD KPIs", () => {
    const result = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 12);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    const ytd = expectedYtd(AMD_EZ, 12);

    expect(bu.budgetSpend).toBeCloseTo(ytd.budgetSpend, 6);
    expect(bu.pmCmWorkOrderRatio).toBeCloseTo(ytd.pmCmWorkOrderRatio, 6);
    expect(bu.pmCmCostRatio).toBeCloseTo(ytd.pmCmCostRatio, 6);
    expect(bu.mttrDays).toBeCloseTo(ytd.mttrDays, 6);
    // December-only monthly KPIs.
    expect(bu.pmCompliance).toBeCloseTo(expectedMonthlyKpi(AMD_EZ, 12).pmCompliance, 6);
    expect(bu.facilityUptime).toBeCloseTo(expectedMonthlyKpi(AMD_EZ, 12).facilityUptime, 6);
    expect(bu.mttrDays).not.toBeCloseTo(expectedYtd(AMD_EZ, 11).mttrDays, 6);
  });

  it("Budget Spend YTD is cumulative spend over budget, not an average of monthly percentages", () => {
    const result = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 3);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    const monthlyPercentages = [1, 2, 3].map((month) => {
      const v = makeMonthValues(month);
      return (v.actualSpend / v.budget) * 100;
    });
    const averageOfMonthlyPercentages = monthlyPercentages.reduce((a, b) => a + b, 0) / monthlyPercentages.length;
    expect(bu.budgetSpend).toBeCloseTo(expectedYtd(AMD_EZ, 3).budgetSpend, 6);
    expect(bu.budgetSpend).not.toBeCloseTo(averageOfMonthlyPercentages, 6);
  });

  it("PM:CM Work Orders YTD is built from cumulative underlying PM/CM counts", () => {
    const result = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 6);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    const pm = [1, 2, 3, 4, 5, 6].reduce((sum, month) => sum + makeMonthValues(month).pmWo, 0);
    const cm = [1, 2, 3, 4, 5, 6].reduce((sum, month) => sum + makeMonthValues(month).cmWo, 0);
    expect(bu.pmCmWorkOrderRatio).toBeCloseTo((pm / (pm + cm)) * 100, 6);
    // Not the average of the monthly PM:CM percentages.
    const monthlyAverages =
      [1, 2, 3, 4, 5, 6].map((month) => {
        const v = makeMonthValues(month);
        return (v.pmWo / (v.pmWo + v.cmWo)) * 100;
      }).reduce((a, b) => a + b, 0) / 6;
    expect(bu.pmCmWorkOrderRatio).not.toBeCloseTo(monthlyAverages, 6);
  });

  it("PM:CM Cost YTD is built from cumulative underlying PM/CM costs", () => {
    const result = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 6);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    const pmCost = [1, 2, 3, 4, 5, 6].reduce((sum, month) => sum + makeMonthValues(month).pmCost, 0);
    const cmCost = [1, 2, 3, 4, 5, 6].reduce((sum, month) => sum + makeMonthValues(month).cmCost, 0);
    expect(bu.pmCmCostRatio).toBeCloseTo((pmCost / (pmCost + cmCost)) * 100, 6);
    const monthlyAverages =
      [1, 2, 3, 4, 5, 6].map((month) => {
        const v = makeMonthValues(month);
        return (v.pmCost / (v.pmCost + v.cmCost)) * 100;
      }).reduce((a, b) => a + b, 0) / 6;
    expect(bu.pmCmCostRatio).not.toBeCloseTo(monthlyAverages, 6);
  });

  it("MTTR YTD is recalculated from cumulative downtime/repairs, not an average of monthly MTTR", () => {
    const result = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 5);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    const downtime = [1, 2, 3, 4, 5].reduce((sum, month) => sum + makeMonthValues(month).downtime, 0);
    const repairs = [1, 2, 3, 4, 5].reduce((sum, month) => sum + makeMonthValues(month).repairs, 0);
    expect(bu.mttrDays).toBeCloseTo(downtime / repairs, 6);
    const averageMonthlyMttr =
      [1, 2, 3, 4, 5].map((month) => {
        const v = makeMonthValues(month);
        return v.downtime / v.repairs;
      }).reduce((a, b) => a + b, 0) / 5;
    expect(bu.mttrDays).not.toBeCloseTo(averageMonthlyMttr, 6);
  });

  it("keeps the YTD window from spilling into months after the selected month", () => {
    const threeMonth = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 3).byBusinessUnitMap["AMD-EZ"];
    const nineMonth = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 9).byBusinessUnitMap["AMD-EZ"];
    expect(threeMonth.budgetSpend).toBeCloseTo(expectedYtd(AMD_EZ, 3).budgetSpend, 6);
    expect(nineMonth.budgetSpend).toBeCloseTo(expectedYtd(AMD_EZ, 9).budgetSpend, 6);
    expect(nineMonth.budgetSpend).not.toBeCloseTo(threeMonth.budgetSpend ?? 0, 6);
    expect(nineMonth.mttrDays).toBeCloseTo(expectedYtd(AMD_EZ, 9).mttrDays, 6);
  });
});

describe("Monthly KPI Scorecard portfolio consistency", () => {
  const clark = makeYearRecords("Clark Water").map((record) => ({
    ...record,
    actual_spend: 150 * Number(record.reporting_month),
    budget: Number(record.reporting_month) + 10,
    pm_work_orders: 10 + Number(record.reporting_month),
    cm_work_orders: 5 + (Number(record.reporting_month) % 2),
    pm_cost: 2000 + 20 * Number(record.reporting_month),
    cm_cost: 1000 - 5 * Number(record.reporting_month),
    mttr_downtime: 30 * Number(record.reporting_month) + 1,
    repair_count: Number(record.reporting_month) + 1,
  }));
  const allRecords = [...AMD_EZ, ...clark];

  it("portfolio averages (All Business Units) stay consistent with the per-BU rows for the selected month", () => {
    const result = aggregateMonthlyKpiRecords(allRecords, 2026, 7);
    const amdEz = result.byBusinessUnitMap["AMD-EZ"];
    const clarkAgg = result.byBusinessUnitMap["Clark Water"];
    const pya = result.portfolioYearAverage;

    // Non-MTTR portfolio card values are simple averages of the per-BU values.
    const nonMttrKeys = ["pmCompliance", "facilityUptime", "budgetSpend", "pmCmWorkOrderRatio", "pmCmCostRatio"] as const;
    const amdEzAsRecord = amdEz as unknown as Record<string, number | null>;
    const clarkAsRecord = clarkAgg as unknown as Record<string, number | null>;
    const pyaAsRecord = pya as unknown as Record<string, number | null>;
    nonMttrKeys.forEach((key) => {
      const average = ((amdEzAsRecord[key] ?? 0) + (clarkAsRecord[key] ?? 0)) / 2;
      expect(pyaAsRecord[key]).toBeCloseTo(average, 6);
    });
    // ...and every per-BU value already respects the YTD/monthly split, so the
    // portfolio view can never show a different figure than the table.
    expect(amdEz.pmCompliance).toBeCloseTo(expectedMonthlyKpi(AMD_EZ, 7).pmCompliance, 6);
    expect(clarkAgg.pmCompliance).toBeCloseTo(expectedMonthlyKpi(clark, 7).pmCompliance, 6);
    expect(amdEz.budgetSpend).toBeCloseTo(expectedYtd(AMD_EZ, 7).budgetSpend, 6);
    expect(clarkAgg.budgetSpend).toBeCloseTo(expectedYtd(clark, 7).budgetSpend, 6);
  });

  it("portfolio MTTR is the cumulative weighted MTTR across BUs through the selected month", () => {
    const result = aggregateMonthlyKpiRecords(allRecords, 2026, 7);
    const throughSeven = allRecords.filter((record) => Number(record.reporting_month) <= 7);
    const downtime = sum(throughSeven, "mttr_downtime");
    const repairs = sum(throughSeven, "repair_count");
    expect(result.portfolioYearAverage.mttrDays).toBeCloseTo(downtime / repairs, 6);

    // The portfolio MTTR changes with the selected month instead of always
    // reporting the full-year value.
    const march = aggregateMonthlyKpiRecords(allRecords, 2026, 3);
    const throughMarch = allRecords.filter((record) => Number(record.reporting_month) <= 3);
    expect(march.portfolioYearAverage.mttrDays).toBeCloseTo(
      sum(throughMarch, "mttr_downtime") / sum(throughMarch, "repair_count"),
      6
    );
    expect(march.portfolioYearAverage.mttrDays).not.toBeCloseTo(result.portfolioYearAverage.mttrDays ?? 0, 6);
  });

  it("December selection yields the full-year cumulative portfolio figures", () => {
    const december = aggregateMonthlyKpiRecords(allRecords, 2026, 12);
    const annual = aggregateMonthlyKpiRecords(allRecords, 2026);
    // YTD KPIs at December equal the full-year cumulative value.
    expect(december.portfolioYearAverage.budgetSpend).toBeCloseTo(annual.portfolioYearAverage.budgetSpend ?? 0, 6);
    expect(december.byBusinessUnitMap["AMD-EZ"].budgetSpend).toBeCloseTo(expectedYtd(AMD_EZ, 12).budgetSpend, 6);
    expect(december.byBusinessUnitMap["AMD-EZ"].mttrDays).toBeCloseTo(expectedYtd(AMD_EZ, 12).mttrDays, 6);
    // Monthly KPIs remain December-only, not annual averages.
    expect(december.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBeCloseTo(expectedMonthlyKpi(AMD_EZ, 12).pmCompliance, 6);
    expect(december.byBusinessUnitMap["AMD-EZ"].facilityUptime).toBeCloseTo(expectedMonthlyKpi(AMD_EZ, 12).facilityUptime, 6);
  });

  it("future/no-data months keep per-KPI nulls instead of zero-filling", () => {
    const partial = makeYearRecords("AMD-EZ").slice(0, 5); // January-May only
    const result = aggregateMonthlyKpiRecords(partial, 2026, 9);
    const bu = result.byBusinessUnitMap["AMD-EZ"];
    // YTD KPIs carry through the latest available month (<= September)...
    expect(bu.budgetSpend).toBeCloseTo(expectedYtd(partial, 5).budgetSpend, 6);
    expect(bu.mttrDays).toBeCloseTo(expectedYtd(partial, 5).mttrDays, 6);
    // ...while the monthly KPIs have no September source data and stay null.
    expect(bu.pmCompliance).toBeNull();
    expect(bu.facilityUptime).toBeNull();
  });
});

describe("Monthly KPI Scorecard month-mapping regression table", () => {
  it("maps January, March, September, and December selections consistently", () => {
    const aggregates = buildAggregateForMonths(AMD_EZ, [1, 3, 9, 12]);
    const expectations = [
      { month: 1, ytd: expectedYtd(AMD_EZ, 1), monthly: expectedMonthlyKpi(AMD_EZ, 1) },
      { month: 3, ytd: expectedYtd(AMD_EZ, 3), monthly: expectedMonthlyKpi(AMD_EZ, 3) },
      { month: 9, ytd: expectedYtd(AMD_EZ, 9), monthly: expectedMonthlyKpi(AMD_EZ, 9) },
      { month: 12, ytd: expectedYtd(AMD_EZ, 12), monthly: expectedMonthlyKpi(AMD_EZ, 12) },
    ];
    aggregates.forEach((result, index) => {
      const bu = result.byBusinessUnitMap["AMD-EZ"];
      const { month, ytd, monthly } = expectations[index];
      expect(bu.budgetSpend, `month ${month} budgetSpend`).toBeCloseTo(ytd.budgetSpend, 6);
      expect(bu.pmCmWorkOrderRatio, `month ${month} pmCmWorkOrderRatio`).toBeCloseTo(ytd.pmCmWorkOrderRatio, 6);
      expect(bu.pmCmCostRatio, `month ${month} pmCmCostRatio`).toBeCloseTo(ytd.pmCmCostRatio, 6);
      expect(bu.mttrDays, `month ${month} mttrDays`).toBeCloseTo(ytd.mttrDays, 6);
      expect(bu.pmCompliance, `month ${month} pmCompliance`).toBeCloseTo(monthly.pmCompliance, 6);
      expect(bu.facilityUptime, `month ${month} facilityUptime`).toBeCloseTo(monthly.facilityUptime, 6);
    });
  });
});
