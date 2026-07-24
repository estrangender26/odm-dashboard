import { describe, expect, it } from "vitest";
import {
  aggregateMonthlyKpiRecords,
  computeMonthlyKpiValuesFromRaw,
  monthlyKpiKeys,
} from "../src/modules/monthly-kpi/kpiAggregation";

const base = {
  pm_compliance: null,
  budget_spend: null,
  pm_cm_work_order_ratio: null,
  pm_cm_cost_ratio: null,
  mttr_days: null,
  facility_uptime: null,
};

describe("aggregateMonthlyKpiRecords", () => {
  it("tracks the active KPI set including Schedule Compliance and MTBF", () => {
    expect(monthlyKpiKeys).toEqual([
      "pmCompliance",
      "scheduleCompliance",
      "budgetSpend",
      "pmCmWorkOrderRatio",
      "pmCmCostRatio",
      "mtbfDays",
      "mttrDays",
      "facilityUptime",
    ]);
  });

  it("uses one yearly business-unit aggregate for summary rows and KPI cards", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_compliance: 98.66 },
        { ...base, business_unit: "Laguna Water", reporting_year: 2026, reporting_month: 1, pm_compliance: 97 },
      ],
      2026
    );

    const amdEz = result.byBusinessUnitMap["AMD-EZ"];
    expect(amdEz.pmCompliance).toBeCloseTo(99.33, 2);
    expect(result.byBusinessUnit.find((record) => record.businessUnit === "AMD-EZ")?.pmCompliance).toBe(amdEz.pmCompliance);
  });

  it("keeps portfolio yearly averages as averages of business-unit aggregates", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 100, pm_orders_completed_on_time: 100, total_pm_orders: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_compliance: 50, pm_orders_completed_on_time: 50, total_pm_orders: 100 },
        { ...base, business_unit: "Clark Water", reporting_year: 2026, reporting_month: 1, pm_compliance: 90, pm_orders_completed_on_time: 90, total_pm_orders: 100 },
      ],
      2026
    );

    expect(result.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBe(75);
    expect(result.byBusinessUnitMap["Clark Water"].pmCompliance).toBe(90);
    expect(result.portfolioYearAverage.pmCompliance).toBe(82.5);
    expect(result.portfolioMonthlyAverages[1].pmCompliance).toBe(95);
  });


  it("excludes future zero-only placeholder months from KPI averages", () => {
    const clarkBudgetSpend = [100, 97.96, 98.31, 98.28, 100];
    const importedRecords = clarkBudgetSpend.map((budgetSpend, index) => ({
      ...base,
      business_unit: "Clark Water",
      reporting_year: 2026,
      reporting_month: index + 1,
      budget_spend: budgetSpend,
      raw_imported_values: { sourceSheet: "Summary", values: { budget_spend: budgetSpend } },
    }));
    const placeholderRecords = Array.from({ length: 7 }, (_, index) => ({
      ...base,
      business_unit: "Clark Water",
      reporting_year: 2026,
      reporting_month: index + 6,
      budget_spend: 0,
      pm_cm_work_order_ratio: 0,
      pm_cm_cost_ratio: 0,
      mttr_days: 0,
      facility_uptime: 0,
      raw_imported_values: { sourceSheet: "Summary", values: { budget_spend: 0 } },
    }));

    const result = aggregateMonthlyKpiRecords([...importedRecords, ...placeholderRecords], 2026);

    expect(result.byBusinessUnitMap["Clark Water"].budgetSpend).toBeCloseTo(98.91, 2);
    expect(result.byBusinessUnitMap["Clark Water"].budgetSpend).not.toBeCloseTo(41.21, 2);
  });

  it("keeps explicit manually imported zero values in KPI averages", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        {
          ...base,
          business_unit: "Clark Water",
          reporting_year: 2026,
          reporting_month: 1,
          budget_spend: 0,
          raw_imported_values: { source: "manual", values: { budget_spend: "0" } },
        },
        {
          ...base,
          business_unit: "Clark Water",
          reporting_year: 2026,
          reporting_month: 2,
          budget_spend: 100,
          raw_imported_values: { source: "manual", values: { budget_spend: "100" } },
        },
      ],
      2026
    );

    expect(result.byBusinessUnitMap["Clark Water"].budgetSpend).toBe(50);
  });

  it("removes deleted business-unit values and recalculates portfolio averages from remaining records", () => {
    const beforeDelete = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_compliance: 98.66 },
        { ...base, business_unit: "Laguna Water", reporting_year: 2026, reporting_month: 1, pm_compliance: 97 },
      ],
      2026
    );

    const afterDelete = aggregateMonthlyKpiRecords(
      [{ ...base, business_unit: "Laguna Water", reporting_year: 2026, reporting_month: 1, pm_compliance: 97 }],
      2026
    );

    expect(beforeDelete.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBeCloseTo(99.33, 2);
    expect(afterDelete.byBusinessUnitMap["AMD-EZ"]).toBeUndefined();
    expect(afterDelete.byBusinessUnit.map((aggregate) => aggregate.businessUnit)).toEqual(["Laguna Water"]);
    expect(afterDelete.portfolioYearAverage.pmCompliance).toBe(97);
    expect(afterDelete.portfolioMonthlyAverages[2].pmCompliance).toBeNull();
  });


  it("prefers current AMD-EZ records over legacy ez alias records for the same year and month", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "ez", reporting_year: 2026, reporting_month: 5, pm_compliance: 10, pm_orders_completed_on_time: 10, total_pm_orders: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 5, pm_compliance: 100, pm_orders_completed_on_time: 100, total_pm_orders: 100 },
      ],
      2026
    );

    expect(result.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBe(100);
    expect(result.byBusinessUnitMap["AMD-EZ"].recordCount).toBe(1);
    expect(result.portfolioMonthlyAverages[5].pmCompliance).toBe(100);
  });


  it("recomputes Budget Spend as YTD cumulative actual spend over cumulative budget", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, actual_spend: 150, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 3, actual_spend: 50, budget: 100 },
      ],
      2026,
      3
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].budgetSpend).toBeCloseTo((300 / 300) * 100, 2);
  });

  it("returns zero for monthly Budget Spend when actual spend is zero and budget is positive", () => {
    const result = computeMonthlyKpiValuesFromRaw({
      ...base,
      business_unit: "AMD-EZ",
      reporting_year: 2026,
      reporting_month: 1,
      actual_spend: 0,
      budget: 100,
    });

    expect(result.budgetSpend).toBe(0);
  });

  it("returns zero for YTD Budget Spend when cumulative actual spend is zero and budget is positive", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, actual_spend: 0, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, actual_spend: 0, budget: 200 },
      ],
      2026
    );

    expect(result.byBusinessUnitMap["AMD-EZ"].budgetSpend).toBe(0);
  });

  it("stops Budget Spend YTD at the latest nonblank actual while retaining explicit zero-spend months", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 1, actual_spend: 1600, budget: 0 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 2, actual_spend: 128728.1, budget: 262000 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 3, actual_spend: 26628.1, budget: 200000 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 4, actual_spend: 89600, budget: 0 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 5, actual_spend: 0, budget: 262000 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 6, actual_spend: 0, budget: 200000 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 7, actual_spend: null, budget: 0 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 8, actual_spend: null, budget: 262000 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 9, actual_spend: null, budget: 200000 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 10, actual_spend: null, budget: 0 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 11, actual_spend: null, budget: 262000 },
        { ...base, business_unit: "LARC", reporting_year: 2026, reporting_month: 12, actual_spend: null, budget: 200000 },
      ],
      2026
    );

    expect(result.byBusinessUnitMap.LARC.recordCount).toBe(12);
    expect(result.byBusinessUnitMap.LARC.budgetSpend).toBeCloseTo((246556.2 / 924000) * 100, 2);
    expect(result.byBusinessUnitMap.LARC.budgetSpend).toBeCloseTo(26.68, 2);
    expect(result.portfolioMonthlyAverages[1].budgetSpend).toBeNull();
    expect(result.portfolioMonthlyAverages[2].budgetSpend).toBeCloseTo(49.74, 2);
    expect(result.portfolioMonthlyAverages[3].budgetSpend).toBeCloseTo(33.97, 2);
    expect(result.portfolioMonthlyAverages[4].budgetSpend).toBeCloseTo(53.37, 2);
    expect(result.portfolioMonthlyAverages[5].budgetSpend).toBeCloseTo(34.05, 2);
    expect(result.portfolioMonthlyAverages[6].budgetSpend).toBeCloseTo(26.68, 2);
    expect(result.portfolioMonthlyActuals[1].budgetSpend).toBeNull();
    expect(result.portfolioMonthlyActuals[2].budgetSpend).toBeCloseTo(49.13, 2);
    expect(result.portfolioMonthlyActuals[3].budgetSpend).toBeCloseTo(13.31, 2);
    expect(result.portfolioMonthlyActuals[4].budgetSpend).toBeNull();
    expect(result.portfolioMonthlyActuals[5].budgetSpend).toBe(0);
    expect(result.portfolioMonthlyActuals[6].budgetSpend).toBe(0);
    for (let month = 7; month <= 12; month += 1) {
      expect(result.portfolioMonthlyAverages[month].budgetSpend).toBeNull();
      expect(result.portfolioMonthlyActuals[month].budgetSpend).toBeNull();
    }
  });

  it("uses running average up to selected month for PM Compliance", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_orders_completed_on_time: 90, total_pm_orders: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_orders_completed_on_time: 95, total_pm_orders: 100 },
      ],
      2026,
      2
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBeCloseTo((90 + 95) / 2, 2);
  });

  it("uses running average up to selected month for Facility Uptime", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, total_operating_time: 720, total_downtime: 10 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, total_operating_time: 700, total_downtime: 7 },
      ],
      2026,
      2
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].facilityUptime).toBeCloseTo(98.80555555555556, 2);
  });

  it("recomputes PM:CM Work Order Ratio as YTD cumulative", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_work_orders: 10, cm_work_orders: 5 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_work_orders: 20, cm_work_orders: 10 },
      ],
      2026,
      2
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].pmCmWorkOrderRatio).toBeCloseTo((30 / 45) * 100, 2);
  });

  it("recomputes PM:CM Cost Ratio as YTD cumulative", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_cost: 1000, cm_cost: 500 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_cost: 2000, cm_cost: 1000 },
      ],
      2026,
      2
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].pmCmCostRatio).toBeCloseTo((3000 / 4500) * 100, 2);
  });

  it("recomputes MTTR as cumulative downtime over cumulative repairs", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_downtime: 10, repair_count: 2 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_downtime: 12, repair_count: 3 },
      ],
      2026,
      2
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].mttrDays).toBeCloseTo(22 / 5, 2);
  });

  it("matches workbook-style cumulative MTTR values", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_downtime: 48, repair_count: 2 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 3, mttr_downtime: 39, repair_count: 3 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 4, mttr_downtime: 98, repair_count: 2 },
      ],
      2026,
      4
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].mttrDays).toBeCloseTo(185 / 7, 2);
  });

  it("ignores partial KPI data and returns null for missing KPIs", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 5, actual_spend: 100, budget: 100 },
      ],
      2026,
      5
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].budgetSpend).toBeCloseTo(100, 2);
    expect(result.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBeNull();
    expect(result.byBusinessUnitMap["AMD-EZ"].facilityUptime).toBeNull();
  });

  it("handles zero denominator safely without NaN or Infinity", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_orders_completed_on_time: 10, total_pm_orders: 0 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, actual_spend: 100, budget: 0 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 3, total_downtime: 10, number_of_repairs: 0 },
      ],
      2026,
      3
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBeNull();
    expect(result.byBusinessUnitMap["AMD-EZ"].budgetSpend).toBeNull();
    expect(result.byBusinessUnitMap["AMD-EZ"].mttrDays).toBeNull();
  });

  it("ignores blank business unit rows and blank month records", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "", reporting_year: 2026, reporting_month: 2, actual_spend: 200, budget: 200 },
      ],
      2026,
      2
    );
    expect(result.byBusinessUnit).toHaveLength(1);
    expect(result.byBusinessUnitMap["AMD-EZ"].budgetSpend).toBeCloseTo(100, 2);
  });

  it("computes portfolio PM Compliance trend as a running average", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_orders_completed_on_time: 90, total_pm_orders: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_orders_completed_on_time: 95, total_pm_orders: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].pmCompliance).toBeCloseTo(90, 2);
    expect(result.portfolioMonthlyAverages[2].pmCompliance).toBeCloseTo((90 + 95) / 2, 2);
  });

  it("computes portfolio Facility Uptime trend as a running average", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, total_operating_time: 720, total_downtime: 10 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, total_operating_time: 700, total_downtime: 7 },
      ],
      2026
    );
    const jan = ((720 - 10) / 720) * 100;
    const feb = ((700 - 7) / 700) * 100;
    expect(result.portfolioMonthlyAverages[1].facilityUptime).toBeCloseTo(jan, 2);
    expect(result.portfolioMonthlyAverages[2].facilityUptime).toBeCloseTo((jan + feb) / 2, 2);
  });

  it("computes portfolio Budget Spend trend as cumulative/YTD", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, actual_spend: 150, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].budgetSpend).toBeCloseTo(100, 2);
    expect(result.portfolioMonthlyAverages[2].budgetSpend).toBeCloseTo((250 / 200) * 100, 2);
  });

  it("computes portfolio PM:CM Work Orders trend as cumulative/YTD", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_work_orders: 10, cm_work_orders: 5 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_work_orders: 20, cm_work_orders: 10 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].pmCmWorkOrderRatio).toBeCloseTo((10 / 15) * 100, 2);
    expect(result.portfolioMonthlyAverages[2].pmCmWorkOrderRatio).toBeCloseTo((30 / 45) * 100, 2);
  });

  it("computes portfolio PM:CM Cost trend as cumulative/YTD", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_cost: 1000, cm_cost: 500 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_cost: 2000, cm_cost: 1000 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].pmCmCostRatio).toBeCloseTo((1000 / 1500) * 100, 2);
    expect(result.portfolioMonthlyAverages[2].pmCmCostRatio).toBeCloseTo((3000 / 4500) * 100, 2);
  });

  it("computes portfolio MTTR trend as cumulative downtime over cumulative repairs", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, total_downtime: 10, number_of_repairs: 2 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, total_downtime: 12, number_of_repairs: 3 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].mttrDays).toBeCloseTo(5, 2);
    expect(result.portfolioMonthlyAverages[2].mttrDays).toBeCloseTo(22 / 5, 2);
  });

  it("leaves future trend months as null when no data exists for that month", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_orders_completed_on_time: 90, total_pm_orders: 100, actual_spend: 100, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].pmCompliance).toBeCloseTo(90, 2);
    expect(result.portfolioMonthlyAverages[2].pmCompliance).toBeNull();
    expect(result.portfolioMonthlyAverages[1].budgetSpend).toBeCloseTo(100, 2);
    expect(result.portfolioMonthlyAverages[2].budgetSpend).toBeNull();
  });

  it("returns portfolioMonthlyActuals with actual monthly values averaged across BUs", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 90, pm_orders_completed_on_time: 90, total_pm_orders: 100, budget_spend: 80, actual_spend: 80, budget: 100 },
        { ...base, business_unit: "Clark Water", reporting_year: 2026, reporting_month: 1, pm_compliance: 100, pm_orders_completed_on_time: 100, total_pm_orders: 100, budget_spend: 120, actual_spend: 120, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyActuals).toBeDefined();
    expect(result.portfolioMonthlyActuals[1].pmCompliance).toBeCloseTo(95, 2);
    expect(result.portfolioMonthlyActuals[1].budgetSpend).toBeCloseTo(100, 2);
    expect(result.portfolioMonthlyActuals[2].pmCompliance).toBeNull();
  });

  it("computes portfolioMonthlyActuals from raw inputs when stored computed values are missing", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "Clark Water", reporting_year: 2026, reporting_month: 1, actual_spend: 150, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyActuals[1].budgetSpend).toBeCloseTo(((100 / 100) * 100 + (150 / 100) * 100) / 2, 2);
  });

  it("keeps portfolioMonthlyActuals distinct from portfolioMonthlyAverages for cumulative KPIs", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, actual_spend: 150, budget: 100 },
      ],
      2026
    );
    // Actuals are monthly values.
    expect(result.portfolioMonthlyActuals[1].budgetSpend).toBeCloseTo(100, 2);
    expect(result.portfolioMonthlyActuals[2].budgetSpend).toBeCloseTo(150, 2);
    // Averages/trend are cumulative/YTD values.
    expect(result.portfolioMonthlyAverages[1].budgetSpend).toBeCloseTo(100, 2);
    expect(result.portfolioMonthlyAverages[2].budgetSpend).toBeCloseTo((250 / 200) * 100, 2);
  });
});


// Regression tests for KPI-specific cutoff behavior (June 2026 AMD-EZ scenario)
describe("KPI-specific cutoff regression tests", () => {
  const amdEzBase = {
    business_unit: "AMD-EZ",
    reporting_year: 2026,
    reporting_month: 1,
    pm_compliance: null,
    budget_spend: null,
    pm_cm_work_order_ratio: null,
    pm_cm_cost_ratio: null,
    mttr_days: null,
    facility_uptime: null,
  };

  it("includes June in PM Compliance when June has valid PM data but Budget Spend is blank", () => {
    // AMD-EZ data: Jan-May have all KPIs, June has PM Compliance but no Budget Spend
    const records = [
      // January - May: all KPIs available
      { ...amdEzBase, reporting_month: 1, pm_compliance: 100, pm_orders_completed_on_time: 100, total_pm_orders: 100, budget_spend: 90, actual_spend: 90, budget: 100, pm_work_orders: 10, cm_work_orders: 5, pm_cost: 1000, cm_cost: 500, mttr_days: 5, total_downtime: 10, number_of_repairs: 2, facility_uptime: 99, facility_operating_time: 100, facility_downtime: 1 },
      { ...amdEzBase, reporting_month: 2, pm_compliance: 98, pm_orders_completed_on_time: 98, total_pm_orders: 100, budget_spend: 95, actual_spend: 95, budget: 100, pm_work_orders: 12, cm_work_orders: 4, pm_cost: 1100, cm_cost: 450, mttr_days: 4, total_downtime: 8, number_of_repairs: 2, facility_uptime: 98, facility_operating_time: 100, facility_downtime: 2 },
      { ...amdEzBase, reporting_month: 3, pm_compliance: 97, pm_orders_completed_on_time: 97, total_pm_orders: 100, budget_spend: 92, actual_spend: 92, budget: 100, pm_work_orders: 11, cm_work_orders: 6, pm_cost: 1050, cm_cost: 550, mttr_days: 6, total_downtime: 12, number_of_repairs: 2, facility_uptime: 99, facility_operating_time: 100, facility_downtime: 1 },
      { ...amdEzBase, reporting_month: 4, pm_compliance: 99, pm_orders_completed_on_time: 99, total_pm_orders: 100, budget_spend: 98, actual_spend: 98, budget: 100, pm_work_orders: 13, cm_work_orders: 3, pm_cost: 1200, cm_cost: 400, mttr_days: 3, total_downtime: 6, number_of_repairs: 2, facility_uptime: 100, facility_operating_time: 100, facility_downtime: 0 },
      { ...amdEzBase, reporting_month: 5, pm_compliance: 96, pm_orders_completed_on_time: 96, total_pm_orders: 100, budget_spend: 94, actual_spend: 94, budget: 100, pm_work_orders: 9, cm_work_orders: 7, pm_cost: 950, cm_cost: 600, mttr_days: 7, total_downtime: 14, number_of_repairs: 2, facility_uptime: 98, facility_operating_time: 100, facility_downtime: 2 },
      // June: PM Compliance, PM:CM WO, MTTR, Facility Uptime available; Budget Spend and PM:CM Cost blank
      { ...amdEzBase, reporting_month: 6, pm_compliance: 95, pm_orders_completed_on_time: 95, total_pm_orders: 100, budget_spend: null, actual_spend: null, budget: null, pm_work_orders: 14, cm_work_orders: 5, pm_cost: null, cm_cost: null, mttr_days: 4, total_downtime: 8, number_of_repairs: 2, facility_uptime: 100, facility_operating_time: 100, facility_downtime: 0 },
    ];

    const result = aggregateMonthlyKpiRecords(records, 2026);
    const amdEz = result.byBusinessUnitMap["AMD-EZ"];

    // PM Compliance should include January-June (not stop at May)
    // Expected: average of [100, 98, 97, 99, 96, 95] = 97.5
    expect(amdEz.pmCompliance).toBeCloseTo(97.5, 1);

    // Budget Spend should only include January-May (stop at May since June is blank)
    // Expected: cumulative actual / cumulative budget for Jan-May
    // (90+95+92+98+94) / 500 * 100 = 469/500 * 100 = 93.8
    expect(amdEz.budgetSpend).toBeCloseTo(93.8, 1);

    // PM:CM Work Orders should include January-June
    // Expected: cumulative PM / (cumulative PM + cumulative CM) * 100
    // (10+12+11+13+9+14) / (69+30) * 100 = 69/99 * 100 = 69.697
    expect(amdEz.pmCmWorkOrderRatio).toBeCloseTo((69/99)*100, 1);

    // PM:CM Cost should only include January-May (June is blank)
    // (1000+1100+1050+1200+950) / (5300+2500) * 100 = 5300/7800 * 100 = 67.95
    expect(amdEz.pmCmCostRatio).toBeCloseTo((5300/7800)*100, 1);

    // MTTR should include January-June (weighted average)
    // Total downtime: 10+8+12+6+14+8 = 58
    // Total repairs: 2+2+2+2+2+2 = 12
    // MTTR = 58/12 = 4.83
    expect(amdEz.mttrDays).toBeCloseTo(58/12, 1);

    // Facility Uptime should include January-June
    // Expected: average of [99, 98, 99, 100, 98, 100] = 99.0
    expect(amdEz.facilityUptime).toBeCloseTo(99.0, 1);
  });

  it("preserves Budget Spend cutoff behavior when numeric zero is submitted", () => {
    // Test that explicit zero actual_spend is treated as valid data
    const records = [
      { ...amdEzBase, reporting_month: 1, budget_spend: 50, actual_spend: 50, budget: 100 },
      { ...amdEzBase, reporting_month: 2, budget_spend: 0, actual_spend: 0, budget: 100 },
      { ...amdEzBase, reporting_month: 3, budget_spend: null, actual_spend: null, budget: null },
    ];

    const result = aggregateMonthlyKpiRecords(records, 2026);
    const amdEz = result.byBusinessUnitMap["AMD-EZ"];

    // Budget Spend should include January and February (zero actual_spend is valid)
    // But not March (blank actual_spend)
    // Expected: (50+0) / 200 * 100 = 25
    expect(amdEz.budgetSpend).toBeCloseTo(25, 1);
  });

  it("ensures Portfolio Average cards match Summary Matrix values", () => {
    // Portfolio averages should be computed from BU aggregates that use KPI-specific cutoffs
    const records = [
      // AMD-EZ: June has PM Compliance but no Budget Spend
      { ...amdEzBase, business_unit: "AMD-EZ", reporting_month: 1, pm_compliance: 100, budget_spend: 90, actual_spend: 90, budget: 100 },
      { ...amdEzBase, business_unit: "AMD-EZ", reporting_month: 2, pm_compliance: 90, budget_spend: 80, actual_spend: 80, budget: 100 },
      { ...amdEzBase, business_unit: "AMD-EZ", reporting_month: 3, pm_compliance: 95, budget_spend: null, actual_spend: null, budget: null },
      // Clark Water: all months have both KPIs
      { ...amdEzBase, business_unit: "Clark Water", reporting_month: 1, pm_compliance: 80, budget_spend: 70, actual_spend: 70, budget: 100 },
      { ...amdEzBase, business_unit: "Clark Water", reporting_month: 2, pm_compliance: 85, budget_spend: 75, actual_spend: 75, budget: 100 },
      { ...amdEzBase, business_unit: "Clark Water", reporting_month: 3, pm_compliance: 90, budget_spend: 80, actual_spend: 80, budget: 100 },
    ];

    const result = aggregateMonthlyKpiRecords(records, 2026);

    // AMD-EZ PM Compliance: average of [100, 90, 95] = 95
    // Clark PM Compliance: average of [80, 85, 90] = 85
    // Portfolio: average of [95, 85] = 90
    expect(result.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBeCloseTo(95, 1);
    expect(result.byBusinessUnitMap["Clark Water"].pmCompliance).toBeCloseTo(85, 1);
    expect(result.portfolioYearAverage.pmCompliance).toBeCloseTo(90, 1);

    // AMD-EZ Budget Spend: cumulative Jan-Feb = (90+80)/200*100 = 85
    // Clark Budget Spend: cumulative Jan-Mar = (70+75+80)/300*100 = 75
    // Portfolio: average of [85, 75] = 80
    expect(result.byBusinessUnitMap["AMD-EZ"].budgetSpend).toBeCloseTo(85, 1);
    expect(result.byBusinessUnitMap["Clark Water"].budgetSpend).toBeCloseTo(75, 1);
    expect(result.portfolioYearAverage.budgetSpend).toBeCloseTo(80, 1);
  });
});

// Test for selectedMonth scenario
describe("selectedMonth filtering edge cases", () => {
  const amdEzBase = {
    business_unit: "AMD-EZ",
    reporting_year: 2026,
    reporting_month: 1,
    pm_compliance: null,
    budget_spend: null,
    pm_cm_work_order_ratio: null,
    pm_cm_cost_ratio: null,
    mttr_days: null,
    facility_uptime: null,
  };

  it("should include June PM Compliance even when selectedMonth is 5", () => {
    // This simulates the scenario where:
    // - The UI has May selected (selectedMonth = 5)
    // - But June has valid PM Compliance data
    // - PM Compliance should still include June
    const records = [
      { ...amdEzBase, reporting_month: 1, pm_compliance: 100, pm_orders_completed_on_time: 100, total_pm_orders: 100 },
      { ...amdEzBase, reporting_month: 2, pm_compliance: 98, pm_orders_completed_on_time: 98, total_pm_orders: 100 },
      { ...amdEzBase, reporting_month: 3, pm_compliance: 97, pm_orders_completed_on_time: 97, total_pm_orders: 100 },
      { ...amdEzBase, reporting_month: 4, pm_compliance: 99, pm_orders_completed_on_time: 99, total_pm_orders: 100 },
      { ...amdEzBase, reporting_month: 5, pm_compliance: 96, pm_orders_completed_on_time: 96, total_pm_orders: 100 },
      { ...amdEzBase, reporting_month: 6, pm_compliance: 95, pm_orders_completed_on_time: 95, total_pm_orders: 100 },
    ];

    // selectedMonth = 5 simulates the UI having May selected
    const result = aggregateMonthlyKpiRecords(records, 2026, 5);
    const amdEz = result.byBusinessUnitMap["AMD-EZ"];

    // With the fix, PM Compliance should include June (all 6 months)
    // Average of [100, 98, 97, 99, 96, 95] = 97.5
    // Without the fix, it would only include Jan-May: 98.0
    expect(amdEz.pmCompliance).toBeCloseTo(97.5, 1);
  });
});
