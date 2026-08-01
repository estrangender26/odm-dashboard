/**
 * Font size helpers. OOXML stores font sizes in hundredths of a point.
 */

export function hundredthsToPoints(hundredths: number): number {
  return hundredths / 100;
}

export function pointsToHundredths(points: number): number {
  return Math.round(points * 100);
}
