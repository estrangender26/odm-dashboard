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

function facilityUptimeRecord(businessUnit: string, facilityUptime: number | null, reportingYear = 2026) {
  return {
    ...base,
    business_unit: businessUnit,
    reporting_year: reportingYear,
    reporting_month: 5,
    facility_uptime: facilityUptime,
  };
}

describe("Portfolio Summary Matrix Facility Uptime", () => {
  it("returns 100 when every business unit is exactly 100", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        facilityUptimeRecord("AMD-EZ", 100),
        facilityUptimeRecord("LARC", 100),
        facilityUptimeRecord("Clark Water", 100),
      ],
      2026,
      5
    );

    expect(result.portfolioYearAverage.facilityUptime).toBe(100);
  });

  it("averages the final displayed BU values for mixed values below 100", () => {
    const displayedBuValues = [100, 99.89155441761682, 93.79955197132617, 99.94601162850532, 99.02561635944701, 99.96398022859918];
    const result = aggregateMonthlyKpiRecords(
      [
        facilityUptimeRecord("AMD-EZ", displayedBuValues[0]),
        facilityUptimeRecord("LARC", displayedBuValues[1]),
        facilityUptimeRecord("CWC", displayedBuValues[2]),
        facilityUptimeRecord("LAWC", displayedBuValues[3]),
        facilityUptimeRecord("TWCI", displayedBuValues[4]),
        facilityUptimeRecord("EWG", displayedBuValues[5]),
      ],
      2026,
      5
    );
    const expected = displayedBuValues.reduce((sum, value) => sum + value, 0) / displayedBuValues.length;

    expect(result.portfolioYearAverage.facilityUptime).toBeCloseTo(expected, 10);
    expect(result.portfolioYearAverage.facilityUptime).toBeCloseTo(98.77111910091575, 10);
    expect(result.portfolioYearAverage.facilityUptime).toBeLessThanOrEqual(100);
  });

  it("excludes business units with missing Facility Uptime", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        facilityUptimeRecord("AMD-EZ", 100),
        facilityUptimeRecord("LARC", 98),
        facilityUptimeRecord("WAWAJVC", null),
      ],
      2026,
      5
    );

    expect(result.byBusinessUnitMap.WAWAJVC.facilityUptime).toBeNull();
    expect(result.portfolioYearAverage.facilityUptime).toBe(99);
  });

  it("does not include superseded aliases or records from another year", () => {
    const result = aggregateMonthlyKpiRecords(
      [
        facilityUptimeRecord("AMD-EZ", 100),
        facilityUptimeRecord("ez", 250),
        facilityUptimeRecord("Archived BU", 250, 2025),
      ],
      2026,
      5
    );

    expect(result.byBusinessUnit.map((aggregate) => aggregate.businessUnit)).toEqual(["AMD-EZ"]);
    expect(result.byBusinessUnitMap["AMD-EZ"].facilityUptime).toBe(100);
    expect(result.portfolioYearAverage.facilityUptime).toBe(100);
  });
});
