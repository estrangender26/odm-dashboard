import { describe, expect, it } from "vitest";
import {
  evaluateKpiStatus,
  getDefaultMonthlyKpiThresholdConfig,
  mergeWithDefaultThresholdConfig,
  validateThresholdConfig,
  type MonthlyKpiThresholdConfig,
} from "./kpiThresholds";

describe("Monthly KPI threshold engine", () => {
  const defaults = getDefaultMonthlyKpiThresholdConfig();

  it("falls back to the default thresholds for a business unit with no custom config", () => {
    const config = mergeWithDefaultThresholdConfig({});
    expect(config.pmCompliance.green.min).toBe(98);
    expect(config.budgetSpend.green.min).toBe(95);
    expect(config.budgetSpend.green.max).toBe(105);
    expect(config.pmCmCostRatio.green.min).toBe(80);
    expect(config.facilityUptime.green.min).toBe(100);
    expect(config.mttrDays.dataExistsGreen).toBe(true);
  });

  it("uses a business-unit-specific override when one is provided", () => {
    const custom: Partial<MonthlyKpiThresholdConfig> = {
      pmCompliance: {
        ...defaults.pmCompliance,
        green: { min: 97 },
        amber: { min: 85, max: 97 },
        red: { max: 85 },
      },
    };
    const config = mergeWithDefaultThresholdConfig(custom);
    expect(config.pmCompliance.green.min).toBe(97);
    expect(config.pmCompliance.amber.min).toBe(85);
    expect(config.budgetSpend.green.min).toBe(95);
  });

  it("does not mutate the default config when merging custom values", () => {
    const custom: Partial<MonthlyKpiThresholdConfig> = {
      facilityUptime: { ...defaults.facilityUptime, green: { min: 99.5 } },
    };
    const merged = mergeWithDefaultThresholdConfig(custom);
    expect(merged.facilityUptime.green.min).toBe(99.5);
    expect(defaults.facilityUptime.green.min).toBe(100);
  });

  describe("Budget Spend two-sided range logic", () => {
    it("marks values inside 95%–105% as green", () => {
      expect(evaluateKpiStatus("budgetSpend", 95, defaults).status).toBe("green");
      expect(evaluateKpiStatus("budgetSpend", 100, defaults).status).toBe("green");
      expect(evaluateKpiStatus("budgetSpend", 105, defaults).status).toBe("green");
    });

    it("marks 90%–<95% and >105%–110% as amber", () => {
      expect(evaluateKpiStatus("budgetSpend", 92, defaults).status).toBe("amber");
      expect(evaluateKpiStatus("budgetSpend", 94.9, defaults).status).toBe("amber");
      expect(evaluateKpiStatus("budgetSpend", 106, defaults).status).toBe("amber");
      expect(evaluateKpiStatus("budgetSpend", 110, defaults).status).toBe("amber");
    });

    it("marks <90% or >110% as red", () => {
      expect(evaluateKpiStatus("budgetSpend", 89, defaults).status).toBe("red");
      expect(evaluateKpiStatus("budgetSpend", 111, defaults).status).toBe("red");
    });
  });

  it("preserves existing one-sided KPI dashboard behavior with the new defaults", () => {
    expect(evaluateKpiStatus("pmCompliance", 98, defaults).status).toBe("green");
    expect(evaluateKpiStatus("pmCompliance", 90, defaults).status).toBe("amber");
    expect(evaluateKpiStatus("pmCompliance", 89, defaults).status).toBe("red");

    expect(evaluateKpiStatus("pmCmWorkOrderRatio", 86, defaults).status).toBe("green");
    expect(evaluateKpiStatus("pmCmWorkOrderRatio", 75, defaults).status).toBe("amber");
    expect(evaluateKpiStatus("pmCmWorkOrderRatio", 74, defaults).status).toBe("red");

    expect(evaluateKpiStatus("pmCmCostRatio", 80, defaults).status).toBe("green");
    expect(evaluateKpiStatus("pmCmCostRatio", 50, defaults).status).toBe("amber");
    expect(evaluateKpiStatus("pmCmCostRatio", 49, defaults).status).toBe("red");

    expect(evaluateKpiStatus("facilityUptime", 100, defaults).status).toBe("green");
    expect(evaluateKpiStatus("facilityUptime", 99, defaults).status).toBe("amber");
    expect(evaluateKpiStatus("facilityUptime", 98.9, defaults).status).toBe("red");
  });

  it("treats MTTR as green when data exists and missing otherwise", () => {
    expect(evaluateKpiStatus("mttrDays", 3.2, defaults).status).toBe("green");
    expect(evaluateKpiStatus("mttrDays", 0, defaults).status).toBe("missing");
    expect(evaluateKpiStatus("mttrDays", null, defaults).status).toBe("missing");
  });

  it("rejects invalid threshold ranges", () => {
    const invalidConfig: MonthlyKpiThresholdConfig = {
      ...defaults,
      pmCompliance: {
        ...defaults.pmCompliance,
        green: { min: 95 },
        amber: { min: 98, max: 95 },
        red: { max: 98 },
      },
    };
    const errors = validateThresholdConfig(invalidConfig);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("amber lower bound must be below green lower bound"))).toBe(true);
  });

  it("accepts the default thresholds as valid", () => {
    expect(validateThresholdConfig(defaults)).toEqual([]);
  });
});
