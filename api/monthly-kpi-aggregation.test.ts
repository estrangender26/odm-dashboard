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
  it("tracks only the rationalized active KPI set", () => {
    expect(monthlyKpiKeys).toEqual([
      "pmCompliance",
      "budgetSpend",
      "pmCmWorkOrderRatio",
      "pmCmCostRatio",
      "mttrDays",
      "facilityUptime",
    ]);
    expect(monthlyKpiKeys).not.toContain("scheduleCompliance");
    expect(monthlyKpiKeys).not.toContain("mtbfDays");
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
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_compliance: 50 },
        { ...base, business_unit: "Clark Water", reporting_year: 2026, reporting_month: 1, pm_compliance: 90 },
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
        { ...base, business_unit: "ez", reporting_year: 2026, reporting_month: 5, pm_compliance: 10 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 5, pm_compliance: 100 },
      ],
      2026
    );

    expect(result.byBusinessUnitMap["AMD-EZ"].pmCompliance).toBe(100);
    expect(result.byBusinessUnitMap["AMD-EZ"].recordCount).toBe(1);
    expect(result.portfolioMonthlyAverages[5].pmCompliance).toBe(100);
  });

});
