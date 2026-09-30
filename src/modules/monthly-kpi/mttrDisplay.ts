/**
 * MTTR (days) display precision.
 *
 * Presentation-only rule for the MTTR KPI:
 *
 *  - MTTR is displayed with AT MOST two decimals;
 *  - trailing zeros are trimmed, so 2.50 reads "2.5" and 2.00 reads "2";
 *  - whole numbers stay whole, so 1 reads "1" and never "1.00";
 *  - values carrying more than two decimals are ROUNDED to two (not truncated),
 *    so an authoritative 0.6666666666666666 reads "0.67" and never "1".
 *
 * Only the DISPLAY string changes. The authoritative MTTR value, the monthly
 * and YTD aggregation that produces it, the "Data exists" benchmark and the RAG
 * status rule all keep using the untouched full-precision number.
 *
 * PM Compliance, Budget Spend, both PM:CM ratios and Facility Uptime keep their
 * own formatters and are NOT affected by this module.
 */

/**
 * Absorbs binary floating-point noise at the third decimal without ever
 * crossing a real hundredth boundary. At these magnitudes the representation
 * error is ~1e-11 (1.005 * 100 === 100.49999999999999), which is exactly the
 * case that would otherwise round a genuine half DOWN instead of up. The
 * correction is far smaller than any real third-decimal difference a stored
 * MTTR value can carry, so it can never move a value across a true boundary.
 */
const ROUNDING_EPSILON = 1e-9;

function trimTrailingZeros(fixed: string): string {
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * Canonical MTTR display formatter: at most two decimals, no needless trailing
 * zeros, whole numbers rendered whole. Every MTTR presentation path (monthly
 * cells, the YTD row, portfolio/executive cards and the executive readout text)
 * must go through this function so those values cannot diverge.
 */
export function formatMttrDays(value: number): string {
  if (!Number.isFinite(value)) return "";
  const scaled = value * 100;
  const rounded =
    Math.round(scaled + (scaled >= 0 ? ROUNDING_EPSILON : -ROUNDING_EPSILON)) /
    100;
  return trimTrailingZeros(rounded.toFixed(2));
}

/**
 * Same rule with the " days" unit suffix used by the data, adapter, portfolio
 * and executive-readout presentation paths.
 */
export function formatMttrDaysWithUnit(value: number): string {
  const display = formatMttrDays(value);
  return display === "" ? "" : `${display} days`;
}
