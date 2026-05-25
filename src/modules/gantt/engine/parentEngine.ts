/* ─── Gantt Parent Engine — Auto-calculate parent bars from children ─── */
import { normProgress } from "./schedulingEngine";
import { recalculateParentRollups, getChangedParents as getRollupChangedParents } from "./rollupEngine";

export interface ParentCalc {
  plannedStart: string;
  plannedEnd: string;
  startDate: string;
  endDate: string;
  duration: number;
  progress: number;
  status: string;
}

/* Check if a task is a parent (has children) */
export function isParent(taskId: number, allTasks: any[]): boolean {
  return allTasks.some((t: any) => t.parent === taskId && t.id !== taskId);
}

/* Get direct children of a task */
export function getChildren(taskId: number, allTasks: any[]): any[] {
  return allTasks.filter((t: any) => t.parent === taskId && t.id !== taskId);
}

/* Calculate parent values from children */
export function calculateParentFromChildren(parent: any, allTasks: any[]): ParentCalc {
  const recalculated = recalculateParentRollups(allTasks);
  const updatedParent = recalculated.find((t: any) => t.id === parent.id) || parent;

  return {
    plannedStart: updatedParent.plannedStart || "",
    plannedEnd: updatedParent.plannedEnd || "",
    startDate: updatedParent.startDate || "",
    endDate: updatedParent.endDate || "",
    duration: updatedParent.duration || 1,
    progress: normProgress(updatedParent.progress),
    status: updatedParent.status || "Not Started",
  };
}

/* Recalculate ALL parent tasks in a tree */
export function recalculateAllParents(allTasks: any[]): any[] {
  return recalculateParentRollups(allTasks).map((task: any) => {
    if (!isParent(task.id, allTasks)) return task;
    return { ...task, type: task.type || "project" };
  });
}

/* Get changed parents after recalculation */
export function getChangedParents(recalculated: any[], original: any[]): any[] {
  return getRollupChangedParents(recalculated, original).filter((task: any) => isParent(task.id, recalculated));
}

/* Parent bar visual style */
export function parentBarStyle(): {
  plannedColor: string; actualColor: string; borderColor: string;
  height: number; borderWidth: number; borderRadius: number;
} {
  return {
    plannedColor: "rgba(30,64,175,0.25)",
    actualColor: "rgba(30,64,175,0.6)",
    borderColor: "#1E3A8F",
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
  };
}

/* Check if a field is editable for a given task */
export function isFieldEditable(task: any, allTasks: any[], field: "dates" | "duration" | "progress" | "name" | "owner" | "parent" | "predecessor" | "status" | "remarks"): boolean {
  const hasChildren = isParent(task?.id ?? 0, allTasks);
  if (!hasChildren) return true; // normal task — all fields editable

  // Parent task — only certain fields editable
  switch (field) {
    case "name":
    case "owner":
    case "parent":
    case "predecessor":
    case "status":
    case "remarks":
      return true;
    case "dates":
    case "duration":
    case "progress":
      return false; // auto-calculated
    default:
      return true;
  }
}
