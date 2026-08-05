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

export function optimisticActivityEdit<T extends Pick<ActivityGridRow, "id" | "wbsNodeId" | "sortOrder">>(
  rows: T[], id: number, changes: Partial<T>
): T[] {
  const current = rows.find((row) => row.id === id);
  if (!current) return rows;
  if (changes.wbsNodeId !== undefined && changes.wbsNodeId !== current.wbsNodeId) {
    const moved = optimisticActivityReorder(rows, id, changes.wbsNodeId, Number.MAX_SAFE_INTEGER);
    return moved.map((row) => row.id === id ? { ...row, ...changes } : row);
  }
  return optimisticActivityUpdate(rows, id, changes);
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

export function validateActivityEdit(field: string, value: unknown): string | null {
  if (field === "activityName" && (!String(value).trim() || String(value).length > 500)) return "Name is required";
  if (field === "originalDurationDays" && (!Number.isInteger(Number(value)) || Number(value) < 0)) return "Duration must be a whole number of 0 or more";
  if (field === "percentComplete" && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 100)) return "Percent complete must be a whole number from 0 to 100";
  return null;
}

export function activityGridPermissions(role: "admin" | "editor" | "viewer") {
  return { readOnly: role === "viewer", canEdit: role === "admin" || role === "editor" };
}

export type ConflictRecovery = { activityId: number; field: string; attemptedValue: unknown } | null;

export function preserveConflictAttempt(activityId: number, field: string, attemptedValue: unknown): ConflictRecovery {
  return { activityId, field, attemptedValue };
}
