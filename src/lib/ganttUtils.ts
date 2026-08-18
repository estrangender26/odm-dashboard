/* ─── Generic Gantt utility helpers used by AIAssistant and other consumers.
 * These were extracted from the legacy Gantt engine so the engine modules can
 * be removed without breaking shared behavior. They are intentionally pure,
 * dependency-free, and accept loose `any` shapes so they remain reusable.
 * ─── */

const today = new Date();
today.setHours(0, 0, 0, 0);

function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

export function normProgress(p: number | string | undefined): number {
  const n = typeof p === "string" ? parseFloat(p) : (p ?? 0);
  if (typeof n !== "number" || isNaN(n)) return 0;
  return n > 1 ? Math.round(n) : Math.round(n * 100);
}

function deriveStatus(t: {
  startDate?: string;
  endDate?: string;
  plannedEnd?: string;
}): string {
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

export function rowStatus(t: {
  status?: string;
  startDate?: string;
  endDate?: string;
  plannedEnd?: string;
}): string {
  return t.status || deriveStatus(t);
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
  return hasProgress ? normProgress(rawProgress) : 0;
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
