/**
 * Monthly KPI — All Business Units presentation data (server-only).
 *
 * Pure data shaping for the All-Business-Units Monthly KPI deck. No database
 * access: records are passed in (already scoped to one reporting year).
 *
 * The deck follows the same authoritative rules as the live scorecard:
 *  - effective reporting month resolution over the complete portfolio
 *    (resolveEffectiveReportingMonth from kpiAggregation);
 *  - per-BU KPI values at the effective month: Group A (Budget Spend, PM:CM
 *    Work Orders, PM:CM Cost, MTTR) = YTD/cumulative Jan->E; Group B (PM
 *    Compliance, Facility Uptime) = YTD average of the standalone monthly
 *    values Jan->E;
 *  - per-BU monthly trend series stop at the effective month (or the BU's own
 *    last submitted month when it lags behind the portfolio) and never plot
 *    future/unsubmitted months as zero;
 *  - commentary bullets come only from that BU's stored Notes and the derived
 *    Situation for the effective reporting period.
 */

import {
  aggregateMonthlyKpiRecords,
  computeMonthlyKpiValuesFromRaw,
  normalizeBusinessUnitLabel,
  normalizeKpiNumber,
  resolveEffectiveReportingMonth,
  type PersistedMonthlyKpiRecord,
} from "./kpiAggregation";
import {
  formatThresholdBenchmark,
  getDefaultMonthlyKpiThresholdConfig,
} from "./kpiThresholds";

export const ALL_BUSINESS_UNITS_LABEL = "All Business Units";

export type ScorecardKpiKey2 =
  | "pmCompliance"
  | "budgetSpend"
  | "pmCmWorkOrderRatio"
  | "pmCmCostRatio"
  | "mttrDays"
  | "facilityUptime";

const SCORECARD_KPI_KEYS: ScorecardKpiKey2[] = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mttrDays",
  "facilityUptime",
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const KPI_DISPLAY: Record<ScorecardKpiKey2, string> = {
  pmCompliance: "PM Compliance",
  budgetSpend: "Budget Spend",
  pmCmWorkOrderRatio: "PM:CM Ratio (Work Orders)",
  pmCmCostRatio: "PM:CM Ratio (Cost)",
  mttrDays: "MTTR",
  facilityUptime: "Facility Uptime",
};

const CHART_LABELS: Record<ScorecardKpiKey2, string> = {
  pmCompliance: "PM Compliance (%)",
  budgetSpend: "Budget Spend (%)",
  pmCmWorkOrderRatio: "PM:CM — Work Orders (%)",
  pmCmCostRatio: "PM:CM — Cost (%)",
  mttrDays: "MTTR (Days)",
  facilityUptime: "Facility Uptime (%)",
};

export interface MonthlyKpiKpiValue2 {
  key: ScorecardKpiKey2;
  label: string;
  value: number | null;
  formatted: string;
  benchmark: string;
}

export interface BusinessUnitTrendPoint {
  month: number;
  monthLabel: string;
  // Group A - YTD/cumulative through the month.
  budgetSpend: number | null;
  pmCmWorkOrderRatio: number | null;
  pmCmCostRatio: number | null;
  mttrDays: number | null;
  // Group B - monthly standalone actual.
  pmComplianceMonthly: number | null;
  facilityUptimeMonthly: number | null;
  // Group B - YTD average of the standalone monthly values.
  pmComplianceYtdAverage: number | null;
  facilityUptimeYtdAverage: number | null;
}

export interface BusinessUnitDeckSection {
  businessUnit: string;
  summary: MonthlyKpiKpiValue2[];
  trends: BusinessUnitTrendPoint[];
  notes: string | null;
  situationBullets: string[];
  /** Slide reporting period: the ONE common portfolio effective month for the
   * whole deck (never a per-BU relabel). Chart data may stop at the BU's own
   * last submitted month, but the slide header stays the common period. */
  reportingMonth: number;
  reportingMonthLabel: string;
}

export interface AllBusinessUnitsDeckData {
  reportingYear: number;
  requestedReportingMonth: number;
  effectiveReportingMonth: number;
  effectiveReportingMonthLabel: string;
  sections: BusinessUnitDeckSection[];
}

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatValue(key: ScorecardKpiKey2, value: number | null): string {
  if (!isPresentNumber(value)) return "No Data";
  if (key === "mttrDays") return `${value.toFixed(2)} days`;
  if (key === "pmCmWorkOrderRatio" || key === "pmCmCostRatio") {
    if (value >= 100) return "No CM";
    const cmShare = 100 - value;
    if (cmShare <= 0) return "No CM";
    return `${value.toFixed(1)}% (${(value / cmShare).toFixed(1)}:1)`;
  }
  return `${value.toFixed(2)}%`;
}

function benchmarkText(key: ScorecardKpiKey2): string {
  const config = getDefaultMonthlyKpiThresholdConfig();
  const rule =
    config[key as keyof ReturnType<typeof getDefaultMonthlyKpiThresholdConfig>];
  return rule ? formatThresholdBenchmark(rule) : "";
}

/** Split free-form commentary into trimmed, non-empty, de-duplicated bullets. */
export function normalizeCommentaryBullets(
  values: Array<string | null | undefined>
): string[] {
  const bullets: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const trimmed = value
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^[•\-*\s]+/, "");
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    bullets.push(trimmed);
  };
  for (const value of values) {
    if (!value) continue;
    for (const part of String(value).split(/\r?\n+/)) {
      const sentence = part.trim();
      if (!sentence) continue;
      push(sentence);
    }
  }
  return bullets;
}

function recordForMonth(
  records: PersistedMonthlyKpiRecord[],
  businessUnit: string,
  year: number,
  month: number
) {
  return (
    records.find(
      record =>
        normalizeBusinessUnitLabel(record.business_unit) === businessUnit &&
        Number(record.reporting_year) === year &&
        Number(record.reporting_month) === month
    ) || null
  );
}

/** Latest month <= cap in which this BU has a stored KPI value or raw inputs. */
function latestSubmittedMonthForBusinessUnit(
  records: PersistedMonthlyKpiRecord[],
  businessUnit: string,
  year: number,
  cap: number
): number {
  for (let month = cap; month >= 1; month -= 1) {
    const record = recordForMonth(records, businessUnit, year, month);
    if (
      record &&
      SCORECARD_KPI_KEYS.some(key => kpiIsPresentForRecord(record, key))
    ) {
      return month;
    }
  }
  return 0;
}

function kpiIsPresentForRecord(
  record: PersistedMonthlyKpiRecord,
  key: ScorecardKpiKey2
): boolean {
  const fieldByKey: Partial<
    Record<ScorecardKpiKey2, keyof PersistedMonthlyKpiRecord>
  > = {
    pmCompliance: "pm_compliance",
    budgetSpend: "budget_spend",
    pmCmWorkOrderRatio: "pm_cm_work_order_ratio",
    pmCmCostRatio: "pm_cm_cost_ratio",
    mttrDays: "mttr_days",
    facilityUptime: "facility_uptime",
  };
  const field = fieldByKey[key];
  if (
    field &&
    normalizeKpiNumber(record[field] as number | string | null) !== null
  )
    return true;
  const raw = computeMonthlyKpiValuesFromRaw(record);
  return raw[key] !== undefined && raw[key] !== null;
}

function standaloneMonthlyKpis(record: PersistedMonthlyKpiRecord | null) {
  if (!record) return { pmCompliance: null, facilityUptime: null };
  const computed = computeMonthlyKpiValuesFromRaw(record);
  const storedPm = normalizeKpiNumber(record.pm_compliance);
  const storedUptime = normalizeKpiNumber(record.facility_uptime);
  return {
    pmCompliance: computed.pmCompliance ?? storedPm,
    facilityUptime: computed.facilityUptime ?? storedUptime,
  };
}

function derivedSituationForBusinessUnit(
  records: PersistedMonthlyKpiRecord[],
  businessUnit: string,
  year: number,
  month: number
): string[] {
  const record = recordForMonth(records, businessUnit, year, month);
  const reasons: string[] = [];
  const push = (message: string) => {
    if (!reasons.includes(message)) reasons.push(message);
  };

  // A KPI is "submitted" for the period when valid raw source data or a valid
  // stored KPI value exists. Only genuinely missing KPIs may receive a
  // "not submitted" bullet; neutral reasons are emitted only for the exact
  // authoritative conditions that make the KPI non-computable.
  const has = (key: ScorecardKpiKey2) =>
    !!record && kpiIsPresentForRecord(record, key);

  if (!has("pmCompliance")) {
    if (record && normalizeKpiNumber(record.total_pm_orders) === 0)
      push("Not Applicable (no PM orders)");
    else push("PM Compliance not submitted");
  }
  if (!has("facilityUptime")) {
    if (record && normalizeKpiNumber(record.facility_operating_time) === 0)
      push("Not Applicable (no operating time)");
    else push("Facility Uptime not submitted");
  }
  if (!has("budgetSpend")) {
    if (record && normalizeKpiNumber(record.budget) === 0) push("No Budget");
    else push("Budget Spend not submitted");
  }
  if (!has("pmCmWorkOrderRatio")) {
    const pm = record ? normalizeKpiNumber(record.pm_work_orders) : null;
    const cm = record ? normalizeKpiNumber(record.cm_work_orders) : null;
    if (pm === 0 && cm === 0) push("No Work Orders");
    else push("PM:CM Work Orders not submitted");
  }
  if (!has("pmCmCostRatio")) {
    const cm = record ? normalizeKpiNumber(record.cm_cost) : null;
    // The ratio is non-computable AND there is definitively no CM cost value
    // in the record: the authoritative neutral reason is "No CM Cost", never a
    // false "PM:CM Cost not submitted". A present, non-zero cm_cost with the
    // PM side also present is computable and therefore already skipped by has().
    if (cm === 0) push("No CM Cost");
    else push("PM:CM Cost not submitted");
  }
  if (!has("mttrDays")) {
    const repairs = record
      ? (normalizeKpiNumber(record.repair_count) ??
        normalizeKpiNumber(record.number_of_repairs))
      : null;
    const downtime = record
      ? (normalizeKpiNumber(record.mttr_downtime) ??
        normalizeKpiNumber(record.total_downtime))
      : null;
    const monthlyMttr = record ? normalizeKpiNumber(record.mttr_days) : null;
    if (repairs === 0 || (downtime === 0 && monthlyMttr === 0))
      push("No Qualifying Downtime");
    else push("MTTR not submitted");
  }
  return reasons;
}

export function buildAllBusinessUnitsDeckData(
  records: PersistedMonthlyKpiRecord[],
  reportingYear: number,
  requestedMonth?: number
): AllBusinessUnitsDeckData {
  const effective = resolveEffectiveReportingMonth(records, requestedMonth);
  const effectiveMonth = effective ?? requestedMonth ?? 0;

  const aggregateAt = (month: number) =>
    aggregateMonthlyKpiRecords(records, reportingYear, month);
  const effectiveAggregate =
    effectiveMonth >= 1 ? aggregateAt(effectiveMonth) : null;
  const businessUnits = effectiveAggregate
    ? effectiveAggregate.byBusinessUnit.map(aggregate => aggregate.businessUnit)
    : Array.from(
        new Set(
          records
            .map(record => normalizeBusinessUnitLabel(record.business_unit))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))
        )
      );

  const sections = businessUnits.map(businessUnit => {
    const buRecords = records.filter(
      record =>
        normalizeBusinessUnitLabel(record.business_unit) === businessUnit &&
        Number(record.reporting_year) === reportingYear
    );
    // The BU's own last actual submitted month inside the common effective
    // window (charts stop there; slide headers still use the common period).
    const buLastSubmitted =
      effectiveMonth >= 1
        ? latestSubmittedMonthForBusinessUnit(
            buRecords,
            businessUnit,
            reportingYear,
            effectiveMonth
          )
        : 0;
    const reportingMonth = effectiveMonth;
    const reportingMonthLabel =
      effectiveMonth >= 1
        ? `${MONTH_NAMES[effectiveMonth - 1] ?? ""} ${reportingYear}`.trim()
        : "";

    let summary: MonthlyKpiKpiValue2[];
    if (effectiveAggregate) {
      const aggregate = effectiveAggregate.byBusinessUnitMap[businessUnit];
      summary = SCORECARD_KPI_KEYS.map(key => {
        const value = aggregate ? (aggregate[key] as number | null) : null;
        return {
          key,
          label: KPI_DISPLAY[key],
          value,
          formatted:
            value === null || value === undefined
              ? "No Data"
              : formatValue(key, value),
          benchmark: benchmarkText(key),
        };
      });
    } else {
      summary = SCORECARD_KPI_KEYS.map(key => ({
        key,
        label: KPI_DISPLAY[key],
        value: null,
        formatted: "No Data",
        benchmark: benchmarkText(key),
      }));
    }

    const trends: BusinessUnitTrendPoint[] = [];
    const trendEnd = Math.max(0, Math.min(effectiveMonth, buLastSubmitted));
    for (let month = 1; month <= trendEnd; month += 1) {
      const monthlyAggregate =
        aggregateAt(month).byBusinessUnitMap[businessUnit];
      const record = recordForMonth(
        buRecords,
        businessUnit,
        reportingYear,
        month
      );
      const standalone = standaloneMonthlyKpis(record);
      trends.push({
        month,
        monthLabel: SHORT_MONTH_NAMES[month - 1] ?? String(month),
        budgetSpend: monthlyAggregate ? monthlyAggregate.budgetSpend : null,
        pmCmWorkOrderRatio: monthlyAggregate
          ? monthlyAggregate.pmCmWorkOrderRatio
          : null,
        pmCmCostRatio: monthlyAggregate ? monthlyAggregate.pmCmCostRatio : null,
        mttrDays: monthlyAggregate ? monthlyAggregate.mttrDays : null,
        pmComplianceMonthly: standalone.pmCompliance,
        facilityUptimeMonthly: standalone.facilityUptime,
        pmComplianceYtdAverage: monthlyAggregate
          ? monthlyAggregate.pmCompliance
          : null,
        facilityUptimeYtdAverage: monthlyAggregate
          ? monthlyAggregate.facilityUptime
          : null,
      });
    }

    // Notes and Situation correspond to the effective reporting period record.
    // Earlier-month notes are never silently relabeled as the effective month.
    const effectiveRecord = recordForMonth(
      buRecords,
      businessUnit,
      reportingYear,
      effectiveMonth
    );
    const notes = effectiveRecord?.notes
      ? String(effectiveRecord.notes).trim() || null
      : null;
    const situationBullets = derivedSituationForBusinessUnit(
      buRecords,
      businessUnit,
      reportingYear,
      effectiveMonth
    );

    return {
      businessUnit,
      summary,
      trends,
      notes,
      situationBullets,
      reportingMonth,
      reportingMonthLabel,
    };
  });

  const effectiveMonthLabel =
    effectiveMonth >= 1
      ? `${MONTH_NAMES[effectiveMonth - 1] ?? ""} ${reportingYear}`.trim()
      : `${requestedMonth ?? ""} ${reportingYear}`.trim();

  return {
    reportingYear,
    requestedReportingMonth: requestedMonth ?? effectiveMonth,
    effectiveReportingMonth: effectiveMonth,
    effectiveReportingMonthLabel: effectiveMonthLabel,
    sections,
  };
}

export { KPI_DISPLAY, CHART_LABELS, SCORECARD_KPI_KEYS };
