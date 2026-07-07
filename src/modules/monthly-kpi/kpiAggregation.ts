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
  pm_planned?: number | string | null;
  schedule_compliance?: number | string | null;
  budget_spend: number | string | null;
  pm_cm_work_order_ratio: number | string | null;
  pm_cm_cost_ratio: number | string | null;
  mtbf_days?: number | string | null;
  mttr_days: number | string | null;
  facility_uptime: number | string | null;
  notes?: string | null;
  raw_imported_values?: unknown;
  // Raw input fields used to recompute KPIs inside the app.
  actual_spend?: number | string | null;
  budget?: number | string | null;
  pm_orders_completed_on_time?: number | string | null;
  total_pm_orders?: number | string | null;
  pm_work_orders?: number | string | null;
  cm_work_orders?: number | string | null;
  pm_cost?: number | string | null;
  cm_cost?: number | string | null;
  // Legacy generic downtime fields (kept for backward compatibility with old imports).
  total_downtime?: number | string | null;
  number_of_repairs?: number | string | null;
  total_operating_time?: number | string | null;
  // KPI-specific downtime/operating fields to avoid MTTR ↔ Facility Uptime collisions.
  mttr_downtime?: number | string | null;
  repair_count?: number | string | null;
  facility_operating_time?: number | string | null;
  facility_downtime?: number | string | null;
  source_sheet?: string | null;
  import_batch_id?: string | null;
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
  /**
   * Monthly values intended for trend charts. The semantics differ by KPI:
   * - PM Compliance and Facility Uptime: running average/YTD average of monthly
   *   KPI values up to that month.
   * - Budget Spend, PM:CM Work Orders, PM:CM Cost, and MTTR: cumulative/YTD
   *   value up to that month.
   * - Legacy KPIs (e.g. scheduleCompliance, mtbfDays): per-month average when
   *   available.
   * Months with no imported data for a KPI are null, never zero-filled.
   *
   * Note: the field name `portfolioMonthlyAverages` is historical. A more
   * accurate name would be `portfolioMonthlyTrendValues` because some entries
   * are cumulative or running-average rather than simple averages.
   */
  portfolioMonthlyAverages: Record<number, MonthlyKpiValues>;
  /**
   * Per-KPI, per-month actual monthly values averaged across all business
   * units that have data for that month. This is intended for chart series that
   * show month-by-month performance (e.g. bar series), distinct from the
   * trend/YTD series in `portfolioMonthlyAverages`.
   * Months with no imported data for a KPI are null, never zero-filled.
   */
  portfolioMonthlyActuals: Record<number, MonthlyKpiValues>;
};

type PersistedKpiValueField = Exclude<
  keyof PersistedMonthlyKpiRecord,
  "business_unit" | "reporting_month" | "reporting_year" | "source_file_name" | "imported_at" | "raw_imported_values" | "source_sheet" | "import_batch_id"
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

export function hasImportedKpiValue(record: PersistedMonthlyKpiRecord, key: MonthlyKpiKey) {
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

// ── Period-aware KPI computation ──

const MONTHLY_ONLY_KEYS: MonthlyKpiKey[] = ["pmCompliance", "facilityUptime"];
const YTD_KEYS: MonthlyKpiKey[] = ["budgetSpend", "pmCmWorkOrderRatio", "pmCmCostRatio", "mttrDays"];

function sumField(records: PersistedMonthlyKpiRecord[], field: keyof PersistedMonthlyKpiRecord) {
  return records.reduce((sum, record) => {
    const value = normalizeKpiNumber((record as any)[field]);
    return value === null ? sum : sum + value;
  }, 0);
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function computeMonthlyKpiValue(key: MonthlyKpiKey, record: PersistedMonthlyKpiRecord): number | null {
  if (key === "pmCompliance") {
    const completed = normalizeKpiNumber(record.pm_orders_completed_on_time);
    const total = normalizeKpiNumber(record.total_pm_orders);
    if (completed === null || total === null || total === 0) return null;
    return (completed / total) * 100;
  }
  if (key === "facilityUptime") {
    const operating =
      normalizeKpiNumber(record.facility_operating_time) ?? normalizeKpiNumber(record.total_operating_time);
    const downtime =
      normalizeKpiNumber(record.facility_downtime) ?? normalizeKpiNumber(record.total_downtime);
    if (operating === null || downtime === null || operating === 0) return null;
    return safeDivide((operating as number) - (downtime as number), operating as number)! * 100;
  }
  if (key === "budgetSpend") {
    const actual = normalizeKpiNumber(record.actual_spend);
    const budget = normalizeKpiNumber(record.budget);
    return safeDivide(actual as number, budget as number) ? safeDivide(actual as number, budget as number)! * 100 : null;
  }
  if (key === "pmCmWorkOrderRatio") {
    const pm = normalizeKpiNumber(record.pm_work_orders);
    const cm = normalizeKpiNumber(record.cm_work_orders);
    if (pm === null || cm === null) return null;
    return safeDivide(pm as number, (pm as number) + (cm as number)) ? safeDivide(pm as number, (pm as number) + (cm as number))! * 100 : null;
  }
  if (key === "pmCmCostRatio") {
    const pm = normalizeKpiNumber(record.pm_cost);
    const cm = normalizeKpiNumber(record.cm_cost);
    if (pm === null || cm === null) return null;
    return safeDivide(pm as number, (pm as number) + (cm as number)) ? safeDivide(pm as number, (pm as number) + (cm as number))! * 100 : null;
  }
  if (key === "mttrDays") {
    let downtime =
      normalizeKpiNumber(record.mttr_downtime) ?? normalizeKpiNumber(record.total_downtime);
    const repairs =
      normalizeKpiNumber(record.repair_count) ?? normalizeKpiNumber(record.number_of_repairs);
    // Reconstruct downtime from monthly MTTR and repair count when downtime is unavailable.
    if (downtime === null && repairs !== null) {
      const monthlyMttr = normalizeKpiNumber(record.mttr_days);
      if (monthlyMttr !== null) {
        downtime = monthlyMttr * repairs;
      }
    }
    return safeDivide(downtime as number, repairs as number);
  }
  return normalizeKpiNumber(record[sourceFieldByKpiKey[key]]);
}

function hasRawInputForKpi(key: MonthlyKpiKey, record: PersistedMonthlyKpiRecord): boolean {
  if (key === "pmCompliance") {
    return normalizeKpiNumber(record.pm_orders_completed_on_time) !== null && normalizeKpiNumber(record.total_pm_orders) !== null;
  }
  if (key === "facilityUptime") {
    const operating =
      normalizeKpiNumber(record.facility_operating_time) ?? normalizeKpiNumber(record.total_operating_time);
    const downtime =
      normalizeKpiNumber(record.facility_downtime) ?? normalizeKpiNumber(record.total_downtime);
    return operating !== null && downtime !== null;
  }
  if (key === "budgetSpend") {
    return normalizeKpiNumber(record.actual_spend) !== null && normalizeKpiNumber(record.budget) !== null;
  }
  if (key === "pmCmWorkOrderRatio") {
    return normalizeKpiNumber(record.pm_work_orders) !== null && normalizeKpiNumber(record.cm_work_orders) !== null;
  }
  if (key === "pmCmCostRatio") {
    return normalizeKpiNumber(record.pm_cost) !== null && normalizeKpiNumber(record.cm_cost) !== null;
  }
  if (key === "mttrDays") {
    const downtime =
      normalizeKpiNumber(record.mttr_downtime) ?? normalizeKpiNumber(record.total_downtime);
    const repairs =
      normalizeKpiNumber(record.repair_count) ?? normalizeKpiNumber(record.number_of_repairs);
    if (downtime !== null && repairs !== null) return true;
    // Also accept a pre-computed monthly MTTR plus repair count to reconstruct downtime.
    const monthlyMttr = normalizeKpiNumber(record.mttr_days);
    return monthlyMttr !== null && repairs !== null;
  }
  return false;
}

function computeYtdKpiValue(key: MonthlyKpiKey, records: PersistedMonthlyKpiRecord[]): number | null {
  if (key === "budgetSpend") {
    const actual = sumField(records, "actual_spend");
    const budget = sumField(records, "budget");
    return safeDivide(actual as number, budget as number) ? safeDivide(actual as number, budget as number)! * 100 : null;
  }
  if (key === "pmCmWorkOrderRatio") {
    const pm = sumField(records, "pm_work_orders");
    const cm = sumField(records, "cm_work_orders");
    return safeDivide(pm as number, (pm as number) + (cm as number)) ? safeDivide(pm as number, (pm as number) + (cm as number))! * 100 : null;
  }
  if (key === "pmCmCostRatio") {
    const pm = sumField(records, "pm_cost");
    const cm = sumField(records, "cm_cost");
    return safeDivide(pm as number, (pm as number) + (cm as number)) ? safeDivide(pm as number, (pm as number) + (cm as number))! * 100 : null;
  }
  if (key === "mttrDays") {
    let totalDowntime = 0;
    let totalRepairs = 0;
    records.forEach((record) => {
      const repairs = normalizeKpiNumber(record.repair_count) ?? normalizeKpiNumber(record.number_of_repairs);
      if (repairs === null) return;
      let downtime = normalizeKpiNumber(record.mttr_downtime) ?? normalizeKpiNumber(record.total_downtime);
      if (downtime === null) {
        const monthlyMttr = normalizeKpiNumber(record.mttr_days);
        if (monthlyMttr !== null) {
          downtime = monthlyMttr * repairs;
        }
      }
      if (downtime !== null) {
        totalDowntime += downtime;
        totalRepairs += repairs;
      }
    });
    return safeDivide(totalDowntime, totalRepairs);
  }
  return null;
}

export function computeMonthlyKpiValuesFromRaw(record: PersistedMonthlyKpiRecord): Partial<MonthlyKpiValues> {
  const values: Partial<MonthlyKpiValues> = {};
  monthlyKpiKeys.forEach((key) => {
    if (hasRawInputForKpi(key, record)) {
      const computed = computeMonthlyKpiValue(key, record);
      if (computed !== null) values[key] = computed;
    }
  });
  return values;
}

function selectedMonthRecord(records: PersistedMonthlyKpiRecord[], month: number) {
  return records.find((record) => Number(record.reporting_month) === month) || null;
}

function aggregateRecordsForBusinessUnit(
  businessUnit: string,
  reportingYear: number,
  records: PersistedMonthlyKpiRecord[],
  selectedMonth?: number
): BusinessUnitKpiAggregate {
  const aggregate = {
    ...emptyKpiValues(),
    businessUnit,
    reportingYear,
    recordCount: records.length,
  };

  const periodRecords = selectedMonth !== undefined
    ? records.filter((record) => Number(record.reporting_month) >= 1 && Number(record.reporting_month) <= selectedMonth)
    : records;

  monthlyKpiKeys.forEach((key) => {
    if (key === "scheduleCompliance" || key === "mtbfDays") {
      // Keep legacy average behavior for KPIs that are not part of the Summary Matrix.
      aggregate[key] = averageKpiValues(
        periodRecords.filter((record) => hasImportedKpiValue(record, key)).map((record) => record[sourceFieldByKpiKey[key]])
      );
      return;
    }

    if (selectedMonth === undefined) {
      // Full-year aggregate uses YTD/trend semantics when raw inputs exist.
      if (MONTHLY_ONLY_KEYS.includes(key)) {
        const values: number[] = [];
        records.forEach((record) => {
          if (hasRawInputForKpi(key, record)) {
            const computed = computeMonthlyKpiValue(key, record);
            if (computed !== null) values.push(computed);
          } else if (hasImportedKpiValue(record, key)) {
            const stored = normalizeKpiNumber(record[sourceFieldByKpiKey[key]]);
            if (stored !== null) values.push(stored);
          }
        });
        aggregate[key] = averageKpiValues(values);
        return;
      }
      if (YTD_KEYS.includes(key)) {
        const hasRawInputs = records.some((record) => hasRawInputForKpi(key, record));
        if (hasRawInputs) {
          aggregate[key] = computeYtdKpiValue(key, records);
          return;
        }
        aggregate[key] = averageKpiValues(
          records.filter((record) => hasImportedKpiValue(record, key)).map((record) => record[sourceFieldByKpiKey[key]])
        );
        return;
      }
      aggregate[key] = averageKpiValues(
        records.filter((record) => hasImportedKpiValue(record, key)).map((record) => record[sourceFieldByKpiKey[key]])
      );
      return;
    }

    if (MONTHLY_ONLY_KEYS.includes(key)) {
      // Running average of monthly KPI values up to the selected month.
      const values: number[] = [];
      periodRecords.forEach((record) => {
        if (hasRawInputForKpi(key, record)) {
          const computed = computeMonthlyKpiValue(key, record);
          if (computed !== null) values.push(computed);
        } else if (hasImportedKpiValue(record, key)) {
          const stored = normalizeKpiNumber(record[sourceFieldByKpiKey[key]]);
          if (stored !== null) values.push(stored);
        }
      });
      aggregate[key] = averageKpiValues(values);
      return;
    }

    if (YTD_KEYS.includes(key)) {
      const hasRawInputs = periodRecords.some((record) => hasRawInputForKpi(key, record));
      if (hasRawInputs) {
        aggregate[key] = computeYtdKpiValue(key, periodRecords);
      } else {
        // Fall back to the selected month's stored computed value when raw inputs are unavailable.
        const monthRecord = selectedMonthRecord(records, selectedMonth);
        if (monthRecord && hasImportedKpiValue(monthRecord, key)) {
          aggregate[key] = normalizeKpiNumber(monthRecord[sourceFieldByKpiKey[key]]);
        }
      }
      return;
    }

    aggregate[key] = averageKpiValues(
      periodRecords.filter((record) => hasImportedKpiValue(record, key)).map((record) => record[sourceFieldByKpiKey[key]])
    );
  });

  return aggregate;
}

function computePortfolioMonthlyActual(
  key: MonthlyKpiKey,
  monthlyRecords: PersistedMonthlyKpiRecord[]
): number | null {
  // Monthly actual for a single KPI in a single month across all BUs.
  // Prefer recomputing from raw inputs; fall back to stored computed KPI value.
  const values: number[] = [];
  monthlyRecords.forEach((record) => {
    if (hasRawInputForKpi(key, record)) {
      const computed = computeMonthlyKpiValue(key, record);
      if (computed !== null) values.push(computed);
    } else if (hasImportedKpiValue(record, key)) {
      const stored = normalizeKpiNumber(record[sourceFieldByKpiKey[key]]);
      if (stored !== null) values.push(stored);
    }
  });
  return averageKpiValues(values);
}

export function aggregateMonthlyKpiRecords(
  records: PersistedMonthlyKpiRecord[],
  reportingYear: number,
  selectedMonth?: number
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
    .map(([businessUnit, unitRecords]) => aggregateRecordsForBusinessUnit(businessUnit, reportingYear, unitRecords, selectedMonth))
    .sort((a, b) => a.businessUnit.localeCompare(b.businessUnit));

  const byBusinessUnitMap = byBusinessUnit.reduce<Record<string, BusinessUnitKpiAggregate>>((map, aggregate) => {
    map[aggregate.businessUnit] = aggregate;
    return map;
  }, {});

  const portfolioYearAverage = emptyKpiValues();
  monthlyKpiKeys.forEach((key) => {
    portfolioYearAverage[key] = averageKpiValues(byBusinessUnit.map((aggregate) => aggregate[key]));
  });

  // Build trend-ready monthly values. Kept as `portfolioMonthlyAverages` in the
  // returned object for API compatibility; internally we compute trend semantics
  // (running averages for monthly KPIs, cumulative/YTD for YTD KPIs).
  const portfolioMonthlyTrendValues = Array.from({ length: 12 }, (_, index) => index + 1).reduce<Record<number, MonthlyKpiValues>>(
    (months, month) => {
      const monthlyRecords = yearlyRecords.filter((record) => Number(record.reporting_month) === month);
      const periodRecords = yearlyRecords.filter((record) => Number(record.reporting_month) >= 1 && Number(record.reporting_month) <= month);
      const monthValues = emptyKpiValues();
      monthlyKpiKeys.forEach((key) => {
        const hasCurrentMonthData = monthlyRecords.some((record) => hasRawInputForKpi(key, record) || hasImportedKpiValue(record, key));
        if (!hasCurrentMonthData) {
          monthValues[key] = null;
          return;
        }
        if (MONTHLY_ONLY_KEYS.includes(key)) {
          // Running average of monthly KPI values up to this month.
          const values: number[] = [];
          periodRecords.forEach((record) => {
            if (hasRawInputForKpi(key, record)) {
              const computed = computeMonthlyKpiValue(key, record);
              if (computed !== null) values.push(computed);
            } else if (hasImportedKpiValue(record, key)) {
              const stored = normalizeKpiNumber(record[sourceFieldByKpiKey[key]]);
              if (stored !== null) values.push(stored);
            }
          });
          monthValues[key] = averageKpiValues(values);
          return;
        }
        if (YTD_KEYS.includes(key)) {
          // Cumulative/YTD value up to this month.
          const hasRawInputs = periodRecords.some((record) => hasRawInputForKpi(key, record));
          if (hasRawInputs) {
            monthValues[key] = computeYtdKpiValue(key, periodRecords);
          } else {
            monthValues[key] = averageKpiValues(
              monthlyRecords.filter((record) => hasImportedKpiValue(record, key)).map((record) => record[sourceFieldByKpiKey[key]])
            );
          }
          return;
        }
        // Legacy/default: per-month average.
        const recordsWithRaw = monthlyRecords.filter((record) => hasRawInputForKpi(key, record));
        if (recordsWithRaw.length > 0) {
          monthValues[key] = averageKpiValues(recordsWithRaw.map((record) => computeMonthlyKpiValue(key, record)));
        } else {
          monthValues[key] = averageKpiValues(
            monthlyRecords.filter((record) => hasImportedKpiValue(record, key)).map((record) => record[sourceFieldByKpiKey[key]])
          );
        }
      });
      months[month] = monthValues;
      return months;
    },
    {}
  );

  // Build per-month actual monthly values averaged across BUs.
  const portfolioMonthlyActualValues = Array.from({ length: 12 }, (_, index) => index + 1).reduce<Record<number, MonthlyKpiValues>>(
    (months, month) => {
      const monthlyRecords = yearlyRecords.filter((record) => Number(record.reporting_month) === month);
      const monthValues = emptyKpiValues();
      monthlyKpiKeys.forEach((key) => {
        monthValues[key] = computePortfolioMonthlyActual(key, monthlyRecords);
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
    // Historical field name retained for API compatibility; see TSDoc above.
    portfolioMonthlyAverages: portfolioMonthlyTrendValues,
    portfolioMonthlyActuals: portfolioMonthlyActualValues,
  };
}
