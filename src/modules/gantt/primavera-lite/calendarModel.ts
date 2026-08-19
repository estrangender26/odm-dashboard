export const WEEKDAY_LABELS: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

const VALID_WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6, 7]);

export function normalizeWorkingDays(days: number[]): number[] {
  const normalized = days.map((d) => (d === 7 ? 0 : d));
  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

export function validateWorkingDays(days: unknown): number[] {
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error("At least one working day is required");
  }
  for (const day of days) {
    if (typeof day !== "number" || !Number.isInteger(day) || !VALID_WEEKDAYS.has(day)) {
      throw new Error("workingDays must contain valid weekday values only (0–6 or 7)");
    }
  }
  const normalized = normalizeWorkingDays(days);
  if (normalized.length === 0) {
    throw new Error("At least one working day is required");
  }
  return normalized;
}

export function workingDaysEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  const na = normalizeWorkingDays(a.filter((d): d is number => typeof d === "number"));
  const nb = normalizeWorkingDays(b.filter((d): d is number => typeof d === "number"));
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

export function formatWorkingDays(days: number[] | null | undefined): string {
  const set = new Set(normalizeWorkingDays(days ?? []));
  return WEEKDAY_LABELS.filter((d) => set.has(d.value)).map((d) => d.short).join(", ");
}

/**
 * A calendar drives the active CPM schedule when it is the project default
 * or it is assigned to at least one non-archived activity.
 */
export function calendarAffectsActiveSchedule(
  projectDefaultCalendarId: number | null | undefined,
  calendarId: number,
  activeActivityCalendarIds: Array<number | null | undefined>
): boolean {
  if (calendarId === projectDefaultCalendarId) return true;
  return activeActivityCalendarIds.some((id) => id === calendarId);
}
