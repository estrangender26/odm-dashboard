/**
 * @lihok/project-controls — authoritative Lihok project-controls domain.
 *
 * PUBLIC API. This entry point is intentionally curated: it exposes the stable
 * domain vocabulary that consumers (ODM Dashboard today, other Lihok products
 * later) are allowed to depend on. Deeper helpers stay internal to their
 * modules and must not be deep-imported — see
 * src/lib/project-controls-boundary.test.ts.
 *
 * Boundary rules for this package:
 *   - pure TypeScript: no React, no tRPC, no Drizzle, no database, no ODM import
 *   - no runtime dependencies
 *   - one declaration of every algorithm lives here (the extraction was a move)
 */

/* ── scheduling: CPM engine and working-day arithmetic ───────────────────── */
export {
  runScheduleEngine,
  addWorkingDays,
  subWorkingDays,
  countWorkingDays,
  dateToCalendarDay,
  calendarDayToDate,
  isWorkingDay,
  getWorkingDuration,
  resolveDefaultCalendar,
} from "./schedulingEngine";
export type {
  ScheduleActivityInput,
  ScheduleCalendarInput,
  ScheduleDependencyInput,
  ScheduledActivityOutput,
} from "./schedulingEngine";

/* ── calendars: working-day validation and schedule-affecting rules ──────── */
export {
  WEEKDAY_LABELS,
  normalizeWorkingDays,
  validateWorkingDays,
  workingDaysEqual,
  formatWorkingDays,
  calendarAffectsActiveSchedule,
} from "./calendarModel";

/* ── progress and Data Date semantics (the #440 contract) ────────────────── */
export {
  VALID_PROGRESS_STATUSES,
  PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE,
  hundredPercentDataDateConflictMessage,
  normalizeIsoDate,
  isValidIsoDate,
  deriveProgressState,
  isCompletedState,
  percentAfterClearingActualFinish,
  autoActualFinishFromDataDate,
  deriveRemainingDuration,
  resolveProgress,
} from "./progressModel";
export type {
  ProgressStatus,
  ProgressState,
  ProgressFields,
  ProgressEdit,
  ProgressResult,
} from "./progressModel";

/* ── statusing: derived lifecycle and project roll-up ────────────────────── */
export {
  activityLifecycle,
  forecastRemainingDays,
  isCurrentWork,
  summarizeStatusing,
  LIFECYCLE_LABELS,
  // NOTE: presentation-only (Tailwind class names) currently consumed by the ODM
  // panel. Exported so the extraction changes no behaviour; relocating it to the
  // UI layer is a follow-up cleanup, not part of M1.
  LIFECYCLE_CHIP_CLASS,
} from "./statusingModel";
export type {
  ActivityLifecycle,
  StatusingActivityInput,
  StatusingSummary,
  StatusingWarning,
  StatusingWarningCode,
} from "./statusingModel";

/* ── baseline comparison and variance semantics (the #441 contract) ─────── */
export {
  calendarDayVariance,
  durationDayVariance,
  currentDurationDays,
  statusForComparison,
  compareActivityToBaseline,
  buildProjectComparison,
  describeBaselineState,
  selectActiveBaseline,
  baselineCapturedDate,
  BASELINE_STATUS_LABELS,
  BASELINE_STATUS_SYMBOLS,
} from "./baselineVariance";
export type {
  BaselineVarianceStatus,
  BaselineSnapshotInput,
  CurrentActivityInput,
  BaselineComparisonRow,
  BaselineProjectComparison,
  ActiveBaselineInput,
  BaselineStateDescription,
} from "./baselineVariance";

/* ── schedule staleness: which audited changes invalidate a schedule ─────── */
export { isCpmDrivingEvent, isScheduleOutOfDate } from "./scheduleStaleness";
export type { ScheduleAuditEvent } from "./scheduleStaleness";
