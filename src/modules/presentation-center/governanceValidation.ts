/**
 * Governance Data Validation
 * 
 * Validates dates and other inputs for the Governance module.
 */

/**
 * Validate a reporting date string.
 * Returns an object with valid flag and error message if invalid.
 */
export function validateReportingDate(dateStr: string): {
  valid: boolean;
  error?: string;
  date?: Date;
} {
  // Check format: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return {
      valid: false,
      error: `Invalid date format. Expected: YYYY-MM-DD (e.g., 2026-07-25). Received: "${dateStr}"`,
    };
  }
  
  // Parse components
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  
  // Check ranges
  if (month < 1 || month > 12) {
    return {
      valid: false,
      error: `Invalid month: ${month}. Expected: 1-12.`,
    };
  }
  
  if (day < 1 || day > 31) {
    return {
      valid: false,
      error: `Invalid day: ${day}. Expected: 1-31.`,
    };
  }
  
  // Create date and verify it doesn't shift (rejects invalid dates like Feb 30)
  const date = new Date(`${dateStr}T00:00:00Z`);
  
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return {
      valid: false,
      error: `Invalid calendar date: ${dateStr}. This date does not exist (e.g., Feb 30).`,
    };
  }
  
  return {
    valid: true,
    date,
  };
}

/**
 * Check if a string is a valid date.
 */
export function isValidDate(dateStr: string): boolean {
  return validateReportingDate(dateStr).valid;
}
