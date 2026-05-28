/* ─── Gantt UI Utilities Engine — KPI Calculation, Status Badges, Formatting ─── */
import { GanttTask, parseDate, normProgress, deriveStatus } from "./schedulingEngine";

export interface KpiData {
  totalTasks: number;
  completed: number;
  inProgress: number;
  overdue: number;
  completionRate: number;
  avgDuration: number;
}

export function normalizeTaskStatus(status: any): "completed" | "in progress" | "not started" | "other" {
  const value = `${status ?? ""}`.trim().toLowerCase();
  if (value.includes("complete") || value === "done" || value === "closed") return "completed";
  if (value.includes("in progress")) return "in progress";
  if (value.includes("not started")) return "not started";
  return "other";
}

export function taskCompletionPercent(task: any): number {
  const status = normalizeTaskStatus(task.status ?? task.Status);
  if (status === "completed") return 100;
  if (status === "not started") return 0;

  const rawProgress = task.progressPercent ?? task.progress_percent ?? task.progress;
  const hasProgress = rawProgress !== null && rawProgress !== undefined && `${rawProgress}`.trim() !== "";
  if (status === "in progress") {
    return hasProgress ? Math.max(0, Math.min(100, normProgress(rawProgress))) : 50;
  }

  if (hasProgress) return Math.max(0, Math.min(100, normProgress(rawProgress)));
  return 0;
}

export function calcProjectCompletion(tasks: any[]): number {
  if (!tasks.length) return 0;
  const durations = tasks.map((t) => {
    const n = Number(t.duration_days ?? t.duration ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const useEqualWeighting = durations.every((d) => d <= 0);
  if (useEqualWeighting) {
    const avg = tasks.reduce((sum, t) => sum + taskCompletionPercent(t), 0) / tasks.length;
    return Math.round(avg);
  }
  const totalDuration = durations.reduce((sum, d) => sum + d, 0);
  if (totalDuration <= 0) return 0;
  const weighted = tasks.reduce((sum, t, idx) => sum + taskCompletionPercent(t) * durations[idx], 0);
  return Math.round(weighted / totalDuration);
}

export function calcKpi(tasks: any[]): KpiData {
  const now = new Date();
  const total = tasks.length;
  const completed = tasks.filter((t: any) => normalizeTaskStatus(t.status ?? t.Status) === "completed").length;
  const inProgress = tasks.filter((t: any) => normalizeTaskStatus(t.status ?? t.Status) === "in progress").length;
  const overdue = tasks.filter((t: any) => {
    const end = t.endDate
      ? parseDate(t.endDate)
      : t.startDate
        ? new Date(new Date(t.startDate).getTime() + (t.duration || 1) * 86400000)
        : null;
    return end && end < now && normalizeTaskStatus(t.status ?? t.Status) !== "completed";
  }).length;
  const completionRate = calcProjectCompletion(tasks);
  const avgDuration = total > 0
    ? Math.round(tasks.reduce((s: number, t: any) => s + (t.duration || 0), 0) / total)
    : 0;
  return { totalTasks: total, completed, inProgress, overdue, completionRate, avgDuration };
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    "Completed": "#22C55E",
    "In Progress": "#3B82F6",
    "In Progress (Delayed)": "#EF4444",
    "Not Started": "#9CA3AF",
    "Delayed": "#F59E0B",
  };
  return map[status] || "#9CA3AF";
}

export function statusBg(status: string): string {
  const map: Record<string, string> = {
    "Completed": "#DCFCE7",
    "In Progress": "#DBEAFE",
    "In Progress (Delayed)": "#FEE2E2",
    "Not Started": "#F1F5F9",
    "Delayed": "#FEF3C7",
    "Overdue": "#FEE2E2",
  };
  return map[status] || "#F1F5F9";
}

export function statusBadgeStyle(status: string): { bg: string; color: string } {
  const map: Record<string, { bg: string; color: string }> = {
    "Completed": { bg: "#DCFCE7", color: "#166534" },
    "In Progress": { bg: "#DBEAFE", color: "#1E40AF" },
    "In Progress (Delayed)": { bg: "#FEE2E2", color: "#991B1B" },
    "Delayed": { bg: "#FEF3C7", color: "#92400E" },
    "Not Started": { bg: "#F1F5F9", color: "#475569" },
  };
  return map[status] || map["Not Started"];
}

export function rowStatus(t: GanttTask): string {
  return t.status || deriveStatus(t);
}

export function fmtMonth(d: Date): string {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return M[d.getMonth()] + " " + d.getFullYear();
}

export function fmtShortDate(d: Date): string {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return M[d.getMonth()] + " " + d.getDate();
}

export function fmtDateStr(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = parseDate(dateStr);
  if (!d) return "—";
  return fmtShortDate(d);
}
