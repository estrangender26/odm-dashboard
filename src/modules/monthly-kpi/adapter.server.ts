/**
 * Monthly KPI Scorecard Data Adapter (Server-Only)
 *
 * Fetches production Monthly KPI records from the database and transforms
 * them into the canonical 3-slide scorecard presentation model.
 *
 * @server-only
 */

import { db } from "@db/connection";
import { sql } from "drizzle-orm";
import {
  aggregateMonthlyKpiRecords,
  normalizeBusinessUnitLabel,
  normalizeKpiNumber,
  type PersistedMonthlyKpiRecord,
} from "./kpiAggregation";
import {
  evaluateKpiStatus,
  formatThresholdBenchmark,
  getDefaultMonthlyKpiThresholdConfig,
} from "./kpiThresholds";
import type {
  BusinessUnitScorecard,
  KpiStatus,
  MonthlyKpiExecutiveReadout,
  MonthlyKpiTrendRow,
  MonthlyKpiValue,
  ScorecardKpiKey,
  MonthlyKpiPresentation,
} from "./types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ALL_BUSINESS_UNITS_LABEL = "All Business Units";

const SCORECARD_KPI_KEYS: ScorecardKpiKey[] = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mttrDays",
  "facilityUptime",
];

const sourceFieldByKpiKey: Record<ScorecardKpiKey, keyof PersistedMonthlyKpiRecord> = {
  pmCompliance: "pm_compliance",
  budgetSpend: "budget_spend",
  pmCmWorkOrderRatio: "pm_cm_work_order_ratio",
  pmCmCostRatio: "pm_cm_cost_ratio",
  mttrDays: "mttr_days",
  facilityUptime: "facility_uptime",
};

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatMetricValue(key: ScorecardKpiKey, value: number | null): string {
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

function toKpiValue(key: ScorecardKpiKey, value: number | null): MonthlyKpiValue {
  const config = getDefaultMonthlyKpiThresholdConfig();
  let status: KpiStatus;
  if (!isPresentNumber(value)) {
    status = "no-data";
  } else if (key === "mttrDays") {
    status = "provisional";
  } else {
    const evalStatus = evaluateKpiStatus(key, value, config).status;
    status = evalStatus === "green" ? "success" : evalStatus === "amber" ? "warning" : "danger";
  }
  return {
    value,
    status,
    formatted: formatMetricValue(key, value),
  };
}

function rowsFromDb(result: unknown): Record<string, unknown>[] {
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function buildMonthlyTrend(
  records: PersistedMonthlyKpiRecord[],
  businessUnit: string,
  reportingYear: number
): MonthlyKpiTrendRow[] {
  const normalizedBu = normalizeBusinessUnitLabel(businessUnit);
  const buRecords = records
    .filter(
      (r) =>
        normalizeBusinessUnitLabel(r.business_unit) === normalizedBu &&
        Number(r.reporting_year) === reportingYear
    )
    .sort((a, b) => Number(a.reporting_month) - Number(b.reporting_month));

  return buRecords.map((record) => {
    const month = Number(record.reporting_month);
    const values = Object.fromEntries(
      SCORECARD_KPI_KEYS.map((key) => [
        key,
        toKpiValue(key, normalizeKpiNumber(record[sourceFieldByKpiKey[key]] as number | string | null)),
      ])
    ) as Record<ScorecardKpiKey, MonthlyKpiValue>;
    return {
      month,
      monthLabel: MONTH_NAMES[month - 1] ?? `Month ${month}`,
      values,
    };
  });
}

function buildYtdRecord(
  aggregate: { businessUnit: string; reportingYear: number; recordCount: number } & Record<ScorecardKpiKey, number | null>
): Record<ScorecardKpiKey, MonthlyKpiValue> {
  return Object.fromEntries(
    SCORECARD_KPI_KEYS.map((key) => [key, toKpiValue(key, aggregate[key])])
  ) as Record<ScorecardKpiKey, MonthlyKpiValue>;
}

function buildScorecard(
  records: PersistedMonthlyKpiRecord[],
  aggregate: { businessUnit: string; reportingYear: number; recordCount: number } & Record<ScorecardKpiKey, number | null>
): BusinessUnitScorecard {
  const ytd = buildYtdRecord(aggregate);
  const monthlyTrend = buildMonthlyTrend(records, aggregate.businessUnit, aggregate.reportingYear);
  const wins: string[] = [];
  const risks: string[] = [];
  const actions: string[] = [];
  const config = getDefaultMonthlyKpiThresholdConfig();

  type Field = { key: ScorecardKpiKey; label: string; isRange: boolean };
  const fields: Field[] = [
    { key: "pmCompliance", label: "PM compliance", isRange: false },
    { key: "facilityUptime", label: "Facility uptime", isRange: false },
    { key: "budgetSpend", label: "Budget spend", isRange: true },
    { key: "pmCmWorkOrderRatio", label: "PM:CM work order ratio", isRange: false },
    { key: "pmCmCostRatio", label: "PM:CM cost ratio", isRange: false },
  ];

  for (const field of fields) {
    const v = ytd[field.key].value;
    if (!isPresentNumber(v)) continue;
    const evalStatus = evaluateKpiStatus(field.key, v, config).status;
    const benchmark = formatThresholdBenchmark(config[field.key]);
    if (field.isRange) {
      if (evalStatus === "green") {
        wins.push(`${field.label} stayed within the ${benchmark} control band.`);
      } else if (evalStatus === "amber" || evalStatus === "red") {
        risks.push(`${field.label} is outside the ${benchmark} control band.`);
        actions.push(`Validate planned-versus-actual ${field.label.toLowerCase()} drivers.`);
      }
    } else {
      if (evalStatus === "green") {
        wins.push(`${field.label} met or exceeded the ${benchmark} benchmark.`);
      } else if (evalStatus === "amber") {
        risks.push(`${field.label} is in the warning band against the ${benchmark} benchmark.`);
        actions.push(`Review ${field.label.toLowerCase()} drivers and recovery actions.`);
      } else if (evalStatus === "red") {
        risks.push(`${field.label} is below the ${benchmark} benchmark.`);
        actions.push(`Confirm recovery actions for ${field.label.toLowerCase()}.`);
      }
    }
  }

  if (isPresentNumber(ytd.mttrDays.value)) {
    wins.push("MTTR data is available for the period (provisional).");
  }

  return {
    businessUnit: aggregate.businessUnit,
    monthlyTrend,
    ytd,
    notes: null,
    majorWins: wins.length ? wins : ["Imported KPI data is available for review."],
    majorRisks: risks.length ? risks : ["No critical KPI risks identified from imported values."],
    actionItems: actions.length ? actions : ["Continue monthly KPI monitoring and validation."],
  };
}

function buildExecutiveReadout(
  selectedBu: BusinessUnitScorecard,
  _allBus: BusinessUnitScorecard[],
  portfolioYtd: Record<ScorecardKpiKey, MonthlyKpiValue>,
  reportingMonthLabel: string
): MonthlyKpiExecutiveReadout {
  const slide1Observation =
    `${selectedBu.businessUnit} YTD performance: ` +
    `PM compliance ${selectedBu.ytd.pmCompliance.formatted}, ` +
    `budget spend ${selectedBu.ytd.budgetSpend.formatted}, ` +
    `MTTR ${selectedBu.ytd.mttrDays.formatted}. ` +
    (selectedBu.majorRisks[0] ?? "Continue monthly KPI monitoring and validation.");

  const portfolioPm = portfolioYtd.pmCompliance.formatted;
  const portfolioUptime = portfolioYtd.facilityUptime.formatted;
  // Keep the executive summary to a concise maximum of two lines so it does
  // not overlap the legend or table in the All-BU slide.
  const slide2Observation =
    `Portfolio PM compliance is ${portfolioPm}, while facility uptime is ${portfolioUptime}. ` +
    "Priority recovery is required for BU-level PM compliance, budget control and missing submissions.";

  // Slide 3 action cards are deliberately aligned with the color-coded issue
  // categories in the issues matrix:
  //   PM RECOVERY (red)     — confirmed performance gaps
  //   DATA CLOSURE (yellow) — missing KPI submissions
  //   VALIDATION (blue)     — provisional or questionable metrics
  const slide3Actions = [
    "Recover EWG and TWCI against BU-level PM and uptime targets.",
    "Close missing Budget Spend, PM:CM Cost, MTTR and WAWA/JVC submissions.",
    "Confirm MTTR scope and validate CWC's 307:1 work-order ratio.",
  ];

  const dataNote =
    `Data note: RAG uses unrounded YTD values. *MTTR remains provisional where validation is pending. ` +
    `Reporting period: ${reportingMonthLabel}.`;

  return {
    slide1Observation,
    slide2Observation,
    slide3Actions,
    dataNote,
  };
}

export async function fetchMonthlyKpiPresentationData(
  reportingYear: number,
  reportingMonth: number,
  selectedBusinessUnit?: string | null
): Promise<MonthlyKpiPresentation> {
  const normalizedSelection = selectedBusinessUnit
    ? normalizeBusinessUnitLabel(selectedBusinessUnit)
    : ALL_BUSINESS_UNITS_LABEL;

  const result = await db.execute(sql`
    SELECT
      id,
      business_unit,
      reporting_month,
      reporting_year,
      source_file_name,
      imported_at,
      pm_compliance,
      pm_planned,
      schedule_compliance,
      budget_spend,
      pm_cm_work_order_ratio,
      pm_cm_cost_ratio,
      mtbf_days,
      mttr_days,
      facility_uptime,
      actual_spend,
      budget,
      pm_orders_completed_on_time,
      total_pm_orders,
      pm_work_orders,
      cm_work_orders,
      pm_cost,
      cm_cost,
      total_downtime,
      number_of_repairs,
      total_operating_time,
      source_sheet,
      import_batch_id,
      notes,
      raw_imported_values
    FROM monthly_kpi_records
    WHERE reporting_year = ${reportingYear}
    ORDER BY business_unit ASC, reporting_month ASC
  `);

  const rows = rowsFromDb(result);
  if (rows.length === 0) {
    throw new Error("No Monthly KPI records exist for the selected reporting year.");
  }

  const records = rows.map((row) => ({
    id: row.id,
    business_unit: row.business_unit,
    reporting_month: row.reporting_month,
    reporting_year: row.reporting_year,
    source_file_name: row.source_file_name,
    imported_at: row.imported_at,
    pm_compliance: row.pm_compliance,
    pm_planned: row.pm_planned,
    schedule_compliance: row.schedule_compliance,
    budget_spend: row.budget_spend,
    pm_cm_work_order_ratio: row.pm_cm_work_order_ratio,
    pm_cm_cost_ratio: row.pm_cm_cost_ratio,
    mtbf_days: row.mtbf_days,
    mttr_days: row.mttr_days,
    facility_uptime: row.facility_uptime,
    actual_spend: row.actual_spend,
    budget: row.budget,
    pm_orders_completed_on_time: row.pm_orders_completed_on_time,
    total_pm_orders: row.total_pm_orders,
    pm_work_orders: row.pm_work_orders,
    cm_work_orders: row.cm_work_orders,
    pm_cost: row.pm_cost,
    cm_cost: row.cm_cost,
    total_downtime: row.total_downtime,
    number_of_repairs: row.number_of_repairs,
    total_operating_time: row.total_operating_time,
    source_sheet: row.source_sheet,
    import_batch_id: row.import_batch_id,
    notes: row.notes,
    raw_imported_values: row.raw_imported_values,
  })) as PersistedMonthlyKpiRecord[];

  const aggregateResult = aggregateMonthlyKpiRecords(records, reportingYear, reportingMonth);
  const allBus = aggregateResult.byBusinessUnit.map((agg) => buildScorecard(records, agg));

  const selectedBu =
    allBus.find((bu) => bu.businessUnit === normalizedSelection) ??
    allBus.find((bu) => bu.businessUnit === "AMD-EZ") ??
    allBus[0];

  const portfolioYtd = buildYtdRecord(
    aggregateResult.portfolioYearAverage as unknown as { businessUnit: string; reportingYear: number; recordCount: number } & Record<ScorecardKpiKey, number | null>
  );

  const executive = buildExecutiveReadout(
    selectedBu,
    allBus,
    portfolioYtd,
    `${MONTH_NAMES[reportingMonth - 1]} ${reportingYear}`
  );

  return {
    generatedAt: new Date().toISOString(),
    reportingYear,
    reportingMonth,
    reportingMonthLabel: `${MONTH_NAMES[reportingMonth - 1]} ${reportingYear}`,
    selectedBusinessUnit: normalizedSelection,
    businessUnits: allBus.map((bu) => bu.businessUnit),
    buScorecards: allBus,
    portfolioYtd,
    executive,
  };
}
