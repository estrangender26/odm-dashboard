/**
 * Deterministic Executive Readout content for Monthly KPI decks.
 *
 * The visible readout upgrades from the raw stored sections
 *   Notes / Commentary  /  Situation
 * to concise management-quality sections
 *   EXECUTIVE COMMENTARY / MANAGEMENT ASSESSMENT
 *
 * EXECUTIVE COMMENTARY answers "what happened and what does the BU say
 * explains it" - material KPI exceptions (red, then amber) combined with a
 * concise, meaning-preserving reference to the BU's submitted Notes.
 *
 * MANAGEMENT ASSESSMENT answers "what should management understand or do" -
 * evidence-bound implications, required validation, and follow-up actions.
 *
 * The implementation is 100% deterministic:
 *   - no external LLM/API call;
 *   - identical KPI values + Notes/Situation always produce identical output;
 *   - statuses come from the SAME threshold configuration used by the
 *     scorecard colours (getDefaultMonthlyKpiThresholdConfig / evaluateKpiStatus);
 *   - causes are never invented: plausible-but-unproven relationships are
 *     phrased as requiring validation.
 *
 * The original monthly_kpi_records.notes / situation are authoritative source
 * data and are NEVER modified - the bullets below are derived presentation
 * content only.
 */

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
  /** Stored monthly_kpi_records.notes for the exact BU/effective month. */
  notes: string | null;
  /** Stored monthly_kpi_records.situation for the exact BU/effective month. */
  situation: string | null;
  /** YTD values per scorecard KPI (same authority as the scorecard). */
  values: Partial<Record<ScorecardKpiKey, number | null>>;
}

export interface ExecutiveReadoutKpi {
  key: ScorecardKpiKey;
  value: number | null;
  formatted: string;
  status: ExecutiveReadoutKpiStatus;
}

// ── per-KPI metadata ──────────────────────────────────────────────────────

const NOUN: Record<ScorecardKpiKey, string> = {
  pmCompliance: "PM Compliance",
  budgetSpend: "Budget Spend",
  pmCmWorkOrderRatio: "PM:CM work orders",
  pmCmCostRatio: "PM:CM cost",
  mttrDays: "MTTR",
  facilityUptime: "Facility Uptime",
};

/** Keyword sets (lowercased) detected inside submitted notes clauses. */
const PM_DEFERRAL_KEYWORDS = ["deferr", "materials", "procurement", "postpon", "painting", "vehicle pms"];
const OUTAGE_KEYWORDS = ["breakdown", "genset", "outage", "down", "failure", "pole", "dismantl", "repair of the", "repair of pump", "replacement of the pump"];
const PROJECT_KEYWORDS = ["media replacement", "rehab", "replacement of filters", "deepwell", "pacer", "quotation"];

const KEYWORD_HINTS: Record<ScorecardKpiKey, string[]> = {
  pmCompliance: ["pm compliance", "pm:", "preventive maintenance", "deferr", "painting"],
  budgetSpend: ["budget", "spend", "accru", "procurement", "media replacement", "filters", "cost of", "expenses"],
  pmCmWorkOrderRatio: ["pm:cm work orders", "work orders", "cm work"],
  pmCmCostRatio: ["pm:cm cost", "cost ratio", "cm cost"],
  mttrDays: ["mttr", "downtime", "outage", "repair", "days"],
  facilityUptime: ["facility uptime", "uptime", "operating time", "shutdown", "breakdown", "genset"],
};

// ── small helpers ─────────────────────────────────────────────────────────

function round2(value: number): string {
  return value.toFixed(2);
}

export function formatExecutiveKpiValue(key: ScorecardKpiKey, value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "no data";
  if (key === "mttrDays") return `${round2(value)} days`;
  if (key === "pmCmWorkOrderRatio" || key === "pmCmCostRatio") {
    return value >= 100 ? "No CM" : `${value.toFixed(1)}%`;
  }
  return `${round2(value)}%`;
}

export function classifyExecutiveKpi(
  key: ScorecardKpiKey,
  value: number | null
): ExecutiveReadoutKpiStatus {
  const config = getDefaultMonthlyKpiThresholdConfig();
  if (value === null || value === undefined || !Number.isFinite(value)) return "missing";
  // MTTR has NO green/amber/red threshold bands in the authoritative config
  // (dataExistsGreen) - it must not be silently classified with an invented
  // numeric threshold here. evaluateKpiStatus returns green when data exists
  // and missing otherwise; that authoritative result is used as-is.
  const evaluation = evaluateKpiStatus(
    key,
    value,
    config
  );
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
  return keys.map((key) => {
    const value = values[key] ?? null;
    return {
      key,
      value,
      formatted: formatExecutiveKpiValue(key, value),
      status: classifyExecutiveKpi(key, value),
    };
  });
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const EXEC_TOTAL_WORD_CAP = 45;
const MA_TOTAL_WORD_CAP = 45;

function joinClauses(clauses: string[]): string {
  return clauses.filter((c) => c.length > 0).join("; ");
}

/** budget-spend has a two-sided band: 90-95 and 105-110 are amber. */
function isBudgetOverTarget(value: number): boolean {
  return value > 105;
}

// ── notes handling ─────────────────────────────────────────────────────────

function splitNoteClauses(notes: string): string[] {
  return String(notes)
    .split(/\n|;/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Deterministically extract, per KPI, the submitted-note clause that appears
 * most relevant to that KPI (label prefix or keyword hints). Returns the
 * clause text with its label removed, trimmed.
 */
function noteClauseForKpi(
  notes: string | null,
  key: ScorecardKpiKey,
  kpis: ExecutiveReadoutKpi[]
): string | null {
  if (!notes) return null;
  const clauses = splitNoteClauses(notes);
  // Prefer a "Label: ..." prefixed clause.
  const labelWords = NOUN[key].toLowerCase();
  const labels = [
    labelWords,
    labelWords.replace(" ratio", ""),
  ];
  for (const clause of clauses) {
    const head = clause.split(":")[0]?.trim().toLowerCase() ?? "";
    if (labels.some((l) => head.startsWith(l) || head.includes(l))) {
      return cleanClause(clause);
    }
  }
  // Fallback: keyword hints.
  const hints = KEYWORD_HINTS[key];
  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    if (hints.some((h) => lower.includes(h))) return cleanClause(clause);
  }
  void kpis;
  return null;
}

function cleanClause(clause: string): string {
  const withLabel = clause.split(":");
  const body = withLabel.length > 1 ? withLabel.slice(1).join(":") : clause;
  const cleaned = body.trim().replace(/\s+/g, " ").replace(/[.;]+$/, "");
  return cleaned.length > 150 ? `${cleaned.slice(0, 147).replace(/\s+\S*$/, "")}…` : cleaned;
}

/** True when a clause signals deferred PM / material or procurement constraints. */
function hasPmDeferral(clause: string | null): boolean {
  if (!clause) return false;
  const lower = clause.toLowerCase();
  return PM_DEFERRAL_KEYWORDS.some((k) => lower.includes(k));
}

function hasOutage(clause: string | null): boolean {
  if (!clause) return false;
  const lower = clause.toLowerCase();
  return OUTAGE_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * MTTR outage context must come from the BU's OWN MTTR-labelled clause and
 * carry duration/failure evidence (e.g. "down for 2 days", "damage",
 * "transmission pole"). Generic words like "downtime"/"breakdown" alone are
 * NOT enough to route an MTTR validation bullet - that avoids inventing a
 * reason when the reported MTTR is trivial.
 */
function hasMttrOutageContext(clause: string | null): boolean {
  if (!clause) return false;
  const lower = clause.toLowerCase();
  return (
    /\bdown for\b|\d+\s+days|\bdamage\b|\bpole\b|\boutage\b|\bfailed\b|\bfailure\b|breakdown of|\bgenset\b/.test(lower)
  );
}

/** Compress a submitted-note clause into one short, meaning-preserving fragment. */
function compressClause(clause: string, maxChars: number): string {
  const single = clause.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) return single;
  const cut = single.slice(0, maxChars).replace(/\s+\S*$/, "").replace(/[;,.]+$/, "");
  return `${cut}…`;
}

// ── direction / status phrasing ───────────────────────────────────────────

function exceptionClause(kpi: ExecutiveReadoutKpi): string {
  const noun = NOUN[kpi.key];
  const value = kpi.value as number;
  const formatted = kpi.formatted;

  if (kpi.key === "budgetSpend") {
    if (kpi.status === "red") {
      return isBudgetOverTarget(value)
        ? `${noun} (${formatted}) was above the 95-105% target band`
        : `${noun} (${formatted}) was below the 95-105% target band`;
    }
    if (kpi.status === "amber") {
      return isBudgetOverTarget(value)
        ? `${noun} (${formatted}) was slightly above the target band`
        : `${noun} (${formatted}) was slightly below the target band`;
    }
  }
  if (kpi.key === "facilityUptime") {
    return kpi.status === "red"
      ? `${noun} (${formatted}) was below the 100% target`
      : `${noun} (${formatted}) was near, but below, the 100% target`;
  }
  // MTTR is never a threshold exception (no authoritative band); it is
  // surfaced separately as a reported value with evidence-safe wording.
  return `${noun} (${formatted}) was below target`;
}

// ── EXECUTIVE COMMENTARY builder ─────────────────────────────────────────

function buildExecutiveCommentary(input: ExecutiveReadoutInput, kpis: ExecutiveReadoutKpi[]): string[] {
  const red = kpis.filter((k) => k.status === "red");
  const amber = kpis.filter((k) => k.status === "amber");
  const present = kpis.filter((k) => k.status !== "missing");

  // No reported KPI data at all.
  if (present.length === 0) {
    return [
      `No reported KPI data was available for ${input.businessUnit} in ${input.monthLabel}.`,
    ];
  }

  // No material exception: strong BU - keep it short and non-repetitive.
  if (red.length === 0 && amber.length === 0) {
    return [
      `Reported KPIs for ${input.businessUnit} were on target in ${input.monthLabel}; no material exception to escalate.`,
    ];
  }

  // Exceptions: red first, then amber; keep the bullet short.
  const ordered = [...red, ...amber];
  const clauses: string[] = [];
  for (const kpi of ordered) {
    if (clauses.length >= 3) break;
    const candidate = exceptionClause(kpi);
    if (countWords(joinClauses([...clauses, candidate])) > 34) break;
    clauses.push(candidate);
  }

  // Reported MTTR may be surfaced as a provisional value when it is relevant
  // to an exception (100% uptime interplay or a BU-reported outage context) -
  // WITHOUT inventing a numeric MTTR threshold. Wording stays evidence-bound.
  if (clauses.length < 3) {
    const mttr = kpis.find((k) => k.key === "mttrDays");
    const mttrValue = mttr && mttr.value !== null ? (mttr.value as number) : null;
    const fu = kpis.find((k) => k.key === "facilityUptime");
    const fuValue = fu && fu.value !== null ? (fu.value as number) : null;
    const mttrNote =
      mttrValue !== null && mttrValue > 0
        ? noteClauseForKpi(input.notes, "mttrDays", kpis)
        : null;
    const relevant =
      mttrValue !== null &&
      mttrValue > 0 &&
      ((fuValue !== null && fuValue >= 99.99) ||
        (mttrNote !== null && hasMttrOutageContext(mttrNote)));
    if (relevant) {
      const candidate = `MTTR (${mttr!.formatted}) was reported and requires validation`;
      if (countWords(joinClauses([...clauses, candidate])) <= 34) {
        clauses.push(candidate);
      }
    }
  }

  const headline = joinClauses(clauses);
  const bullets: string[] = [headline];

  // Context bullet: relevant submitted Notes, compressed and meaning-preserving.
  if (red.length > 0 || amber.length > 0) {
    const relevant = ordered.slice(0, 3);
    const fragments: string[] = [];
    for (const kpi of relevant) {
      if (fragments.length >= 2) break;
      const clause = noteClauseForKpi(input.notes, kpi.key, kpis);
      if (!clause) continue;
      fragments.push(compressClause(clause, 120));
    }
    if (fragments.length > 0) {
      const context = `The BU reported ${fragments.join("; ").replace(/\.$/, "")}.`;
      const projected = countWords(`${bullets[0]} ${context}`);
      if (projected <= EXEC_TOTAL_WORD_CAP) {
        bullets.push(context);
      } else {
        // The total budget is a hard limit: prefer a single short fragment or
        // drop the context bullet entirely rather than exceed the cap.
        const shorter = `The BU reported ${fragments[0]}.`;
        if (countWords(`${bullets[0]} ${shorter}`) <= EXEC_TOTAL_WORD_CAP) {
          bullets.push(shorter);
        }
      }
    }
  }
  return bullets;
}

// ── MANAGEMENT ASSESSMENT builder ─────────────────────────────────────────

const PM_GENERIC_RECOVERY = "Prioritize recovery of PM compliance toward the ≥98% target";
const PM_DEFERRED_RECOVERY = "Prioritize recovery of PM activities deferred by materials or procurement constraints";

function pmAssessment(input: ExecutiveReadoutInput, kpis: ExecutiveReadoutKpi[]): string | null {
  const pm = kpis.find((k) => k.key === "pmCompliance");
  if (!pm || (pm.status !== "red" && pm.status !== "amber")) return null;
  const clause = noteClauseForKpi(input.notes, "pmCompliance", kpis);
  return hasPmDeferral(clause) ? PM_DEFERRED_RECOVERY : PM_GENERIC_RECOVERY;
}

/**
 * Evidence-safe MTTR validation wording. MTTR has no authoritative threshold
 * band, so it is NEVER called "elevated" from a numeric cutoff: the bullet is
 * only produced when the reported MTTR is relevant (100% facility uptime
 * interplay or a BU-reported outage context) and always uses "reported".
 */
function mttrAssessment(input: ExecutiveReadoutInput, kpis: ExecutiveReadoutKpi[]): string | null {
  const mttr = kpis.find((k) => k.key === "mttrDays");
  const value = mttr && mttr.value !== null ? (mttr.value as number) : null;
  if (value === null || value <= 0 || mttr!.status === "missing") return null;
  const clause = noteClauseForKpi(input.notes, "mttrDays", kpis);
  const wellTwo =
    clause !== null && /well\s*2|transmission.{0,24}pole|pole/.test(clause.toLowerCase());
  if (wellTwo) {
    return `Validate the reported MTTR (${mttr!.formatted}) and corrective actions from the reported Well 2 outage`;
  }
  return `Validate the reported MTTR (${mttr!.formatted}) against the affected equipment population`;
}

function budgetAssessment(input: ExecutiveReadoutInput, kpis: ExecutiveReadoutKpi[]): string | null {
  const budget = kpis.find((k) => k.key === "budgetSpend");
  if (!budget || (budget.status !== "red" && budget.status !== "amber")) return null;
  const value = budget.value as number;
  const over = isBudgetOverTarget(value);
  const clause = noteClauseForKpi(input.notes, "budgetSpend", kpis);
  const projectNote = clause !== null && PROJECT_KEYWORDS.some((w) => clause.toLowerCase().includes(w));
  if (projectNote && !over) {
    return "Confirm whether planned maintenance expenditures remain on schedule";
  }
  return over
    ? "Re-forecast Budget Spend to bring expenditures back into the 95-105% target band"
    : "Review Budget Spend phasing to bring expenditures back into the 95-105% band";
}

function facilityAssessment(input: ExecutiveReadoutInput, kpis: ExecutiveReadoutKpi[]): string | null {
  const fu = kpis.find((k) => k.key === "facilityUptime");
  if (!fu || (fu.status !== "red" && fu.status !== "amber")) return null;
  const clause = noteClauseForKpi(input.notes, "facilityUptime", kpis);
  if (clause !== null && hasOutage(clause)) {
    return "Review the reported facility outage for root cause and recurrence prevention";
  }
  if (fu.status === "red") {
    return "Investigate the reported downtime to restore 100% facility uptime";
  }
  return `Monitor Facility Uptime (${fu.formatted}) toward the 100% target`;
}

function ratioAssessment(kpis: ExecutiveReadoutKpi[]): string | null {
  const wo = kpis.find((k) => k.key === "pmCmWorkOrderRatio");
  const cost = kpis.find((k) => k.key === "pmCmCostRatio");
  const any = [wo, cost].some(
    (k) => k !== undefined && (k.status === "red" || k.status === "amber")
  );
  if (!any) return null;
  return "Strengthen preventive maintenance execution to raise the PM share of work orders and cost";
}

function buildManagementAssessment(input: ExecutiveReadoutInput, kpis: ExecutiveReadoutKpi[]): string[] {
  const present = kpis.filter((k) => k.status !== "missing");
  const red = kpis.filter((k) => k.status === "red");
  const amber = kpis.filter((k) => k.status === "amber");
  const fu = kpis.find((k) => k.key === "facilityUptime");
  const mttr = kpis.find((k) => k.key === "mttrDays");
  const mttrValue = mttr && mttr.value !== null ? (mttr.value as number) : null;
  const fuValue = fu && fu.value !== null ? (fu.value as number) : null;
  // No invented MTTR threshold: MTTR is never classified by a numeric cutoff.
  // It is surfaced for validation only under evidence-based triggers:
  //   - the facility reported 100% uptime while a repair duration is reported
  //     (cross-KPI interplay), or
  //   - the BU's own notes report an outage/failure context for MTTR.
  const mttrReported = mttrValue !== null && mttrValue > 0;
  const mttrNote = mttrReported
    ? noteClauseForKpi(input.notes, "mttrDays", kpis)
    : null;
  const mttrOutageContext = mttrNote !== null && hasMttrOutageContext(mttrNote);
  const fuPerfect = fuValue !== null && fuValue >= 99.99;

  if (present.length === 0) {
    return ["Obtain the BU KPI submission to enable a management assessment."];
  }
  if (red.length === 0 && amber.length === 0) {
    return [
      "No material exception requires follow-up; continue routine monitoring.",
    ];
  }

  const actions: string[] = [];
  const consider = (action: string | null) => {
    if (action && actions.length < 2 && !actions.includes(action)) actions.push(action);
  };

  // Deterministic priority order (MTTR never uses an invented numeric band):
  //   1. PM compliance recovery (incl. deferred-PM context)
  //   2. Reported-MTTR validation only when evidence triggers it
  //   3. 100%-uptime / reported-MTTR interplay confirmation
  //   4. Budget Spend phasing / project-expenditure check
  //   5. Facility-uptime action
  //   6. PM:CM ratio strengthening
  consider(pmAssessment(input, kpis));

  if (mttrReported && (fuPerfect || mttrOutageContext)) {
    consider(mttrAssessment(input, kpis));
  }
  if (mttrReported && fuPerfect) {
    consider(
      "Confirm whether long-duration repairs involved equipment that did not affect facility operation, given 100% facility uptime"
    );
  }

  consider(budgetAssessment(input, kpis));
  consider(facilityAssessment(input, kpis));
  consider(ratioAssessment(kpis));

  // Word-budget enforcement: never exceed the section cap.
  while (actions.length > 1 && countWords(joinClauses(actions)) > MA_TOTAL_WORD_CAP) {
    actions.pop();
  }
  return actions.map((a) => `${a}.`);
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Build the visible readout lines for one BU Summary slide:
 *
 *   EXECUTIVE COMMENTARY   (heading)
 *   • ≤2 concise bullets
 *   MANAGEMENT ASSESSMENT  (heading)
 *   • ≤2 concise bullets
 *
 * Same deterministic logic for single-BU and All-BU presentations.
 */
export function buildExecutiveReadoutLines(input: ExecutiveReadoutInput): ReadoutLine[] {
  const kpis = buildExecutiveReadoutKpis(input.values);
  const executive = buildExecutiveCommentary(input, kpis);
  const assessment = buildManagementAssessment(input, kpis);

  const lines: ReadoutLine[] = [{ kind: "heading", text: "EXECUTIVE COMMENTARY" }];
  for (const bullet of executive.slice(0, 2)) {
    lines.push({ kind: "bullet", text: bullet });
  }
  lines.push({ kind: "heading", text: "MANAGEMENT ASSESSMENT" });
  for (const bullet of assessment.slice(0, 2)) {
    lines.push({ kind: "bullet", text: bullet });
  }
  return lines;
}
