/**
 * dateValidation.ts — strict date parser for Gantt date fields.
 *
 * Supported formats:
 *   - YYYY-MM-DD
 *   - YYYY-MM-DD HH:MM
 *
 * Rejects impossible dates such as 2026-02-31 and invalid months.
 * Does not accept arbitrary separators or missing leading zeros.
 */

export function isValidGanttDate(value: string): boolean {
  if (!value) return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
  if (!m) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] !== undefined ? Number(m[4]) : 0;
  const minute = m[5] !== undefined ? Number(m[5]) : 0;

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;

  // Check actual calendar validity using built-in Date.
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return false;
  }
  return true;
}
