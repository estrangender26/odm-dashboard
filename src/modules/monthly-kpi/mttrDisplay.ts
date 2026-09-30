/**
 * MTTR display precision (PR #445).
 *
 * Presentation-only rule for the MTTR (days) KPI:
 *
 *  - at most two decimals;
 *  - no unnecessary trailing zeros (2.5 renders as "2.5", never "2.50");
 *  - a whole number stays whole (1 renders as "1", never "1.00" or "1.0").
 *
 *   0        -> "0"
 *   1        -> "1"
 *   2        -> "2"
 *   1.2      -> "1.2"
 *   0.5      -> "0.5"
 *   1.25     -> "1.25"
 *   0.67     -> "0.67"
 *   0.666... -> "0.67"
 *   1.236... -> "1.24"
 *   2.50     -> "2.5"
 *   2.00     -> "2"
 *
 * Only the DISPLAY string changes. The MTTR calculation, source/raw values,
 * monthly and YTD aggregation, the KPI target/benchmark and the colour/status
 * evaluation all keep using the untouched authoritative value: a 0.666666...
 * day MTTR is still evaluated from 0.666666..., it merely reads as "0.67"
 * instead of being rounded up to the whole number "1".
 *
 * Implemented once and shared by every Monthly KPI presentation path that
 * renders MTTR (single-BU scorecard monthly + YTD cells and the Slide 2/3 value
 * lists, All-BU scorecard monthly + YTD cells, the All-BU summary values, the
 * executive readout/commentary text and the adapter MonthlyKpiValue.formatted
 * used by executive slide text), so monthly and YTD presentation values cannot
 * diverge.
 */

/**
 * Drop redundant trailing zeros from a fixed-precision decimal string while
 * leaving the digits themselves untouched (never re-parses through Number, so
 * large values can never come back in exponential notation).
 */
function trimTrailingZeros(fixed: string): string {
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * Format an MTTR value in days for presentation display.
 *
 * Non-finite input returns an empty string so callers can never render
 * "NaN" / "Infinity" into a slide cell.
 */
export function formatMttrDaysDisplay(value: number): string {
  if (!Number.isFinite(value)) return "";
  return trimTrailingZeros(value.toFixed(2));
}
