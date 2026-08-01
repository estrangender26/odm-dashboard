/**
 * Monthly KPI Scorecard Presentation Model
 *
 * Data structures for the template-based 3-slide Monthly KPI deck.
 *
 * @server-only
 */

export type ScorecardKpiKey =
  | "pmCompliance"
  | "budgetSpend"
  | "pmCmWorkOrderRatio"
  | "pmCmCostRatio"
  | "mttrDays"
  | "facilityUptime";

export type KpiStatus = "success" | "warning" | "danger" | "no-data" | "provisional";

export interface MonthlyKpiValue {
  value: number | null;
  status: KpiStatus;
  formatted: string;
}

export interface MonthlyKpiTrendRow {
  month: number;
  monthLabel: string;
  values: Record<ScorecardKpiKey, MonthlyKpiValue>;
}

export interface BusinessUnitScorecard {
  businessUnit: string;
  monthlyTrend: MonthlyKpiTrendRow[];
  ytd: Record<ScorecardKpiKey, MonthlyKpiValue>;
  notes: string | null;
  majorWins: string[];
  majorRisks: string[];
  actionItems: string[];
}

export interface MonthlyKpiExecutiveReadout {
  slide1Observation: string;
  slide2Observation: string;
  slide3Actions: string[];
  dataNote: string;
}

export interface MonthlyKpiPresentation {
  generatedAt: string;
  reportingYear: number;
  reportingMonth: number;
  reportingMonthLabel: string;
  selectedBusinessUnit: string;
  businessUnits: string[];
  buScorecards: BusinessUnitScorecard[];
  portfolioYtd: Record<ScorecardKpiKey, MonthlyKpiValue>;
  executive: MonthlyKpiExecutiveReadout;
}
