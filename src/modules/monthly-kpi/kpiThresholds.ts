export const monthlyKpiThresholdKeys = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "facilityUptime",
  "mttrDays",
] as const;

export type MonthlyKpiThresholdKey = (typeof monthlyKpiThresholdKeys)[number];

export type KpiThresholdBand = {
  min?: number | null;
  max?: number | null;
};

export type KpiThresholdRule = {
  key: MonthlyKpiThresholdKey;
  name: string;
  unit?: string;
  green: KpiThresholdBand;
  amber: KpiThresholdBand;
  red: KpiThresholdBand;
  twoSided?: boolean;
  dataExistsGreen?: boolean;
};

export type MonthlyKpiThresholdConfig = Record<MonthlyKpiThresholdKey, KpiThresholdRule>;

export type KpiEvaluationStatus = {
  status: "green" | "amber" | "red" | "missing";
  label: string;
};

function cloneBand(band: KpiThresholdBand): KpiThresholdBand {
  return {
    min: band.min ?? null,
    max: band.max ?? null,
  };
}

function cloneRule(rule: KpiThresholdRule): KpiThresholdRule {
  return {
    key: rule.key,
    name: rule.name,
    unit: rule.unit,
    green: cloneBand(rule.green),
    amber: cloneBand(rule.amber),
    red: cloneBand(rule.red),
    twoSided: rule.twoSided,
    dataExistsGreen: rule.dataExistsGreen,
  };
}

export function getDefaultMonthlyKpiThresholdConfig(): MonthlyKpiThresholdConfig {
  return {
    pmCompliance: {
      key: "pmCompliance",
      name: "PM Compliance",
      unit: "%",
      green: { min: 98 },
      amber: { min: 90, max: 98 },
      red: { max: 90 },
    },
    budgetSpend: {
      key: "budgetSpend",
      name: "Budget Spend",
      unit: "%",
      green: { min: 95, max: 105 },
      amber: { min: 90, max: 110 },
      red: { max: 90, min: 110 },
      twoSided: true,
    },
    pmCmWorkOrderRatio: {
      key: "pmCmWorkOrderRatio",
      name: "PM:CM Ratio (WO)",
      unit: "%",
      green: { min: 86 },
      amber: { min: 75, max: 86 },
      red: { max: 75 },
    },
    pmCmCostRatio: {
      key: "pmCmCostRatio",
      name: "PM:CM Ratio (Cost)",
      unit: "%",
      green: { min: 80 },
      amber: { min: 50, max: 80 },
      red: { max: 50 },
    },
    facilityUptime: {
      key: "facilityUptime",
      name: "Facility Uptime",
      unit: "%",
      green: { min: 100 },
      amber: { min: 99, max: 100 },
      red: { max: 99 },
    },
    mttrDays: {
      key: "mttrDays",
      name: "MTTR",
      unit: "days",
      green: {},
      amber: {},
      red: {},
      dataExistsGreen: true,
    },
  };
}

export function cloneMonthlyKpiThresholdConfig(
  config: MonthlyKpiThresholdConfig
): MonthlyKpiThresholdConfig {
  const result = {} as MonthlyKpiThresholdConfig;
  for (const key of monthlyKpiThresholdKeys) {
    result[key] = cloneRule(config[key]);
  }
  return result;
}

export function mergeWithDefaultThresholdConfig(
  custom?: Partial<MonthlyKpiThresholdConfig>
): MonthlyKpiThresholdConfig {
  const defaults = getDefaultMonthlyKpiThresholdConfig();
  if (!custom) return defaults;
  const result = {} as MonthlyKpiThresholdConfig;
  for (const key of monthlyKpiThresholdKeys) {
    const customRule = custom[key];
    if (customRule) {
      result[key] = cloneRule(customRule);
    } else {
      result[key] = cloneRule(defaults[key]);
    }
  }
  return result;
}

function parseNumericValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateKpiStatus(
  key: MonthlyKpiThresholdKey,
  value: number | string | null | undefined,
  config: MonthlyKpiThresholdConfig
): KpiEvaluationStatus {
  const numeric = parseNumericValue(value);
  const rule = config[key];
  if (!rule) {
    return { status: "missing", label: "Missing" };
  }

  if (rule.dataExistsGreen) {
    return numeric !== null && numeric > 0
      ? { status: "green", label: "Available" }
      : { status: "missing", label: "Missing" };
  }

  if (numeric === null) {
    return { status: "missing", label: "Missing" };
  }

  const v = numeric;
  const { green, amber, twoSided } = rule;

  if (twoSided) {
    if (green.min != null && green.max != null && v >= green.min && v <= green.max) {
      return { status: "green", label: "On Target" };
    }
    if (
      amber.min != null &&
      green.min != null &&
      v >= amber.min &&
      v < green.min
    ) {
      return { status: "amber", label: "Warning" };
    }
    if (
      green.max != null &&
      amber.max != null &&
      v > green.max &&
      v <= amber.max
    ) {
      return { status: "amber", label: "Warning" };
    }
    return { status: "red", label: "Off Target" };
  }

  if (green.min != null && v >= green.min) {
    return { status: "green", label: "Passed" };
  }
  if (amber.min != null && v >= amber.min) {
    return { status: "amber", label: "Near Target" };
  }
  return { status: "red", label: "Below Target" };
}

export function formatThresholdBenchmark(rule: KpiThresholdRule): string {
  if (rule.dataExistsGreen) {
    return "Data exists";
  }
  if (rule.twoSided) {
    const min = rule.green.min ?? rule.amber.min;
    const max = rule.green.max ?? rule.amber.max;
    if (min != null && max != null) {
      return `${min}%–${max}%`;
    }
  }
  if (rule.green.min != null) {
    if (rule.key === "facilityUptime") {
      return `=${rule.green.min}${rule.unit === "%" ? "%" : ""}`;
    }
    return `≥${rule.green.min}${rule.unit === "%" ? "%" : ""}`;
  }
  return "";
}

export function validateThresholdConfig(
  config: MonthlyKpiThresholdConfig
): string[] {
  const errors: string[] = [];

  for (const key of monthlyKpiThresholdKeys) {
    const rule = config[key];
    if (!rule) {
      errors.push(`${key}: missing threshold rule`);
      continue;
    }

    if (rule.dataExistsGreen) continue;

    const { green, amber, red, twoSided } = rule;

    if (green.min == null) {
      errors.push(`${rule.name}: green threshold is required`);
      continue;
    }

    if (twoSided) {
      if (green.max == null) {
        errors.push(`${rule.name}: green upper bound is required for a two-sided KPI`);
        continue;
      }
      if (green.min >= green.max) {
        errors.push(`${rule.name}: green lower bound must be less than upper bound`);
      }

      if (amber.min == null || amber.max == null) {
        errors.push(`${rule.name}: amber lower and upper bounds are required for a two-sided KPI`);
      } else {
        if (amber.min >= green.min) {
          errors.push(`${rule.name}: amber lower bound must be below green lower bound`);
        }
        if (amber.max <= green.max) {
          errors.push(`${rule.name}: amber upper bound must be above green upper bound`);
        }
      }
    } else {
      if (amber.min == null) {
        errors.push(`${rule.name}: amber lower bound is required`);
      } else if (amber.min >= green.min) {
        errors.push(`${rule.name}: amber lower bound must be below green lower bound`);
      }
    }

    if (red.max != null && amber.min != null && red.max > amber.min) {
      errors.push(`${rule.name}: red upper bound must be below amber lower bound`);
    }
    if (red.min != null && amber.max != null && red.min < amber.max) {
      errors.push(`${rule.name}: red lower bound must be above amber upper bound`);
    }
  }

  return errors;
}
