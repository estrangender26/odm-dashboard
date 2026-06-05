export const monthlyKpiKeys = [
  "pmCompliance",
  "scheduleCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mtbfDays",
  "mttrDays",
  "facilityUptime",
] as const;

export type MonthlyKpiKey = (typeof monthlyKpiKeys)[number];

export type PersistedMonthlyKpiRecord = {
  business_unit: string;
  reporting_month: number;
  reporting_year: number;
  pm_compliance: number | string | null;
  schedule_compliance: number | string | null;
  budget_spend: number | string | null;
  pm_cm_work_order_ratio: number | string | null;
  pm_cm_cost_ratio: number | string | null;
  mtbf_days: number | string | null;
  mttr_days: number | string | null;
  facility_uptime: number | string | null;
};

export type MonthlyKpiValues = Record<MonthlyKpiKey, number | null>;

export type BusinessUnitKpiAggregate = MonthlyKpiValues & {
  businessUnit: string;
  reportingYear: number;
  recordCount: number;
};

export type MonthlyKpiAggregateResult = {
  reportingYear: number;
  byBusinessUnit: BusinessUnitKpiAggregate[];
  byBusinessUnitMap: Record<string, BusinessUnitKpiAggregate>;
  portfolioYearAverage: MonthlyKpiValues;
  portfolioMonthlyAverages: Record<number, MonthlyKpiValues>;
};

const sourceFieldByKpiKey: Record<MonthlyKpiKey, keyof PersistedMonthlyKpiRecord> = {
  pmCompliance: "pm_compliance",
  scheduleCompliance: "schedule_compliance",
  budgetSpend: "budget_spend",
  pmCmWorkOrderRatio: "pm_cm_work_order_ratio",
  pmCmCostRatio: "pm_cm_cost_ratio",
  mtbfDays: "mtbf_days",
  mttrDays: "mttr_days",
  facilityUptime: "facility_uptime",
};

const businessUnitLabels: Record<string, string> = {
  "amd-ez": "AMD-EZ",
  ez: "AMD-EZ",
  "laguna water": "Laguna Water",
  laguna: "Laguna Water",
  "clark water": "Clark Water",
  clark: "Clark Water",
  "tagum water": "Tagum Water",
  tagum: "Tagum Water",
  "estate water": "Estate Water",
  estate: "Estate Water",
};

export function normalizeBusinessUnitLabel(value: string) {
  const normalized = String(value || "").toLowerCase().trim();
  return businessUnitLabels[normalized] || String(value || "").trim();
}

export function normalizeKpiNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function averageKpiValues(values: Array<number | string | null | undefined>) {
  const valid = values.map(normalizeKpiNumber).filter((value): value is number => value !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function emptyKpiValues(): MonthlyKpiValues {
  return monthlyKpiKeys.reduce((values, key) => {
    values[key] = null;
    return values;
  }, {} as MonthlyKpiValues);
}

function aggregateRecordsForBusinessUnit(
  businessUnit: string,
  reportingYear: number,
  records: PersistedMonthlyKpiRecord[]
): BusinessUnitKpiAggregate {
  const aggregate = {
    ...emptyKpiValues(),
    businessUnit,
    reportingYear,
    recordCount: records.length,
  };
  monthlyKpiKeys.forEach((key) => {
    aggregate[key] = averageKpiValues(records.map((record) => record[sourceFieldByKpiKey[key]]));
  });
  return aggregate;
}

export function aggregateMonthlyKpiRecords(
  records: PersistedMonthlyKpiRecord[],
  reportingYear: number
): MonthlyKpiAggregateResult {
  const yearlyRecords = records.filter((record) => Number(record.reporting_year) === reportingYear);
  const byBusinessUnitRecords = new Map<string, PersistedMonthlyKpiRecord[]>();

  yearlyRecords.forEach((record) => {
    const label = normalizeBusinessUnitLabel(record.business_unit);
    if (!label) return;
    byBusinessUnitRecords.set(label, [...(byBusinessUnitRecords.get(label) || []), record]);
  });

  const byBusinessUnit = Array.from(byBusinessUnitRecords.entries())
    .map(([businessUnit, unitRecords]) => aggregateRecordsForBusinessUnit(businessUnit, reportingYear, unitRecords))
    .sort((a, b) => a.businessUnit.localeCompare(b.businessUnit));

  const byBusinessUnitMap = byBusinessUnit.reduce<Record<string, BusinessUnitKpiAggregate>>((map, aggregate) => {
    map[aggregate.businessUnit] = aggregate;
    return map;
  }, {});

  const portfolioYearAverage = emptyKpiValues();
  monthlyKpiKeys.forEach((key) => {
    portfolioYearAverage[key] = averageKpiValues(byBusinessUnit.map((aggregate) => aggregate[key]));
  });

  const portfolioMonthlyAverages = Array.from({ length: 12 }, (_, index) => index + 1).reduce<Record<number, MonthlyKpiValues>>(
    (months, month) => {
      const monthlyRecords = yearlyRecords.filter((record) => Number(record.reporting_month) === month);
      const monthValues = emptyKpiValues();
      monthlyKpiKeys.forEach((key) => {
        monthValues[key] = averageKpiValues(monthlyRecords.map((record) => record[sourceFieldByKpiKey[key]]));
      });
      months[month] = monthValues;
      return months;
    },
    {}
  );

  return {
    reportingYear,
    byBusinessUnit,
    byBusinessUnitMap,
    portfolioYearAverage,
    portfolioMonthlyAverages,
  };
}
