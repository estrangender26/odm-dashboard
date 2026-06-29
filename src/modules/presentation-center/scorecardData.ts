import {
  aggregateMonthlyKpiRecords,
  monthlyKpiKeys,
  normalizeBusinessUnitLabel,
  normalizeKpiNumber,
  type PersistedMonthlyKpiRecord,
} from "../monthly-kpi/kpiAggregation";
import {
  evaluateKpiStatus,
  formatThresholdBenchmark,
  getDefaultMonthlyKpiThresholdConfig,
} from "../monthly-kpi/kpiThresholds";
import type { MonthlyKpiTemplate } from "./types";

export type KpiRecord = {
  businessUnit: string;
  reportingMonth?: number;
  reportingYear?: number;
  pmCompliance: number | null;
  budgetSpend: number | null;
  pmCmWorkOrderRatio: number | null;
  pmCmCostRatio: number | null;
  mttrDays: number | null;
  facilityUptime: number | null;
  notes?: string | null;
  majorWins: string[];
  majorRisks: string[];
  actionItems: string[];
};

export const ALL_BUSINESS_UNITS_LABEL = "All Business Units";

export const EXECUTIVE_SCORECARD_TEMPLATE: MonthlyKpiTemplate =
  "Executive Scorecard";

export const MONTHLY_KPI_TEMPLATE_OPTIONS = [
  EXECUTIVE_SCORECARD_TEMPLATE,
] as const;

export const MONTHLY_KPI_BUSINESS_UNITS = [
  "AMD-EZ",
  "Laguna Water",
  "Clark Water",
  "Tagum Water",
  "Estate Water",
  "LARC",
] as const;

export const MONTH_NAMES = [
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
] as const;

export type MonthlyKpiRecordsRequest = {
  reportingYear: number;
  reportingMonth: number;
  businessUnit?: string | null;
};

export type MonthlyKpiAvailableOptions = {
  years: number[];
  months: number[];
  businessUnits: string[];
};

export type MonthlyKpiScorecardDataset = {
  records: KpiRecord[];
  ytdRecords: KpiRecord[];
  reportingYear: number;
  reportingMonth: number;
  reportingMonthLabel: string;
  businessUnit: string;
  template: MonthlyKpiTemplate;
};

const defaultThresholds = getDefaultMonthlyKpiThresholdConfig();

export const scorecardBenchmarks = [
  {
    key: "pmCompliance",
    label: "PM Compliance",
    benchmark: formatThresholdBenchmark(defaultThresholds.pmCompliance),
  },
  {
    key: "budgetSpend",
    label: "Maintenance Budget Spend",
    benchmark: formatThresholdBenchmark(defaultThresholds.budgetSpend),
  },
  {
    key: "pmCmWorkOrderRatio",
    label: "PM:CM Ratio (WO)",
    benchmark: formatThresholdBenchmark(defaultThresholds.pmCmWorkOrderRatio),
  },
  {
    key: "pmCmCostRatio",
    label: "PM:CM Ratio (Cost)",
    benchmark: formatThresholdBenchmark(defaultThresholds.pmCmCostRatio),
  },
  { key: "mttrDays", label: "MTTR", benchmark: "Data exists" },
  {
    key: "facilityUptime",
    label: "Facility Uptime",
    benchmark: formatThresholdBenchmark(defaultThresholds.facilityUptime),
  },
  { key: "notes", label: "Notes", benchmark: "Commentary" },
] as const;

export const currentMonthlyKpiScorecard: KpiRecord[] = [
  {
    businessUnit: "AMD-EZ",
    pmCompliance: 96.4,
    budgetSpend: 101.3,
    pmCmWorkOrderRatio: 88.2,
    pmCmCostRatio: 63.8,
    mttrDays: 3.2,
    facilityUptime: 99.98,
    notes: "Transformer overhaul completed this month.",
    majorWins: [
      "PM compliance exceeded the 95% benchmark.",
      "Facility uptime remained above target.",
    ],
    majorRisks: ["Budget spend is trending near the upper control band."],
    actionItems: [
      "Review cost drivers for high-spend work orders.",
      "Keep weekly follow-up on PM closure quality.",
    ],
  },
];

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function evaluateAggregatedRecord(record: KpiRecord): KpiRecord {
  const wins: string[] = [];
  const risks: string[] = [];
  const actions: string[] = [];
  const config = getDefaultMonthlyKpiThresholdConfig();

  type ThresholdField = {
    key: "pmCompliance" | "budgetSpend" | "pmCmWorkOrderRatio" | "pmCmCostRatio" | "facilityUptime" | "mttrDays";
    value: number | null;
    label: string;
    isRange: boolean;
  };

  const fields: ThresholdField[] = [
    { key: "pmCompliance", value: record.pmCompliance, label: "PM compliance", isRange: false },
    { key: "facilityUptime", value: record.facilityUptime, label: "Facility uptime", isRange: false },
    { key: "budgetSpend", value: record.budgetSpend, label: "Budget spend", isRange: true },
    { key: "pmCmWorkOrderRatio", value: record.pmCmWorkOrderRatio, label: "PM:CM work order ratio", isRange: false },
    { key: "pmCmCostRatio", value: record.pmCmCostRatio, label: "PM:CM cost ratio", isRange: false },
    { key: "mttrDays", value: record.mttrDays, label: "MTTR", isRange: false },
  ];

  for (const field of fields) {
    if (!isPresentNumber(field.value)) continue;
    const status = evaluateKpiStatus(field.key, field.value, config).status;
    if (field.key === "mttrDays") {
      if (status === "green") {
        wins.push("MTTR data is available for the period.");
      }
      continue;
    }

    const benchmark = formatThresholdBenchmark(config[field.key]);
    if (field.isRange) {
      if (status === "green") {
        wins.push(`${field.label} stayed within the ${benchmark} control band.`);
      } else if (status === "amber" || status === "red") {
        risks.push(`${field.label} is outside the ${benchmark} control band.`);
        actions.push(`Validate planned-versus-actual ${field.label.toLowerCase()} drivers.`);
      }
    } else {
      if (status === "green") {
        wins.push(`${field.label} met or exceeded the ${benchmark} benchmark.`);
      } else if (status === "amber") {
        risks.push(`${field.label} is in the warning band against the ${benchmark} benchmark.`);
        actions.push(`Review ${field.label.toLowerCase()} drivers and recovery actions.`);
      } else if (status === "red") {
        risks.push(`${field.label} is below the ${benchmark} benchmark.`);
        actions.push(`Confirm recovery actions for ${field.label.toLowerCase()}.`);
      }
    }
  }

  return {
    ...record,
    majorWins: wins.length
      ? wins
      : ["Imported KPI data is available for review."],
    majorRisks: risks.length
      ? risks
      : ["No critical KPI risks identified from imported values."],
    actionItems: actions.length
      ? actions
      : ["Continue monthly KPI monitoring and validation."],
  };
}

export function getReportingMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function getReportingPeriodLabel(
  reportingMonth: number,
  reportingYear: number
) {
  const monthName =
    MONTH_NAMES[reportingMonth - 1] || `Month ${reportingMonth}`;
  return `${monthName} ${reportingYear}`;
}

export function getScorecardSummary(records = currentMonthlyKpiScorecard) {
  const total = records.length;
  const pmPassed = records.filter(
    record => isPresentNumber(record.pmCompliance) && record.pmCompliance >= 95
  ).length;
  const uptimePassed = records.filter(
    record =>
      isPresentNumber(record.facilityUptime) && record.facilityUptime >= 99.97
  ).length;
  const risks = records.flatMap(record => record.majorRisks);
  const wins = records.flatMap(record => record.majorWins);
  return {
    highlights: [
      `${pmPassed} of ${total} business units are meeting PM compliance target.`,
      `${uptimePassed} of ${total} business units are meeting facility uptime target.`,
    ],
    wins: wins.slice(0, 5),
    risks: risks.slice(0, 5),
    concerns: risks.slice(0, 4),
    actions: records.flatMap(record => record.actionItems).slice(0, 6),
  };
}

function toKpiRecord(
  aggregate: ReturnType<
    typeof aggregateMonthlyKpiRecords
  >["byBusinessUnit"][number]
): KpiRecord {
  return evaluateAggregatedRecord({
    businessUnit: aggregate.businessUnit,
    reportingYear: aggregate.reportingYear,
    pmCompliance: aggregate.pmCompliance,
    budgetSpend: aggregate.budgetSpend,
    pmCmWorkOrderRatio: aggregate.pmCmWorkOrderRatio,
    pmCmCostRatio: aggregate.pmCmCostRatio,
    mttrDays: aggregate.mttrDays,
    facilityUptime: aggregate.facilityUptime,
    notes: null,
    majorWins: [],
    majorRisks: [],
    actionItems: [],
  });
}

function asInteger(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function asNullableNote(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

export function getMonthlyKpiBusinessUnitScope(value?: string | null) {
  if (!value || value === ALL_BUSINESS_UNITS_LABEL)
    return ALL_BUSINESS_UNITS_LABEL;
  return normalizeBusinessUnitLabel(value);
}

export function buildMonthlyKpiRecordsUrl(
  filters?: Partial<MonthlyKpiRecordsRequest>
) {
  const params = new URLSearchParams();
  const reportingYear = filters?.reportingYear;
  const reportingMonth = filters?.reportingMonth;
  if (Number.isInteger(reportingYear)) {
    params.set("reporting_year", String(reportingYear));
  }
  if (Number.isInteger(reportingMonth)) {
    params.set("reporting_month", String(reportingMonth));
  }
  const businessUnit = getMonthlyKpiBusinessUnitScope(filters?.businessUnit);
  if (businessUnit !== ALL_BUSINESS_UNITS_LABEL) {
    params.set("business_unit", businessUnit);
  }
  const query = params.toString();
  return query
    ? `/api/monthly-kpi/records?${query}`
    : "/api/monthly-kpi/records";
}

async function fetchMonthlyKpiRecords(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    records?: PersistedMonthlyKpiRecord[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error
        ? `Unable to load persisted Monthly KPI records: ${payload.error}`
        : "Unable to load persisted Monthly KPI records."
    );
  }
  return Array.isArray(payload.records) ? payload.records : [];
}

export function mapPersistedMonthlyKpiRecord(
  record: PersistedMonthlyKpiRecord
): KpiRecord {
  const reportingMonth = asInteger(record.reporting_month) ?? undefined;
  const reportingYear = asInteger(record.reporting_year) ?? undefined;
  return evaluateAggregatedRecord({
    businessUnit: normalizeBusinessUnitLabel(record.business_unit),
    reportingMonth,
    reportingYear,
    pmCompliance: normalizeKpiNumber(record.pm_compliance),
    budgetSpend: normalizeKpiNumber(record.budget_spend),
    pmCmWorkOrderRatio: normalizeKpiNumber(record.pm_cm_work_order_ratio),
    pmCmCostRatio: normalizeKpiNumber(record.pm_cm_cost_ratio),
    mttrDays: normalizeKpiNumber(record.mttr_days),
    facilityUptime: normalizeKpiNumber(record.facility_uptime),
    notes: asNullableNote(record.notes),
    majorWins: [],
    majorRisks: [],
    actionItems: [],
  });
}

export async function getAvailableMonthlyKpiOptions(): Promise<MonthlyKpiAvailableOptions> {
  const records = await fetchMonthlyKpiRecords(buildMonthlyKpiRecordsUrl());
  const years = Array.from(
    new Set(
      records
        .map(record => asInteger(record.reporting_year))
        .filter((value): value is number => value !== null)
    )
  ).sort((a, b) => b - a);
  const months = Array.from(
    new Set(
      records
        .map(record => asInteger(record.reporting_month))
        .filter(
          (value): value is number =>
            value !== null && value >= 1 && value <= 12
        )
    )
  ).sort((a, b) => b - a);
  const persistedBusinessUnits = new Set(
    records
      .map(record => normalizeBusinessUnitLabel(record.business_unit))
      .filter(Boolean)
  );
  const knownBusinessUnits = MONTHLY_KPI_BUSINESS_UNITS.filter(unit =>
    persistedBusinessUnits.has(unit)
  );
  const additionalBusinessUnits = Array.from(persistedBusinessUnits)
    .filter(
      unit =>
        !MONTHLY_KPI_BUSINESS_UNITS.includes(
          unit as (typeof MONTHLY_KPI_BUSINESS_UNITS)[number]
        )
    )
    .sort((a, b) => a.localeCompare(b));
  return {
    years,
    months,
    businessUnits: [...knownBusinessUnits, ...additionalBusinessUnits],
  };
}

export async function getPersistedMonthlyKpiScorecard(
  request: MonthlyKpiRecordsRequest,
  template: MonthlyKpiTemplate = EXECUTIVE_SCORECARD_TEMPLATE
): Promise<MonthlyKpiScorecardDataset> {
  const [records, ytdRecords] = await Promise.all([
    fetchMonthlyKpiRecords(buildMonthlyKpiRecordsUrl(request)),
    fetchMonthlyKpiRecords(
      buildMonthlyKpiRecordsUrl({
        reportingYear: request.reportingYear,
        businessUnit: request.businessUnit,
      })
    ),
  ]);
  if (!records.length) {
    throw new Error(
      "No database records exist for the selected Monthly KPI reporting period and business unit."
    );
  }
  const businessUnit = getMonthlyKpiBusinessUnitScope(request.businessUnit);
  return {
    records: records.map(mapPersistedMonthlyKpiRecord),
    ytdRecords: ytdRecords.map(mapPersistedMonthlyKpiRecord),
    reportingYear: request.reportingYear,
    reportingMonth: request.reportingMonth,
    reportingMonthLabel: getReportingPeriodLabel(
      request.reportingMonth,
      request.reportingYear
    ),
    businessUnit,
    template,
  };
}

export function aggregatePersistedMonthlyKpiScorecard(
  records: PersistedMonthlyKpiRecord[],
  reportingYear: number
) {
  return aggregateMonthlyKpiRecords(records, reportingYear).byBusinessUnit.map(
    toKpiRecord
  );
}

export { monthlyKpiKeys };
