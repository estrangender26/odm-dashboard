/* ─── Gantt Scheduling Engine — Pure Date/Math Utilities ─── */

export interface GanttTask {
  id: number; text: string; owner?: string;
  startDate?: string; endDate?: string; duration?: number;
  plannedStart?: string; plannedEnd?: string;
  progress?: number; status?: string; remarks?: string;
  type?: string; parent?: number; category?: string;
  sortorder?: number; open?: number;
  frontendTaskUid?: string;
  parentFrontendUid?: string;
  predecessorFrontendUid?: string;
}

export interface GanttLink {
  id: number; source: number; target: number;
  type: string; lag?: number;
}

export const today = new Date();
today.setHours(0, 0, 0, 0);

export function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

export function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}

export function normProgress(p: number | string | undefined): number {
  const n = typeof p === "string" ? parseFloat(p) : (p ?? 0);
  if (typeof n !== "number" || isNaN(n)) return 0;
  return n > 1 ? Math.round(n) : Math.round(n * 100);
}

export function deriveStatus(t: GanttTask): string {
  const aStart = parseDate(t.startDate);
  const aEnd = parseDate(t.endDate);
  const pEnd = parseDate(t.plannedEnd);
  if (aEnd) return "Completed";
  if (aStart) {
    const isDelayed = pEnd ? today > pEnd : false;
    return isDelayed ? "In Progress (Delayed)" : "In Progress";
  }
  return "Not Started";
}

export function rowStatus(t: GanttTask): string {
  return t.status || deriveStatus(t);
}

export function taskToForm(t: GanttTask) {
  return {
    text: t.text || "", owner: t.owner || "",
    plannedStart: t.plannedStart || "", plannedEnd: t.plannedEnd || "",
    actualStart: t.startDate || "", actualEnd: t.endDate || "",
    duration: t.duration || 1,
    progress: normProgress(t.progress),
    status: rowStatus(t),
    remarks: t.remarks || "",
    type: t.type || "task",
    parent: t.parent || 0,
  };
}

export interface TaskForm {
  text: string; owner: string;
  plannedStart: string; plannedEnd: string;
  actualStart: string; actualEnd: string;
  duration: number; progress: number;
  status: string; remarks: string;
  type: string; parent: number;
}

export const EMPTY_FORM: TaskForm = {
  text: "", owner: "", plannedStart: "", plannedEnd: "",
  actualStart: "", actualEnd: "", duration: 1, progress: 0,
  status: "", remarks: "", type: "task", parent: 0,
};

export const DEP_TYPE_MAP: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
export const DEP_TYPE_REVERSE: Record<string, string> = { "FS": "0", "SS": "1", "FF": "2", "SF": "3" };

export function depTypeName(type: string): string {
  return DEP_TYPE_MAP[type] || type;
}

export interface TaskNode {
  task: GanttTask;
  level: number;
  children: TaskNode[];
  isExpanded: boolean;
}

export function buildTaskTree(tasks: GanttTask[]): TaskNode[] {
  const taskMap = new Map<number, TaskNode>();
  tasks.forEach(t => taskMap.set(t.id, { task: t, level: 0, children: [], isExpanded: true }));
  const roots: TaskNode[] = [];
  tasks.forEach(t => {
    const node = taskMap.get(t.id)!;
    if (t.parent && taskMap.has(t.parent)) {
      const p = taskMap.get(t.parent)!;
      p.children.push(node);
      node.level = p.level + 1;
    } else {
      roots.push(node);
    }
  });
  return roots;
}

export function flattenVisible(nodes: TaskNode[]): { task: GanttTask; level: number; hasChildren: boolean }[] {
  const result: { task: GanttTask; level: number; hasChildren: boolean }[] = [];
  nodes.forEach(n => {
    result.push({ task: n.task, level: n.level, hasChildren: n.children.length > 0 });
    if (n.isExpanded) result.push(...flattenVisible(n.children));
  });
  return result;
}
