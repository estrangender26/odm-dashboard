import { describe, expect, it } from "vitest";
import { aggregateMonthlyKpiRecords } from "../src/modules/monthly-kpi/kpiAggregation";

const base = {
  pm_compliance: null,
  budget_spend: null,
  pm_cm_work_order_ratio: null,
  pm_cm_cost_ratio: null,
  mttr_days: null,
  facility_uptime: null,
};

describe("portfolio / All Business Units MTTR", () => {
  it("is weighted downtime / repairs, not average of BU MTTR values", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "BU-A", reporting_year: 2026, reporting_month: 1, mttr_downtime: 100, repair_count: 10 },
        { ...base, business_unit: "BU-B", reporting_year: 2026, reporting_month: 1, mttr_downtime: 90, repair_count: 1 },
      ],
      2026
    );
    expect(result.portfolioYearAverage.mttrDays).toBeCloseTo(190 / 11, 2);
    expect(result.portfolioYearAverage.mttrDays).not.toBeCloseTo(50, 2);
  });

  it("portfolio monthly actual is weighted across BUs for the same month", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "BU-A", reporting_year: 2026, reporting_month: 1, mttr_downtime: 100, repair_count: 10 },
        { ...base, business_unit: "BU-B", reporting_year: 2026, reporting_month: 1, mttr_downtime: 90, repair_count: 1 },
      ],
      2026
    );
    expect(result.portfolioMonthlyActuals[1].mttrDays).toBeCloseTo(190 / 11, 2);
    expect(result.portfolioMonthlyActuals[1].mttrDays).not.toBeCloseTo(50, 2);
  });

  it("portfolio YTD trend is cumulative weighted MTTR across BUs and months", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "BU-A", reporting_year: 2026, reporting_month: 1, mttr_downtime: 48, repair_count: 2 },
        { ...base, business_unit: "BU-B", reporting_year: 2026, reporting_month: 1, mttr_downtime: 39, repair_count: 1 },
        { ...base, business_unit: "BU-A", reporting_year: 2026, reporting_month: 2, mttr_downtime: 39, repair_count: 3 },
        { ...base, business_unit: "BU-B", reporting_year: 2026, reporting_month: 2, mttr_downtime: 20, repair_count: 1 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].mttrDays).toBeCloseTo(29, 2);
    expect(result.portfolioMonthlyAverages[2].mttrDays).toBeCloseTo(146 / 7, 2);
  });

  it("individual BU MTTR remains correct", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_downtime: 48, repair_count: 2 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_downtime: 39, repair_count: 3 },
      ],
      2026
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].mttrDays).toBeCloseTo((48 + 39) / (2 + 3), 2);
  });

  it("reconstructs All-BU MTTR from monthly MTTR and repair count when downtime is missing", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "BU-A", reporting_year: 2026, reporting_month: 1, mttr_days: 24, repair_count: 2 },
        { ...base, business_unit: "BU-B", reporting_year: 2026, reporting_month: 1, mttr_days: 90, repair_count: 1 },
      ],
      2026
    );
    expect(result.portfolioYearAverage.mttrDays).toBeCloseTo(138 / 3, 2);
  });

  it("future/no-data months remain null", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "BU-A", reporting_year: 2026, reporting_month: 1, mttr_downtime: 48, repair_count: 2 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].mttrDays).toBeCloseTo(24, 2);
    expect(result.portfolioMonthlyAverages[2].mttrDays).toBeNull();
    expect(result.portfolioMonthlyActuals[2].mttrDays).toBeNull();
  });
});
