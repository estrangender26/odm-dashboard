/**
 * progressModel.ts — canonical progress / completion domain model (F-10).
 *
 * Shared by the API router (server) and the frontend optimistic model so both
 * layers enforce exactly the same frozen rules. The module NEVER silently
 * repairs contradictory explicit input:
 *
 *  - explicit contradictions are rejected (V-rules below);
 *  - only two deliberate transitions are applied:
 *      T1  deliberate completion: percentComplete changed to exactly 100 with
 *          no Actual Finish  ->  Actual Finish = Project Data Date (never
 *          wall-clock), remaining = 0, status = completed;
 *      T2  deliberate un-completion: percentComplete reduced below 100 while an
 *          Actual Finish exists  ->  Actual Finish cleared, remaining derived,
 *          status derived. Explicit Actual Finish clearing at 100% keeps the
 *          approved 99% / 0% behavior (T2b).
 *  - status is DERIVED from canonical progress state and never drives
 *    scheduling behavior on its own.
 */

export const VALID_PROGRESS_STATUSES = ["not-started", "in-progress", "completed"] as const;
export type ProgressStatus = (typeof VALID_PROGRESS_STATUSES)[number];

export type ProgressState = ProgressStatus;

/** Canonical nullable progress fields of an activity row. */
export interface ProgressFields {
  percentComplete: number | null;
  actualStart: string | null;
  actualFinish: string | null;
  status: string | null;
  remainingDurationDays: number | null;
  originalDurationDays: number | null;
}

export type ProgressEdit = Partial<ProgressFields>;

export interface ProgressResult {
  ok: boolean;
  /** Fields whose normalized value differs from the current state. */
  values?: {
    percentComplete?: number;
    actualStart?: string | null;
    actualFinish?: string | null;
    status?: string | null;
    remainingDurationDays?: number;
  };
  noop?: boolean;
  error?: string;
}

export const PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE =
  "Project Data Date is required to automatically set Actual Finish when completing an activity at 100%";

export function hundredPercentDataDateConflictMessage(dataDate: string, actualStart: string): string {
  return `Cannot auto-populate Actual Finish from Project Data Date (${dataDate}) because it precedes Actual Start (${actualStart}); provide an explicit Actual Finish on or after ${actualStart} or update the Project Data Date`;
}

/** Normalize a stored/edited date value to a canonical YYYY-MM-DD string or null. */
export function normalizeIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (s === "") return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function isValidIsoDate(value: unknown): value is string {
  const iso = normalizeIsoDate(value);
  return iso != null && /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

/**
 * Canonical progress state, derived ONLY from percentComplete, actualStart and
 * actualFinish. status is never an input to this derivation.
 *
 *   completed   <=> percentComplete === 100 AND actualFinish present
 *   not-started <=> percentComplete === 0 AND no actualStart AND no actualFinish
 *   otherwise   => in-progress
 */
export function deriveProgressState(
  percentComplete: number | null | undefined,
  actualStart: string | null | undefined,
  actualFinish: string | null | undefined
): ProgressStatus {
  const pct = percentComplete ?? 0;
  const as = normalizeIsoDate(actualStart);
  const af = normalizeIsoDate(actualFinish);
  if (pct >= 100 && af != null) return "completed";
  if (pct === 0 && as == null && af == null) return "not-started";
  return "in-progress";
}

/** Completed means a recorded finish fact plus 100%: pct === 100 && actualFinish present. */
export function isCompletedState(
  percentComplete: number | null | undefined,
  actualFinish: string | null | undefined
): boolean {
  return (percentComplete ?? 0) >= 100 && normalizeIsoDate(actualFinish) != null;
}

/**
 * Clearing Actual Finish at 100%:
 * - explicit % Complete < 100 supplied in the same edit takes precedence;
 * - otherwise 99% if Actual Start exists, 0% if Actual Start is null.
 * Actual Finish remains null.
 */
export function percentAfterClearingActualFinish(
  actualStart: string | null | undefined,
  explicitPercent?: number | null
): number {
  if (explicitPercent != null && explicitPercent < 100) return explicitPercent;
  return normalizeIsoDate(actualStart) ? 99 : 0;
}

/**
 * When % Complete becomes 100 and no Actual Finish is present, populate Actual
 * Finish from Project Data Date only. Never fall back to wall-clock today.
 */
export function autoActualFinishFromDataDate(
  dataDate: unknown,
  actualStart: string | null | undefined
): { ok: true; actualFinish: string } | { ok: false; error: string } {
  const dd = normalizeIsoDate(dataDate);
  if (!dd || !isValidIsoDate(dd)) {
    return { ok: false, error: PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE };
  }
  const start = normalizeIsoDate(actualStart);
  if (start && dd < start) {
    return { ok: false, error: hundredPercentDataDateConflictMessage(dd, start) };
  }
  return { ok: true, actualFinish: dd };
}

/**
 * Remaining working duration:
 * - completed (pct 100 with a finish) -> 0;
 * - explicit value (already validated >= 0) -> explicit;
 * - 0 < pct < 100 -> max(1, round(original * (1 - pct/100)));
 * - pct 0 -> 0 (the engine falls back to the original duration).
 */
export function deriveRemainingDuration(
  originalDurationDays: number | null | undefined,
  percentComplete: number | null | undefined,
  explicitRemaining?: number | null
): number {
  const pct = percentComplete ?? 0;
  if (pct >= 100) return 0;
  if (explicitRemaining != null) return explicitRemaining;
  const orig = originalDurationDays ?? 0;
  if (pct > 0 && pct < 100) return Math.max(1, Math.round(orig * (1 - pct / 100)));
  return 0;
}

interface ResolveContext {
  current: ProgressFields;
  changes: ProgressEdit;
  dataDate: string | null | undefined;
  /** create additionally sanctions recording an explicit Actual Finish as completion. */
  mode: "create" | "update";
}

export function resolveProgress(ctx: ResolveContext): ProgressResult {
  const { current, changes, dataDate, mode } = ctx;
  const hasPct = changes.percentComplete !== undefined;
  const hasAS = changes.actualStart !== undefined;
  const hasAF = changes.actualFinish !== undefined;
  const hasStatus = changes.status !== undefined;
  const hasRem = changes.remainingDurationDays !== undefined;

  const fail = (error: string): ProgressResult => ({ ok: false, error });

  // Normalize raw values.
  let pct: number | null = (hasPct ? changes.percentComplete : current.percentComplete) ?? null;
  if (pct == null) pct = 0; // explicit null % is the sanctioned "reset to 0" (existing behavior)
  const as = normalizeIsoDate(hasAS ? changes.actualStart : current.actualStart);
  let af = normalizeIsoDate(hasAF ? changes.actualFinish : current.actualFinish);
  let status: string | null = (hasStatus ? changes.status : current.status) ?? null;
  let rem: number | null = (hasRem ? changes.remainingDurationDays : current.remainingDurationDays) ?? null;
  const orig = current.originalDurationDays ?? 0;

  // V8 — value ranges.
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    return fail("Percent complete must be a whole number from 0 to 100");
  }
  if (rem != null && (!Number.isInteger(rem) || rem < 0)) {
    return fail("Remaining duration cannot be negative");
  }

  // V5 — unknown explicit status.
  if (status != null && !(VALID_PROGRESS_STATUSES as readonly string[]).includes(status)) {
    return fail(`Unknown activity status "${status}"; use not-started, in-progress, or completed`);
  }

  // Explicit-status contradictions are validated BEFORE the deliberate
  // transitions, so an explicit "completed" + < 100% is rejected instead of
  // being silently swallowed by T2 (un-completion). A stored status is
  // superseded by derivation whenever progress changes, so these rules only
  // apply to explicitly supplied status.
  if (hasStatus && status === "completed" && pct < 100) {
    return fail("Completed status requires 100% complete");
  }
  if (hasStatus && status === "in-progress" && (pct === 0 || pct === 100)) {
    return fail("In-progress status requires progress strictly between 0% and 100%");
  }
  if (hasStatus && status === "not-started" && (pct > 0 || as != null || af != null)) {
    return fail("Not-started status cannot have progress or actual dates");
  }

  // Create-mode sanctioned completion: an explicit Actual Finish with no explicit
  // % Complete records a completed activity (preserved existing create flow).
  if (mode === "create" && af != null && !hasPct) {
    pct = 100;
  }

  // T2b — explicit Actual Finish clearing while completed (approved 99/0 rule).
  // Runs before T1 so an explicit clear is never auto-refilled. Clearing the
  // finish removes the completion facts: stored status is reset and re-derived,
  // and remaining duration is re-derived unless the caller supplied one.
  if (hasAF && af == null && normalizeIsoDate(current.actualFinish) != null) {
    if (hasPct && pct !== null && pct < 100) {
      // explicit % < 100 takes precedence; finish stays cleared.
    } else {
      pct = percentAfterClearingActualFinish(as, hasPct ? pct : null);
    }
    if (status === "completed") status = null;
    if (!hasRem) rem = null;
  }

  // T1 — deliberate completion: % changed to exactly 100 and no Actual Finish
  // (and the caller did not explicitly clear the finish in this edit).
  if (pct === 100 && af == null && !hasAF && (hasPct || mode === "create")) {
    const auto = autoActualFinishFromDataDate(dataDate, as);
    if (!auto.ok) return fail(auto.error);
    af = auto.actualFinish;
    rem = 0;
  }

  // T2 — deliberate un-completion: % reduced below 100 while a finish exists.
  if (hasPct && pct !== null && pct < 100 && af != null) {
    // Explicitly supplying a finish together with % < 100 is a contradiction.
    if (hasAF) {
      return fail("Actual Finish requires 100% complete; set percentComplete to 100 or clear Actual Finish");
    }
    af = null;
    if (status === "completed") status = null;
    if (!hasRem) rem = null;
  }

  // V3 — actual date range (checked before V2 so a reversed range surfaces as a
  // range error, matching the established user-facing message).
  if (as != null && af != null && as > af) {
    return fail("Actual start must be on or before actual finish");
  }

  // V2 — Actual Finish with < 100% (safety net for any path not handled above).
  if (af != null && pct < 100) {
    return fail("Actual Finish requires 100% complete; set percentComplete to 100 or clear Actual Finish");
  }

  // Derived state and remaining duration.
  const derived = deriveProgressState(pct, as, af);
  const completedNow = derived === "completed";
  // NULL status is the canonical "not-started" representation (legacy rows store
  // NULL); comparisons treat them as equivalent.
  const statusEquivalent = (a: string | null | undefined, b: string | null | undefined): boolean =>
    (a ?? "not-started") === (b ?? "not-started");

  // V4 — completed with positive remaining duration (only an EXPLICIT remaining
  // value is contradictory; a stored value is superseded by completion).
  if (completedNow) {
    if (hasRem && rem != null && rem > 0) {
      return fail("Completed activities cannot have a positive remaining duration");
    }
    rem = 0;
  } else if (rem == null || hasPct || hasAF) {
    rem = deriveRemainingDuration(orig, pct, rem);
  }

  // V9 — explicit status must match the canonical derived state.
  if (hasStatus && status != null && !statusEquivalent(status, derived)) {
    return fail(`Status "${status}" does not match the progress state "${derived}"`);
  }

  // Derive status whenever any progress field changed.
  let derivedStatus: string | null = current.status;
  if (hasPct || hasAS || hasAF || hasStatus) {
    derivedStatus = derived;
  }

  const curAS = normalizeIsoDate(current.actualStart);
  const curAF = normalizeIsoDate(current.actualFinish);
  const curPct = current.percentComplete ?? 0;
  const curRem = current.remainingDurationDays ?? 0;
  const noop =
    pct === curPct &&
    as === curAS &&
    af === curAF &&
    statusEquivalent(derivedStatus, current.status) &&
    (rem ?? 0) === curRem;

  if (noop) return { ok: true, values: {}, noop: true };

  const values: NonNullable<ProgressResult["values"]> = {};
  if (pct !== curPct) values.percentComplete = pct;
  if (as !== curAS) values.actualStart = as;
  if (af !== curAF) values.actualFinish = af;
  if (!statusEquivalent(derivedStatus, current.status)) values.status = derivedStatus;
  if ((rem ?? 0) !== curRem) values.remainingDurationDays = rem;

  return { ok: true, values, noop: false };
}
