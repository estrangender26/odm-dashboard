export type KpiRecord = {
  businessUnit: string;
  pmCompliance: number;
  pmCmWorkOrderRatio: number;
  budgetSpend: number;
  pmCmCostRatio: number;
  facilityUptime: number;
  majorWins: string[];
  majorRisks: string[];
  actionItems: string[];
};

export const scorecardBenchmarks = [
  { key: "pmCompliance", label: "PM Compliance", benchmark: "95%" },
  { key: "pmCmWorkOrderRatio", label: "PM:CM Ratio (WO)", benchmark: "≥86%" },
  { key: "budgetSpend", label: "Budget Spend", benchmark: "95% - 105%" },
  { key: "pmCmCostRatio", label: "PM:CM Ratio (Cost)", benchmark: "≥60%" },
  { key: "facilityUptime", label: "Facility Uptime", benchmark: "99.97%" },
] as const;

export const currentMonthlyKpiScorecard: KpiRecord[] = [
  {
    businessUnit: "Manila Water / EZ",
    pmCompliance: 96.4,
    pmCmWorkOrderRatio: 88.2,
    budgetSpend: 101.3,
    pmCmCostRatio: 63.8,
    facilityUptime: 99.98,
    majorWins: ["PM compliance exceeded the 95% benchmark.", "Facility uptime remained above target."],
    majorRisks: ["Budget spend is trending near the upper control band."],
    actionItems: ["Review cost drivers for high-spend work orders.", "Keep weekly follow-up on PM closure quality."],
  },
  {
    businessUnit: "Laguna Water",
    pmCompliance: 93.1,
    pmCmWorkOrderRatio: 84.5,
    budgetSpend: 97.6,
    pmCmCostRatio: 58.9,
    facilityUptime: 99.95,
    majorWins: ["Budget spend remained inside the acceptable range."],
    majorRisks: ["PM compliance and PM:CM cost ratio are below benchmark."],
    actionItems: ["Prioritize overdue PM backlog.", "Rebalance corrective maintenance spending."],
  },
  {
    businessUnit: "Clark Water",
    pmCompliance: 97.2,
    pmCmWorkOrderRatio: 90.4,
    budgetSpend: 103.8,
    pmCmCostRatio: 65.1,
    facilityUptime: 99.99,
    majorWins: ["All core reliability KPIs are meeting benchmark."],
    majorRisks: ["Budget spend requires monitoring for scope creep."],
    actionItems: ["Validate planned-vs-actual variance assumptions."],
  },
  {
    businessUnit: "Tagum Water",
    pmCompliance: 91.8,
    pmCmWorkOrderRatio: 79.6,
    budgetSpend: 94.2,
    pmCmCostRatio: 55.4,
    facilityUptime: 99.93,
    majorWins: ["Preventive maintenance plan is visible and measurable."],
    majorRisks: ["Multiple maintenance mix KPIs are under target."],
    actionItems: ["Escalate critical asset PM recovery plan.", "Schedule reliability review with site leads."],
  },
  {
    businessUnit: "Estate Water",
    pmCompliance: 95.6,
    pmCmWorkOrderRatio: 87.3,
    budgetSpend: 99.4,
    pmCmCostRatio: 61.2,
    facilityUptime: 99.97,
    majorWins: ["Balanced spend and maintenance mix against benchmark."],
    majorRisks: ["Uptime is at threshold and should be watched."],
    actionItems: ["Confirm uptime protection actions for critical equipment."],
  },
];

export function getReportingMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

export function getScorecardSummary(records = currentMonthlyKpiScorecard) {
  const total = records.length;
  const pmPassed = records.filter((record) => record.pmCompliance >= 95).length;
  const uptimePassed = records.filter((record) => record.facilityUptime >= 99.97).length;
  const risks = records.flatMap((record) => record.majorRisks);
  const wins = records.flatMap((record) => record.majorWins);
  return {
    highlights: [
      `${pmPassed} of ${total} business units are meeting PM compliance target.`,
      `${uptimePassed} of ${total} business units are meeting facility uptime target.`,
      "Budget spend remains inside or near governance thresholds for most business units.",
    ],
    wins: wins.slice(0, 5),
    risks: risks.slice(0, 5),
    concerns: risks.slice(0, 4),
    actions: records.flatMap((record) => record.actionItems).slice(0, 6),
  };
}
