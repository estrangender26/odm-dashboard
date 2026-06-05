import {
  aggregateMonthlyKpiRecords,
  monthlyKpiKeys,
  type PersistedMonthlyKpiRecord,
} from "../monthly-kpi/kpiAggregation";

export type KpiRecord = {
  businessUnit: string;
  reportingMonth?: number;
  reportingYear?: number;
  pmCompliance: number | null;
  scheduleCompliance: number | null;
  budgetSpend: number | null;
  pmCmWorkOrderRatio: number | null;
  pmCmCostRatio: number | null;
  mtbfDays: number | null;
  mttrDays: number | null;
  facilityUptime: number | null;
  majorWins: string[];
  majorRisks: string[];
  actionItems: string[];
};

export const scorecardBenchmarks = [
  { key: "pmCompliance", label: "PM Compliance", benchmark: "95%" },
  { key: "scheduleCompliance", label: "Schedule Compliance", benchmark: "95%" },
  { key: "budgetSpend", label: "Budget Spend", benchmark: "95% - 105%" },
  { key: "pmCmWorkOrderRatio", label: "PM:CM Ratio (WO)", benchmark: "≥86% (6:1)" },
  { key: "pmCmCostRatio", label: "PM:CM Ratio (Cost)", benchmark: "≥60% (1.5:1)" },
  { key: "mtbfDays", label: "MTBF", benchmark: "Tracked" },
  { key: "mttrDays", label: "MTTR", benchmark: "Tracked" },
  { key: "facilityUptime", label: "Facility Uptime", benchmark: "99.97%" },
] as const;

export const currentMonthlyKpiScorecard: KpiRecord[] = [
  {
    businessUnit: "AMD-EZ",
    pmCompliance: 96.4,
    scheduleCompliance: 95.8,
    budgetSpend: 101.3,
    pmCmWorkOrderRatio: 88.2,
    pmCmCostRatio: 63.8,
    mtbfDays: 42.5,
    mttrDays: 3.2,
    facilityUptime: 99.98,
    majorWins: ["PM compliance exceeded the 95% benchmark.", "Facility uptime remained above target."],
    majorRisks: ["Budget spend is trending near the upper control band."],
    actionItems: ["Review cost drivers for high-spend work orders.", "Keep weekly follow-up on PM closure quality."],
  },
];

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function evaluateAggregatedRecord(record: KpiRecord): KpiRecord {
  const wins: string[] = [];
  const risks: string[] = [];
  const actions: string[] = [];

  if (isPresentNumber(record.pmCompliance) && record.pmCompliance >= 95) {
    wins.push("PM compliance met or exceeded the 95% benchmark.");
  } else if (isPresentNumber(record.pmCompliance)) {
    risks.push("PM compliance is below the 95% benchmark.");
    actions.push("Review overdue PM backlog and closure constraints.");
  }

  if (isPresentNumber(record.scheduleCompliance) && record.scheduleCompliance >= 95) {
    wins.push("Schedule compliance met or exceeded the 95% benchmark.");
  } else if (isPresentNumber(record.scheduleCompliance)) {
    risks.push("Schedule compliance is below the 95% benchmark.");
    actions.push("Review schedule blockers and missed planned work.");
  }

  if (isPresentNumber(record.facilityUptime) && record.facilityUptime >= 99.97) {
    wins.push("Facility uptime met or exceeded the 99.97% benchmark.");
  } else if (isPresentNumber(record.facilityUptime)) {
    risks.push("Facility uptime is below the 99.97% benchmark.");
    actions.push("Confirm uptime recovery actions for critical equipment.");
  }

  if (isPresentNumber(record.budgetSpend) && (record.budgetSpend < 95 || record.budgetSpend > 105)) {
    risks.push("Budget spend is outside the 95% to 105% control band.");
    actions.push("Validate planned-versus-actual cost drivers.");
  } else if (isPresentNumber(record.budgetSpend)) {
    wins.push("Budget spend stayed within the scorecard control band.");
  }

  return {
    ...record,
    majorWins: wins.length ? wins : ["Imported KPI data is available for review."],
    majorRisks: risks.length ? risks : ["No critical KPI risks identified from imported values."],
    actionItems: actions.length ? actions : ["Continue monthly KPI monitoring and validation."],
  };
}

export function getReportingMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

export function getScorecardSummary(records = currentMonthlyKpiScorecard) {
  const total = records.length;
  const pmPassed = records.filter((record) => isPresentNumber(record.pmCompliance) && record.pmCompliance >= 95).length;
  const schedulePassed = records.filter((record) => isPresentNumber(record.scheduleCompliance) && record.scheduleCompliance >= 95).length;
  const uptimePassed = records.filter((record) => isPresentNumber(record.facilityUptime) && record.facilityUptime >= 99.97).length;
  const risks = records.flatMap((record) => record.majorRisks);
  const wins = records.flatMap((record) => record.majorWins);
  return {
    highlights: [
      `${pmPassed} of ${total} business units are meeting PM compliance target.`,
      `${schedulePassed} of ${total} business units are meeting schedule compliance target.`,
      `${uptimePassed} of ${total} business units are meeting facility uptime target.`,
    ],
    wins: wins.slice(0, 5),
    risks: risks.slice(0, 5),
    concerns: risks.slice(0, 4),
    actions: records.flatMap((record) => record.actionItems).slice(0, 6),
  };
}

function getSelectedMonthlyKpiContext() {
  const now = new Date();
  const reportingYear = Number(window.localStorage.getItem("monthlyKpiSelectedYear")) || now.getFullYear();
  return { reportingYear };
}

function toKpiRecord(aggregate: ReturnType<typeof aggregateMonthlyKpiRecords>["byBusinessUnit"][number]): KpiRecord {
  return evaluateAggregatedRecord({
    businessUnit: aggregate.businessUnit,
    reportingYear: aggregate.reportingYear,
    pmCompliance: aggregate.pmCompliance,
    scheduleCompliance: aggregate.scheduleCompliance,
    budgetSpend: aggregate.budgetSpend,
    pmCmWorkOrderRatio: aggregate.pmCmWorkOrderRatio,
    pmCmCostRatio: aggregate.pmCmCostRatio,
    mtbfDays: aggregate.mtbfDays,
    mttrDays: aggregate.mttrDays,
    facilityUptime: aggregate.facilityUptime,
    majorWins: [],
    majorRisks: [],
    actionItems: [],
  });
}

export async function getPersistedMonthlyKpiScorecard() {
  const context = getSelectedMonthlyKpiContext();
  const params = new URLSearchParams({ reporting_year: String(context.reportingYear) });
  const response = await fetch(`/api/monthly-kpi/aggregates?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Unable to load persisted Monthly KPI aggregates.");
  const aggregate = (await response.json()) as ReturnType<typeof aggregateMonthlyKpiRecords>;
  if (!aggregate.byBusinessUnit?.length) {
    throw new Error("No KPI data available for selected year.");
  }

  return {
    records: aggregate.byBusinessUnit.map(toKpiRecord),
    reportingMonthLabel: String(context.reportingYear),
    businessUnit: "All Business Units",
  };
}

export function aggregatePersistedMonthlyKpiScorecard(records: PersistedMonthlyKpiRecord[], reportingYear: number) {
  return aggregateMonthlyKpiRecords(records, reportingYear).byBusinessUnit.map(toKpiRecord);
}

export { monthlyKpiKeys };
