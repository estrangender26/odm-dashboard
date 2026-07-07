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

describe("portfolio monthly trend carry-forward prevention per KPI", () => {
  it("PM Compliance trend stops when current month has no PM Compliance source data", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_orders_completed_on_time: 90, total_pm_orders: 100, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_orders_completed_on_time: 95, total_pm_orders: 100, actual_spend: 150, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 3, actual_spend: 200, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[1].pmCompliance).toBeCloseTo(90, 2);
    expect(result.portfolioMonthlyAverages[2].pmCompliance).toBeCloseTo((90 + 95) / 2, 2);
    expect(result.portfolioMonthlyAverages[3].pmCompliance).toBeNull();
    expect(result.portfolioMonthlyAverages[3].budgetSpend).toBeCloseTo(150, 2); // cumulative still works
  });

  it("PM:CM Work Orders trend stops when current month has no WO source data", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_work_orders: 60, cm_work_orders: 10, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, pm_work_orders: 50, cm_work_orders: 20, actual_spend: 150, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 3, actual_spend: 200, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[2].pmCmWorkOrderRatio).toBeCloseTo(((60 + 50) / ((60 + 50) + (10 + 20))) * 100, 2);
    expect(result.portfolioMonthlyAverages[3].pmCmWorkOrderRatio).toBeNull();
    expect(result.portfolioMonthlyAverages[3].budgetSpend).toBeCloseTo(150, 2);
  });

  it("Budget Spend trend stops when current month has no budget source data", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, actual_spend: 100, budget: 100, pm_work_orders: 60, cm_work_orders: 10 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, actual_spend: 150, budget: 100, pm_work_orders: 50, cm_work_orders: 20 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 3, pm_work_orders: 70, cm_work_orders: 5 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[2].budgetSpend).toBeCloseTo(125, 2);
    expect(result.portfolioMonthlyAverages[3].budgetSpend).toBeNull();
    expect(result.portfolioMonthlyAverages[3].pmCmWorkOrderRatio).not.toBeNull();
  });

  it("MTTR trend stops when current month has no MTTR source data", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_downtime: 48, repair_count: 2, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_downtime: 39, repair_count: 3, actual_spend: 150, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 3, actual_spend: 200, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[2].mttrDays).toBeCloseTo((48 + 39) / 5, 2);
    expect(result.portfolioMonthlyAverages[3].mttrDays).toBeNull();
    expect(result.portfolioMonthlyAverages[3].budgetSpend).toBeCloseTo(150, 2);
  });

  it("Facility Uptime trend stops when current month has no uptime source data", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, facility_operating_time: 744, facility_downtime: 0, actual_spend: 100, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, facility_operating_time: 672, facility_downtime: 0, actual_spend: 150, budget: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 3, actual_spend: 200, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyAverages[2].facilityUptime).toBeCloseTo(100, 2);
    expect(result.portfolioMonthlyAverages[3].facilityUptime).toBeNull();
    expect(result.portfolioMonthlyAverages[3].budgetSpend).toBeCloseTo(150, 2);
  });

  it("PM Compliance actual bars are null when current month has no PM Compliance source data", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_orders_completed_on_time: 90, total_pm_orders: 100 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, actual_spend: 150, budget: 100 },
      ],
      2026
    );
    expect(result.portfolioMonthlyActuals[1].pmCompliance).toBeCloseTo(90, 2);
    expect(result.portfolioMonthlyActuals[2].pmCompliance).toBeNull();
  });
});
