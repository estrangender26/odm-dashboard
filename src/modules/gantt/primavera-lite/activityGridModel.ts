export type ActivityGridRow = {
  id: number;
  wbsNodeId: number;
  sortOrder: number;
  activityId: string | null;
  activityName: string;
  originalDurationDays: number | null;
  calendarId: number | null;
  percentComplete: number | null;
  activityType?: string | null;
  plannedStart?: string | null;
  plannedFinish?: string | null;
  earlyStart?: string | null;
  earlyFinish?: string | null;
  lateStart?: string | null;
  lateFinish?: string | null;
  totalFloatDays?: number | null;
  freeFloatDays?: number | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  archivedAt?: string | Date | null;
};

export const SCHEDULE_ROW_HEIGHT = 40;

export function sortActivities<T extends Pick<ActivityGridRow, "id" | "wbsNodeId" | "sortOrder">>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.wbsNodeId - b.wbsNodeId || a.sortOrder - b.sortOrder || a.id - b.id
  );
}

export function groupActivities<T extends Pick<ActivityGridRow, "wbsNodeId">>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) groups.set(row.wbsNodeId, [...(groups.get(row.wbsNodeId) ?? []), row]);
  return groups;
}

export function optimisticActivityUpdate<T extends { id: number }>(rows: T[], id: number, changes: Partial<T>): T[] {
  return rows.map((row) => row.id === id ? { ...row, ...changes } : row);
}

export function optimisticActivityArchive<T extends Pick<ActivityGridRow, "id" | "wbsNodeId" | "sortOrder">>(rows: T[], id: number): T[] {
  const archived = rows.find((row) => row.id === id);
  if (!archived) return rows;
  const remaining = rows.filter((row) => row.id !== id);
  const source = remaining.filter((row) => row.wbsNodeId === archived.wbsNodeId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const sourceOrder = new Map(source.map((row, index) => [row.id, index]));
  return sortActivities(remaining.map((row) =>
    row.wbsNodeId === archived.wbsNodeId ? { ...row, sortOrder: sourceOrder.get(row.id)! } : row
  ));
}

// Canonical progress/completion rules live in progressModel.ts (F-10). The grid
// helpers below re-export them so both layers share one implementation.
import { autoActualFinishFromDataDate, normalizeIsoDate, percentAfterClearingActualFinish } from "./progressModel";
export {
  PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE,
  autoActualFinishFromDataDate,
  deriveProgressState,
  deriveRemainingDuration,
  hundredPercentDataDateConflictMessage,
  isCompletedState,
  isValidIsoDate,
  normalizeIsoDate,
  percentAfterClearingActualFinish,
} from "./progressModel";
export type { ProgressEdit, ProgressFields, ProgressResult, ProgressState, ProgressStatus } from "./progressModel";

export function validateHundredPercentEdit(
  activity: Pick<ActivityGridRow, "actualStart" | "actualFinish">,
  dataDate: string | null | undefined
): string | null {
  const existingFinish = normalizeIsoDate(activity.actualFinish);
  if (existingFinish) return null;
  const result = autoActualFinishFromDataDate(dataDate, activity.actualStart ?? null);
  return result.ok ? null : result.error;
}

export function optimisticActivityEdit<T extends Pick<ActivityGridRow, "id" | "wbsNodeId" | "sortOrder">>(
  rows: T[], id: number, changes: Partial<T>, dataDate?: string | null
): T[] {
  const current = rows.find((row) => row.id === id);
  if (!current) return rows;
  const mergedChanges: any = { ...changes };

  const effActualStart = mergedChanges.actualStart !== undefined
    ? (mergedChanges.actualStart == null || String(mergedChanges.actualStart).trim() === ""
      ? null
      : mergedChanges.actualStart)
    : (current as any).actualStart;

  if (mergedChanges.actualFinish !== undefined) {
    if (mergedChanges.actualFinish != null && String(mergedChanges.actualFinish).trim() !== "") {
      if (mergedChanges.percentComplete === undefined) {
        mergedChanges.percentComplete = 100;
      }
    } else {
      // Clearing Actual Finish. Explicit % Complete < 100 takes precedence.
      const explicit = mergedChanges.percentComplete;
      if (explicit !== undefined && explicit !== null) {
        if (explicit >= 100) {
          mergedChanges.percentComplete = percentAfterClearingActualFinish(effActualStart, explicit);
        }
      } else if ((current as any).percentComplete === 100) {
        mergedChanges.percentComplete = percentAfterClearingActualFinish(effActualStart);
      }
    }
  } else if (mergedChanges.percentComplete !== undefined) {
    if (mergedChanges.percentComplete === 100) {
      const currentFinish = (current as any).actualFinish;
      const hasFinish = currentFinish != null && String(currentFinish).trim() !== "";
      if (!hasFinish) {
        const auto = autoActualFinishFromDataDate(dataDate, effActualStart);
        if (auto.ok) {
          mergedChanges.actualFinish = auto.actualFinish;
        }
        // Missing/invalid Data Date or Data Date < Actual Start: do not invent today.
      }
    } else if (mergedChanges.percentComplete < 100) {
      mergedChanges.actualFinish = null;
    }
  }

  if (changes.wbsNodeId !== undefined && changes.wbsNodeId !== current.wbsNodeId) {
    const moved = optimisticActivityReorder(rows, id, changes.wbsNodeId, Number.MAX_SAFE_INTEGER);
    return moved.map((row) => row.id === id ? { ...row, ...mergedChanges } : row);
  }
  return optimisticActivityUpdate(rows, id, mergedChanges);
}

export function selectValidNewWbs(currentWbsId: number | null, leafNodeIds: number[]): number | null {
  if (currentWbsId !== null && leafNodeIds.includes(currentWbsId)) return currentWbsId;
  return leafNodeIds[0] ?? null;
}

export function optimisticActivityReorder<T extends Pick<ActivityGridRow, "id" | "wbsNodeId" | "sortOrder">>(
  rows: T[], activityId: number, targetWbsNodeId: number, newSortOrder: number
): T[] {
  const moved = rows.find((row) => row.id === activityId);
  if (!moved) return rows;
  const sourceWbsNodeId = moved.wbsNodeId;
  const unaffected = rows.filter((row) => row.id !== activityId);
  const target = unaffected.filter((row) => row.wbsNodeId === targetWbsNodeId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  target.splice(Math.min(newSortOrder, target.length), 0, { ...moved, wbsNodeId: targetWbsNodeId });
  const targetIds = new Set(target.map((row) => row.id));
  return sortActivities(unaffected.map((row) => {
    if (targetIds.has(row.id)) return { ...row, sortOrder: target.findIndex((item) => item.id === row.id) };
    if (sourceWbsNodeId !== targetWbsNodeId && row.wbsNodeId === sourceWbsNodeId) {
      const source = unaffected.filter((item) => item.wbsNodeId === sourceWbsNodeId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      return { ...row, sortOrder: source.findIndex((item) => item.id === row.id) };
    }
    return row;
  }).concat([{ ...moved, wbsNodeId: targetWbsNodeId, sortOrder: target.findIndex((row) => row.id === activityId) }] as T[]));
}

export function optimisticActivityRestore<T extends Pick<ActivityGridRow, "id" | "archivedAt">>(rows: T[], id: number): T[] {
  return rows.map((row) => (row.id === id ? ({ ...row, archivedAt: null } as T) : row));
}
export function validateActivityEdit(field: string, value: unknown): string | null {
  if (field === "activityName" && (!String(value).trim() || String(value).length > 500)) return "Name is required";
  if (field === "originalDurationDays" && (!Number.isInteger(Number(value)) || Number(value) < 0)) return "Duration must be a whole number of 0 or more";
  if (field === "percentComplete" && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 100)) return "Percent complete must be a whole number from 0 to 100";
  if (field === "plannedStart" || field === "plannedFinish" || field === "actualStart" || field === "actualFinish") {
    const v = value == null || value === "" ? null : String(value);
    return validateDateField(v);
  }
  return null;
}

/** Format a stored/edited date (Date or "YYYY-MM-DD" string) into a "YYYY-MM-DD" input value. */
export function formatDate(value: unknown): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/** Validate a single date field. Blank (empty/null) is allowed. */
export function validateDateField(value: string | null): string | null {
  if (value == null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date must be in YYYY-MM-DD format";
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
    return "Date must be a valid YYYY-MM-DD";
  }
  return null;
}

/** Validate a start/finish date pair (both endpoints provided) for a planned/actual range. */
export function validateDatePair(start: string | null, finish: string | null, label: string): string | null {
  if (start && finish && start > finish) return `${label} start must be on or before ${label.toLowerCase()} finish`;
  return null;
}

/**
 * Field-type-aware equality for detecting no-op edits.
 *
 * - date fields (plannedStart/plannedFinish/actualStart/actualFinish) are compared
 *   after canonical YYYY-MM-DD normalization;
 * - numeric fields (originalDurationDays/percentComplete/wbsNodeId) compare by number;
 * - calendarId compares by number/null;
 * - all other text fields compare by exact string equality.
 *
 * This must NOT use formatDate() for non-date fields, because formatDate()
 * truncates any value that merely looks like an ISO date (e.g. an activity name
 * such as "2026-08-13 Inspection A" would be collapsed to "2026-08-13").
 */
export function isActivityEditNoop(
  activity: ActivityGridRow,
  field: keyof ActivityGridRow | "calendarId",
  value: unknown
): boolean {
  const current = activity[field];
  if (field === "plannedStart" || field === "plannedFinish" || field === "actualStart" || field === "actualFinish") {
    return (formatDate(current) || null) === (formatDate(value) || null);
  }
  if (field === "originalDurationDays" || field === "percentComplete" || field === "wbsNodeId") {
    const a = current == null || current === "" ? NaN : Number(current);
    const b = value == null || value === "" ? NaN : Number(value);
    return a === b;
  }
  if (field === "calendarId") {
    const a = current == null ? null : Number(current);
    const b = value == null ? null : Number(value);
    return a === b;
  }
  const a = current == null ? "" : String(current);
  const b = value == null ? "" : String(value);
  return a === b;
}

export function activityGridPermissions(role: "admin" | "editor" | "viewer") {
  return { readOnly: role === "viewer", canEdit: role === "admin" || role === "editor" };
}

export type ConflictRecovery = { activityId: number; field: string; attemptedValue: unknown } | null;

export function preserveConflictAttempt(activityId: number, field: string, attemptedValue: unknown): ConflictRecovery {
  return { activityId, field, attemptedValue };
}
