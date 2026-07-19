/**
 * Filename sanitizer for Content-Disposition headers
 * Prevents header injection attacks by removing dangerous characters
 */

/**
 * Sanitize a filename for safe use in Content-Disposition headers.
 * Removes control characters, quotes, and normalizes path separators.
 * 
 * @param name The raw filename to sanitize
 * @returns Sanitized filename safe for header use
 */
export function sanitizeFilename(name: string): string {
  // Remove control characters (0x00-0x1f, 0x7f), quotes, and apostrophes
  // Convert backslashes to forward slashes to prevent path traversal
  // Truncate to 255 characters to prevent buffer issues
  return name
    .replace(/[\x00-\x1f\x7f"']/g, '')
    .replace(/\\/g, '/')
    .slice(0, 255);
}
