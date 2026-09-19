/**
 * Public TYPE surface of @lihok/project-controls.
 *
 * Types are re-exported from the module that declares them rather than being
 * re-declared here, so every domain type still has exactly ONE declaration
 * (re-declaring them would create the fork this extraction exists to prevent).
 */
export type {
  ScheduleActivityInput,
  ScheduleCalendarInput,
  ScheduleDependencyInput,
  ScheduledActivityOutput,
} from "./schedulingEngine";
export type {
  ProgressStatus,
  ProgressState,
  ProgressFields,
  ProgressEdit,
  ProgressResult,
} from "./progressModel";
export type {
  ActivityLifecycle,
  StatusingActivityInput,
  StatusingSummary,
  StatusingWarning,
  StatusingWarningCode,
} from "./statusingModel";
export type {
  BaselineVarianceStatus,
  BaselineSnapshotInput,
  CurrentActivityInput,
  BaselineComparisonRow,
  BaselineProjectComparison,
  ActiveBaselineInput,
  BaselineStateDescription,
} from "./baselineVariance";
export type { ScheduleAuditEvent } from "./scheduleStaleness";
