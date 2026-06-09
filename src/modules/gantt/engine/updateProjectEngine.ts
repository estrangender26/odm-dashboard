import { daysBetween, normProgress, parseDate } from "./schedulingEngine";
import { safeDuration } from "./dependencyEngine";

export interface StatusDateMetric {
  id: number;
  text: string;
  owner: string;
  plannedStart: string;
  plannedEnd: string;
  plannedDuration: number;
  actualProgress: number;
  expectedProgress: number;
  remainingDuration: number;
  varianceDays: number;
  overdue: boolean;
  behindSchedule: boolean;
  status: string;
}

export interface StatusDateSummary {
  totalTasks: number;
  overdue: number;
  behindSchedule: number;
  avgExpectedProgress: number;
  avgActualProgress: number;
  totalRemainingDuration: number;
  avgVarianceDays: number;
}

export interface StatusDatePreview {
  statusDate: string;
  rows: StatusDateMetric[];
  summary: StatusDateSummary;
}

function taskParentId(task: any): number {
  return Number(task.parentTaskId ?? task.parent_task_id ?? task.parent ?? 0) || 0;
}

function isSummaryTask(task: any, tasks: any[]): boolean {
  return tasks.some((candidate) => taskParentId(candidate) === task.id);
}

export function getTaskPlannedStart(task: any): string {
  return (task.plannedStart ?? task.planned_start ?? task.plannedStartDate ?? "").toString().slice(0, 10);
}

export function getTaskPlannedEnd(task: any): string {
  return (task.plannedEnd ?? task.plannedFinish ?? task.planned_finish ?? task.planned_end ?? task.plannedEndDate ?? "").toString().slice(0, 10);
}

export function getTaskText(task: any): string {
  return task.text ?? task.taskName ?? task.task_name ?? `Task ${task.id}`;
}

export function getTaskStatus(task: any): string {
  return task.status ?? task.taskStatus ?? task.task_status ?? "";
}

export function statusDateExpectedProgress(plannedStart: string, plannedEnd: string, statusDate: string): number {
  const start = parseDate(plannedStart);
  const end = parseDate(plannedEnd);
  const status = parseDate(statusDate);
  if (!start || !end || !status) return 0;
  const duration = Math.max(1, daysBetween(start, end) + 1);
  if (status < start) return 0;
  if (status >= end) return 100;
  return Math.min(100, Math.max(0, Math.round(((daysBetween(start, status) + 1) / duration) * 100)));
}

export function buildStatusDatePreview(tasks: any[], statusDate: string): StatusDatePreview {
  const rows = tasks
    .filter((task: any) => !isSummaryTask(task, tasks))
    .map((task: any): StatusDateMetric => {
      const plannedStart = getTaskPlannedStart(task);
      const plannedEnd = getTaskPlannedEnd(task);
      const plannedDuration = calcDurationFromDates(plannedStart, plannedEnd) ?? safeDuration(task.plannedDuration ?? task.duration ?? task.duration_days ?? 1);
      const actualProgress = normProgress(task.progressPercent ?? task.progress ?? task.progress_percent);
      const expectedProgress = statusDateExpectedProgress(plannedStart, plannedEnd, statusDate);
      const remainingDuration = Math.max(0, Math.ceil(plannedDuration * (100 - actualProgress) / 100));
      const varianceDays = Math.round(((actualProgress - expectedProgress) / 100) * plannedDuration);
      const overdue = !!plannedEnd && !!parseDate(statusDate) && !!parseDate(plannedEnd) && parseDate(statusDate)! > parseDate(plannedEnd)! && actualProgress < 100;
      const behindSchedule = actualProgress < expectedProgress && actualProgress < 100;
      return {
        id: task.id,
        text: getTaskText(task),
        owner: task.owner || "Unassigned",
        plannedStart,
        plannedEnd,
        plannedDuration,
        actualProgress,
        expectedProgress,
        remainingDuration,
        varianceDays,
        overdue,
        behindSchedule,
        status: getTaskStatus(task),
      };
    });

  const avg = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const summary: StatusDateSummary = {
    totalTasks: rows.length,
    overdue: rows.filter((row) => row.overdue).length,
    behindSchedule: rows.filter((row) => row.behindSchedule).length,
    avgExpectedProgress: avg(rows.map((row) => row.expectedProgress)),
    avgActualProgress: avg(rows.map((row) => row.actualProgress)),
    totalRemainingDuration: rows.reduce((sum, row) => sum + row.remainingDuration, 0),
    avgVarianceDays: avg(rows.map((row) => row.varianceDays)),
  };

  return { statusDate, rows, summary };
}

export function formatVarianceDays(days: number): string {
  if (days === 0) return "0d";
  return `${days > 0 ? "+" : ""}${days}d`;
}

function calcDurationFromDates(start?: string, end?: string): number | null {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e) return null;
  return Math.max(1, daysBetween(s, e) + 1);
}
