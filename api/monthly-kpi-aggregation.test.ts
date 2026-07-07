import { describe, expect, it } from "vitest";
import { aggregateMonthlyKpiRecords, monthlyKpiKeys } from "../src/modules/monthly-kpi/kpiAggregation";

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
