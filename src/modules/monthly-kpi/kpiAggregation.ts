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
  id?: number | string;
  business_unit: string;
  reporting_month: number;
  reporting_year: number;
  source_file_name?: string | null;
  imported_at?: string | Date | null;
  pm_compliance: number | string | null;
  schedule_compliance: number | string | null;
  budget_spend: number | string | null;
  pm_cm_work_order_ratio: number | string | null;
  pm_cm_cost_ratio: number | string | null;
  mtbf_days: number | string | null;
  mttr_days: number | string | null;
  facility_uptime: number | string | null;
  raw_imported_values?: unknown;
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

type PersistedKpiValueField = Exclude<
  keyof PersistedMonthlyKpiRecord,
  "business_unit" | "reporting_month" | "reporting_year" | "source_file_name" | "imported_at" | "raw_imported_values"
>;

const sourceFieldByKpiKey: Record<MonthlyKpiKey, PersistedKpiValueField> = {
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

const currentBusinessUnitLabels = new Set(["AMD-EZ", "Laguna Water", "Clark Water", "Tagum Water", "Estate Water"]);

export function normalizeBusinessUnitLabel(value: string) {
  const normalized = String(value || "").toLowerCase().trim();
  return businessUnitLabels[normalized] || String(value || "").trim();
}

function businessUnitAliasPriority(value: string) {
  const label = normalizeBusinessUnitLabel(value);
  const trimmed = String(value || "").trim();
  return currentBusinessUnitLabels.has(trimmed) && trimmed === label ? 0 : 1;
}

export function preferCurrentBusinessUnitAliasRecords(records: PersistedMonthlyKpiRecord[]) {
  const preferred = new Map<string, { record: PersistedMonthlyKpiRecord; priority: number; sequence: number }>();
  records.forEach((record, sequence) => {
    const label = normalizeBusinessUnitLabel(record.business_unit);
    if (!label) return;
    const key = `${label}|${Number(record.reporting_year)}|${Number(record.reporting_month)}`;
    const priority = businessUnitAliasPriority(record.business_unit);
    const existing = preferred.get(key);
    if (!existing || priority < existing.priority || (priority === existing.priority && sequence > existing.sequence)) {
      preferred.set(key, { record, priority, sequence });
    }
  });
  return Array.from(preferred.values()).map((entry) => entry.record);
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

function hasRawImportedValues(record: PersistedMonthlyKpiRecord) {
  return record.raw_imported_values !== null && record.raw_imported_values !== undefined;
}

function getRawImportedSource(record: PersistedMonthlyKpiRecord) {
  const raw = record.raw_imported_values;
  if (!raw || typeof raw !== "object") return "";
  const source = (raw as { source?: unknown; sourceSheet?: unknown }).source ?? (raw as { sourceSheet?: unknown }).sourceSheet;
  return String(source ?? "").toLowerCase().trim();
}

function rawValueForKpi(record: PersistedMonthlyKpiRecord, key: MonthlyKpiKey) {
  const raw = record.raw_imported_values;
  if (!raw || typeof raw !== "object") return undefined;
  const values = (raw as { values?: unknown }).values;
  if (!values || typeof values !== "object") return undefined;
  const sourceField = sourceFieldByKpiKey[key];
  const legacyKeys: Partial<Record<MonthlyKpiKey, string[]>> = {
    pmCmWorkOrderRatio: ["pmcmWORatio", "pm_cm_work_order_ratio"],
    pmCmCostRatio: ["pmcmCostRatio", "pm_cm_cost_ratio"],
    mtbfDays: ["mtbf", "mtbf_days"],
    mttrDays: ["mttr", "mttr_days"],
  };
  const candidates = [sourceField, key, ...(legacyKeys[key] || [])];
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(values, candidate)) {
      const rawValue = (values as Record<string, unknown>)[candidate];
      if (rawValue && typeof rawValue === "object" && Object.prototype.hasOwnProperty.call(rawValue, "value")) {
        return (rawValue as { value?: unknown }).value;
      }
      return rawValue;
    }
  }
  return undefined;
}

function isBlankRawValue(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function isZeroOnlyWorkbookPlaceholder(record: PersistedMonthlyKpiRecord) {
  if (getRawImportedSource(record) === "manual") return false;
  const normalizedValues = monthlyKpiKeys.map((key) => normalizeKpiNumber(record[sourceFieldByKpiKey[key]]));
  const hasZero = normalizedValues.some((value) => value === 0);
  return hasZero && normalizedValues.every((value) => value === null || value === 0);
}

function hasImportedKpiValue(record: PersistedMonthlyKpiRecord, key: MonthlyKpiKey) {
  const value = normalizeKpiNumber(record[sourceFieldByKpiKey[key]]);
  if (value === null) return false;
  if (value !== 0) return true;
  if (!hasRawImportedValues(record)) return true;
  if (isZeroOnlyWorkbookPlaceholder(record)) return false;
  return !isBlankRawValue(rawValueForKpi(record, key));
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
    aggregate[key] = averageKpiValues(
      records.filter((record) => hasImportedKpiValue(record, key)).map((record) => record[sourceFieldByKpiKey[key]])
    );
  });
  return aggregate;
}

export function aggregateMonthlyKpiRecords(
  records: PersistedMonthlyKpiRecord[],
  reportingYear: number
): MonthlyKpiAggregateResult {
  const yearlyRecords = preferCurrentBusinessUnitAliasRecords(
    records.filter((record) => Number(record.reporting_year) === reportingYear)
  );
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
        monthValues[key] = averageKpiValues(
          monthlyRecords.filter((record) => hasImportedKpiValue(record, key)).map((record) => record[sourceFieldByKpiKey[key]])
        );
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
