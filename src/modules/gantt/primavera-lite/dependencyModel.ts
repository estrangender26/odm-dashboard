import { SCHEDULE_ROW_HEIGHT, sortActivities, type ActivityGridRow } from "./activityGridModel";
import { plannedDates, timelinePosition, timelineSpan } from "./timelineModel";

export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type DependencyRow = {
  id: number;
  predecessorActivityId: number;
  successorActivityId: number;
  dependencyType: DependencyType;
  lagDays: number;
  revision?: number;
  archivedAt?: string | Date | null;
};

export function sortDependencies<T extends Pick<DependencyRow, "id">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id - b.id);
}

export function optimisticDependencyUpdate<T extends Pick<DependencyRow, "id">>(rows: T[], id: number, changes: Partial<T>): T[] {
  return rows.map((row) => row.id === id ? { ...row, ...changes } : row);
}

export function optimisticDependencyArchive<T extends Pick<DependencyRow, "id">>(rows: T[], id: number): T[] {
  return rows.filter((row) => row.id !== id);
}

export function dependencyPermissions(role: "admin" | "editor" | "viewer") {
  return { canEdit: role === "admin" || role === "editor", readOnly: role === "viewer" };
}

export type DependencyGeometry = {
  id: number;
  type: DependencyType;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  path: string;
};

export function dependencyLineGeometry(
  dependencies: DependencyRow[], activitiesInput: ActivityGridRow[], rangeStart: Date, pixelsPerDay: number
): DependencyGeometry[] {
  const activities = sortActivities(activitiesInput);
  const rowIndex = new Map(activities.map((activity, index) => [activity.id, index]));
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const geometry: DependencyGeometry[] = [];
  for (const dependency of dependencies) {
    const predecessor = byId.get(dependency.predecessorActivityId);
    const successor = byId.get(dependency.successorActivityId);
    const predDates = predecessor && plannedDates(predecessor);
    const succDates = successor && plannedDates(successor);
    if (!predecessor || !successor || !predDates || !succDates) continue;
    const predLeft = timelinePosition(predDates.start, rangeStart, pixelsPerDay);
    const predRight = predLeft + timelineSpan(predDates.start, predDates.finish, pixelsPerDay);
    const succLeft = timelinePosition(succDates.start, rangeStart, pixelsPerDay);
    const succRight = succLeft + timelineSpan(succDates.start, succDates.finish, pixelsPerDay);
    const startX = dependency.dependencyType[0] === "F" ? predRight : predLeft;
    const endX = dependency.dependencyType[1] === "F" ? succRight : succLeft;
    const startY = rowIndex.get(predecessor.id)! * SCHEDULE_ROW_HEIGHT + SCHEDULE_ROW_HEIGHT / 2;
    const endY = rowIndex.get(successor.id)! * SCHEDULE_ROW_HEIGHT + SCHEDULE_ROW_HEIGHT / 2;
    const bendX = startX + Math.max(8, (endX - startX) / 2);
    geometry.push({ id: dependency.id, type: dependency.dependencyType, startX, startY, endX, endY,
      path: `M ${startX} ${startY} H ${bendX} V ${endY} H ${endX}` });
  }
  return geometry;
}
