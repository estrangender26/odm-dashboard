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

export function calcKpi(tasks: any[]): KpiData {
  const now = new Date();
  const total = tasks.length;
  const completed = tasks.filter((t: any) => normProgress(t.progress) >= 100).length;
  const inProgress = tasks.filter((t: any) => {
    const p = normProgress(t.progress);
    return p > 0 && p < 100;
  }).length;
  const overdue = tasks.filter((t: any) => {
    const end = t.endDate
      ? parseDate(t.endDate)
      : t.startDate
        ? new Date(new Date(t.startDate).getTime() + (t.duration || 1) * 86400000)
        : null;
    return end && end < now && normProgress(t.progress) < 100;
  }).length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
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
