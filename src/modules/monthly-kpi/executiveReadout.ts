/**
 * Source-bound exception commentary for Monthly KPI decks.
 *
 * The visible readout is a concise EXCEPTION EXPLANATION only:
 *
 *   EXECUTIVE COMMENTARY
 *   - <KPI label> - <BU explanation for why that KPI missed its target>
 *
 * Rules:
 * - Only KPIs that are below target / warning (authoritative threshold
 *   status red or amber) qualify; KPIs meeting target are never mentioned.
 * - A KPI may receive a bullet ONLY when the BU's own submitted Notes or
 *   Situation (monthly_kpi_records.notes / situation for the exact BU and
 *   effective reporting month) contains an explanation relevant to it.
 * - The explanation is compressed, professionally rephrased wording of that
 *   BU text. Meaning is preserved; no cause is inferred; no management
 *   recommendation is added.
 * - If a below-target KPI has no BU explanation, its bullet is omitted. When
 *   NO explanation exists at all, one neutral line states that fact instead
 *   of manufacturing one (e.g. AMD-EZ with blank commentary).
 * - Maximum 3 exception bullets, one short sentence each.
 *
 * There is NO Management Assessment section and no KPI-value narration.
 * Deterministic: identical values + Notes/Situation always produce identical
 * output; no external LLM/API; MTTR has no authoritative below-target band
 * and is therefore never listed as an exception.
 */

import { formatFacilityUptimePercent } from "./facilityUptimeDisplay";
import {
  evaluateKpiStatus,
  getDefaultMonthlyKpiThresholdConfig,
} from "./kpiThresholds";
import type { ScorecardKpiKey } from "./types";
import type { ReadoutLine } from "../executive-presentations/framework/readoutText";

export type ExecutiveReadoutKpiStatus = "green" | "amber" | "red" | "missing";

export interface ExecutiveReadoutInput {
  businessUnit: string;
  monthLabel: string;
  /** Numeric effective reporting month (1..12). */
  reportingMonth: number;
  /** Stored monthly_kpi_records.notes for the exact BU/effective month. */
  notes: string | null;
  /** Stored monthly_kpi_records.situation for the exact BU/effective month. */
  situation: string | null;
  /** YTD values per scorecard KPI (same authority as the scorecard). */
  values: Partial<Record<ScorecardKpiKey, number | null>>;
  /**
   * STANDALONE values of the effective reporting month per KPI (authoritative
   * monthly result used to give the commentary its "Month: value" context).
   */
  monthlyValues?: Partial<Record<ScorecardKpiKey, number | null>>;
}

export interface ExecutiveReadoutKpi {
  key: ScorecardKpiKey;
  value: number | null;
  formatted: string;
  status: ExecutiveReadoutKpiStatus;
}

const NOUN: Record<ScorecardKpiKey, string> = {
  pmCompliance: "PM Compliance",
  budgetSpend: "Budget Spend",
  pmCmWorkOrderRatio: "PM:CM work orders",
  pmCmCostRatio: "PM:CM cost",
  mttrDays: "MTTR",
  facilityUptime: "Facility Uptime",
};

const KEYWORD_HINTS: Record<ScorecardKpiKey, string[]> = {
  pmCompliance: ["pm compliance", "pm:", "preventive maintenance", "deferr", "painting", "pms activities"],
  budgetSpend: ["budget", "spend", "accru", "procurement", "media replacement", "filters", "disburs", "expenses"],
  pmCmWorkOrderRatio: ["pm:cm work orders", "work orders", "cm work"],
  pmCmCostRatio: ["pm:cm cost", "cost ratio", "cm cost", "pm cost"],
  mttrDays: ["mttr", "downtime", "outage", "repair", "days", "down"],
  facilityUptime: ["facility uptime", "uptime", "operating time", "shutdown", "breakdown", "genset"],
};

function round2(value: number): string {
  return value.toFixed(2);
}

export function formatExecutiveKpiValue(key: ScorecardKpiKey, value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "no data";
  if (key === "mttrDays") return `${round2(value)} days`;
  if (key === "pmCmWorkOrderRatio" || key === "pmCmCostRatio") {
    return value >= 100 ? "No CM" : `${value.toFixed(1)}%`;
  }
  if (key === "facilityUptime") {
    // Facility Uptime (PR #427): max two decimals, never 100% when below 100.
    return formatFacilityUptimePercent(value);
  }
  return `${round2(value)}%`;
}

export function classifyExecutiveKpi(
  key: ScorecardKpiKey,
  value: number | null
): ExecutiveReadoutKpiStatus {
  const config = getDefaultMonthlyKpiThresholdConfig();
  if (value === null || value === undefined || !Number.isFinite(value)) return "missing";
  // Authoritative status only (MTTR is dataExistsGreen - no below-target band).
  const evaluation = evaluateKpiStatus(key, value, config);
  switch (evaluation.status) {
    case "red":
      return "red";
    case "amber":
      return "amber";
    case "missing":
      return "missing";
    default:
      return "green";
  }
}

export function buildExecutiveReadoutKpis(
  values: Partial<Record<ScorecardKpiKey, number | null>>
): ExecutiveReadoutKpi[] {
  const keys: ScorecardKpiKey[] = [
    "pmCompliance",
    "budgetSpend",
    "pmCmWorkOrderRatio",
    "pmCmCostRatio",
    "facilityUptime",
    "mttrDays",
  ];
  return keys.map((key) => ({
    key,
    value: values[key] ?? null,
    formatted: formatExecutiveKpiValue(key, values[key] ?? null),
    status: classifyExecutiveKpi(key, values[key] ?? null),
  }));
}

// ---------------- BU text extraction ----------------

function splitClauses(text: string): string[] {
  return String(text)
    .split(/\n|;/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function cleanClause(clause: string): string {
  const withLabel = clause.split(":");
  const body = withLabel.length > 1 ? withLabel.slice(1).join(":") : clause;
  return body.trim().replace(/\s+/g, " ").replace(/[.;]+$/, "");
}

/** Deterministically find a source (Notes or Situation) clause relevant to one KPI. */
function clauseForKpi(
  source: string | null,
  key: ScorecardKpiKey
): string | null {
  if (!source) return null;
  const clauses = splitClauses(source);
  const label = NOUN[key].toLowerCase();
  const labels = [label, label.replace(" ratio", "")];
  for (const clause of clauses) {
    const head = clause.split(":")[0]?.trim().toLowerCase() ?? "";
    if (labels.some((l) => head.startsWith(l) || head.includes(l))) {
      return cleanClause(clause);
    }
  }
  const hints = KEYWORD_HINTS[key];
  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    if (hints.some((h) => lower.includes(h))) return cleanClause(clause);
  }
  return null;
}

function compressClause(clause: string, maxChars: number): string {
  const single = clause.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) return single;
  const cut = single.slice(0, maxChars).replace(/\s+\S*$/, "").replace(/[;,.]+$/, "");
  return `${cut}…`;
}

// ---------------- public API ----------------

const MAX_EXCEPTION_BULLETS = 3;
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function isFailStatus(status: ExecutiveReadoutKpiStatus): boolean {
  return status === "red" || status === "amber";
}

/**
 * Deterministic period/value context for one KPI's submitted explanation.
 *
 * Association rule: Notes/Situation are stored on the BU's effective-month
 * monthly_kpi_records row, so the explanation is presented against the
 * STANDALONE result of that effective month ("Aug: 132.65%") when that monthly
 * result itself fails target. Only when no monthly value exists, or the
 * monthly result is not a failure while the YTD result is, is the YTD value
 * shown ("YTD: 80.49%"). No invented association is made beyond this.
 */
function periodContextFor(
  key: ScorecardKpiKey,
  input: ExecutiveReadoutInput
): { label: string; value: number | null; key: ScorecardKpiKey } {
  const monthlyValue = input.monthlyValues?.[key] ?? null;
  if (monthlyValue !== null && Number.isFinite(monthlyValue)) {
    const monthlyStatus = classifyExecutiveKpi(key, monthlyValue);
    if (isFailStatus(monthlyStatus)) {
      const label =
        SHORT_MONTHS[input.reportingMonth - 1] ??
        String(input.reportingMonth);
      return { label, value: monthlyValue, key };
    }
  }
  return { label: "YTD", value: input.values[key] ?? null, key };
}

/**
 * Build the visible readout lines for one BU Summary slide:
 *
 *   EXECUTIVE COMMENTARY   (heading)
 *   - <=3 NOTES/SITUATION-DRIVEN exception bullets with deterministic
 *     period/value context, e.g.
 *     "Budget Spend — Aug: 132.65% — Exceed budget due to media replacement..."
 *
 * A KPI is never listed merely because it failed: bullets exist ONLY when the
 * BU submitted an authoritative Notes/Situation explanation relevant to that
 * KPI. There is deliberately NO Management Assessment section.
 */
export function buildExecutiveReadoutLines(input: ExecutiveReadoutInput): ReadoutLine[] {
  const kpis = buildExecutiveReadoutKpis(input.values);
  const qualifying = kpis.filter((k) => k.key !== "mttrDays"); // no MTTR band

  // ACTUAL red-before-amber ordering (stable KPI order within each status).
  const ordered = [
    ...qualifying.filter((k) => k.status === "red"),
    ...qualifying.filter((k) => k.status === "amber"),
  ];

  const bullets: string[] = [];
  for (const kpi of ordered) {
    if (bullets.length >= MAX_EXCEPTION_BULLETS) break;
    // Search BOTH authoritative sources per KPI: Notes then Situation.
    const noteClause = clauseForKpi(input.notes, kpi.key);
    const situationClause = clauseForKpi(input.situation, kpi.key);
    if (!noteClause && !situationClause) continue; // no evidence -> NO bullet

    let explanation: string;
    if (noteClause && situationClause) {
      // Combine both only when both are relevant and the result stays short.
      const combined = `${compressClause(noteClause, 120)} ${compressClause(situationClause, 120)}`;
      explanation = compressClause(combined, 210);
    } else {
      explanation = compressClause(noteClause ?? situationClause!, 180);
    }

    const ctx = periodContextFor(kpi.key, input);
    const ctxValue =
      ctx.value !== null && Number.isFinite(ctx.value)
        ? formatExecutiveKpiValue(ctx.key, ctx.value)
        : "";
    const prefix = `${NOUN[kpi.key]} — ${ctx.label}${ctxValue ? `: ${ctxValue}` : ""} — `;
    bullets.push(`${prefix}${explanation}`);
  }

  const lines: ReadoutLine[] = [{ kind: "heading", text: "EXECUTIVE COMMENTARY" }];
  for (const bullet of bullets.slice(0, MAX_EXCEPTION_BULLETS)) {
    lines.push({ kind: "bullet", text: bullet });
  }
  return lines;
}
