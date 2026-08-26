/**
 * Manual milestone status override (governance_milestone_state.ready_status).
 *
 * Authorized users can set an explicit presentation status per M1–M9 milestone
 * via the Governance module. The canonical backend values stored in the
 * ready_status column are:
 *
 *   null         = Auto (use the evidence/date/customPct derivation)
 *   achieved     = Achieved
 *   in_progress  = In progress
 *   planned_open = Planned by now — still open
 *   upcoming     = Upcoming
 *
 * The dropdown is a status OVERRIDE only — it never rewrites comp_date,
 * ppp_date, uploaded evidence, or custom_pct.
 *
 * This module is pure (no database, no UI) so both the backend save path and
 * the presentation adapter share one source of truth.
 */

import type { MilestoneStatus } from "./types";

/** Canonical ready_status values allowed by the backend (server-side validated). */
export const APPROVED_MANUAL_STATUSES = [
  "achieved",
  "in_progress",
  "planned_open",
  "upcoming",
] as const;

export type ManualMilestoneStatus = (typeof APPROVED_MANUAL_STATUSES)[number];

/** Human labels for the dropdown / badges. */
export const MANUAL_STATUS_LABELS: Record<ManualMilestoneStatus | "auto", string> = {
  auto: "Auto",
  achieved: "Achieved",
  in_progress: "In progress",
  planned_open: "Planned by now — still open",
  upcoming: "Upcoming",
};

/** Strict server-side validator: only the approved values (or null/undefined for Auto). */
export function isValidManualStatus(value: unknown): value is ManualMilestoneStatus {
  return (
    typeof value === "string" &&
    (APPROVED_MANUAL_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Map a valid manual ready_status to the canonical presentation status, or
 * null when the value is absent/invalid (fall through to automatic
 * derivation). "planned_open" maps to the presentation "gap" state.
 */
export function manualStatusToMilestoneStatus(
  value: string | null | undefined
): MilestoneStatus | null {
  switch (value) {
    case "achieved":
      return "achieved";
    case "in_progress":
      return "in_progress";
    case "planned_open":
      return "gap";
    case "upcoming":
      return "upcoming";
    default:
      return null;
  }
}

/**
 * Ordered dropdown options for the milestone status selector (Auto first).
 * The Governance dashboard renders exactly these five options; the value ""
 * represents Auto (clears the override to null on save).
 */
export const STATUS_DROPDOWN_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: MANUAL_STATUS_LABELS.auto },
  { value: "achieved", label: MANUAL_STATUS_LABELS.achieved },
  { value: "in_progress", label: MANUAL_STATUS_LABELS.in_progress },
  { value: "planned_open", label: MANUAL_STATUS_LABELS.planned_open },
  { value: "upcoming", label: MANUAL_STATUS_LABELS.upcoming },
];

/**
 * Resolve a dropdown selection into the value stored in pending edit state:
 * "" (Auto) -> null (clears the override), otherwise the approved value.
 */
export function resolvePendingReadyStatus(value: string): ManualMilestoneStatus | null {
  return value === "" ? null : (value as ManualMilestoneStatus);
}
