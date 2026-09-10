/**
 * Facility Uptime display precision (PR #427).
 *
 * Presentation-only rule for the Facility Uptime KPI:
 *
 *  - an authoritative EXACT 100 displays as "100%" (never "100.00%");
 *  - every other value displays with AT MOST two decimals;
 *  - a BELOW-100 value is TRUNCATED (floored) at two decimals, so a value such
 *    as 99.99621384219294 can never be displayed as "100%" or "100.00%".
 *
 * Only the DISPLAY string changes. Source values, thresholds, status
 * evaluation and RAG cell colours keep using the untouched full-precision
 * value (a 99.9962% uptime remains amber/below the =100% target even though it
 * now displays as 99.99%).
 *
 * PM Compliance keeps its own formatter (formatPrecisePercent) and is NOT
 * affected by this module.
 */

/**
 * Absorbs binary floating-point noise without ever crossing a real cent
 * boundary. At these magnitudes the multiplication noise is ~1e-11
 * (e.g. 99.89 * 100 === 9988.999999999998), while the smallest genuine gap to
 * the next cent that must still truncate downwards (99.999999999) is ~1e-7 —
 * so 1e-9 corrects noise and never rounds a below-100 value up.
 */
const TRUNCATION_EPSILON = 1e-9;

function trimTrailingZeros(fixed: string): string {
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function formatFacilityUptimePercent(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Authoritative exact 100 is the only value that may read as a whole 100%.
  if (value === 100) return "100%";
  if (value < 100) {
    // Deterministic truncation: the displayed uptime never overstates the
    // authoritative value, so a below-100 result can never look like 100%.
    const truncated = Math.floor(value * 100 + TRUNCATION_EPSILON) / 100;
    return `${trimTrailingZeros(truncated.toFixed(2))}%`;
  }
  // Above-100 values are out of the below-100 safeguard and keep the existing
  // two-decimal rounding convention.
  return `${trimTrailingZeros(value.toFixed(2))}%`;
}
