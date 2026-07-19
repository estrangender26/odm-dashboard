/**
 * Deep equality check for JSON-compatible values.
 * 
 * Compares values with exact type checking and value equality.
 * - Object keys are compared independent of order
 * - Array order is preserved
 * - Array vs Object comparisons are rejected
 * - Missing/extra keys are rejected
 * - null and undefined are handled explicitly
 */

export function deepEqualJson(a: unknown, b: unknown): boolean {
  // Strict equality for primitives (includes null)
  if (a === b) return true;

  // Handle null/undefined - null == null is handled above, this handles null vs undefined
  if (a == null || b == null) return a === b;

  // Different types are not equal
  if (typeof a !== typeof b) return false;

  // Reject array vs object comparison
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  // Handle arrays - preserve order
  if (aIsArray && bIsArray) {
    const aArr = a as unknown[];
    const bArr = b as unknown[];
    if (aArr.length !== bArr.length) return false;
    for (let i = 0; i < aArr.length; i++) {
      if (!deepEqualJson(aArr[i], bArr[i])) return false;
    }
    return true;
  }

  // Handle objects (key-order independent)
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    // Reject missing/extra keys
    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      // Reject missing keys in b
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
      if (!deepEqualJson(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}
