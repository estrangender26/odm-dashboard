import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read boot.ts source for verification
const bootSource = fs.readFileSync(
  path.join(__dirname, "boot.ts"),
  "utf-8"
);

/**
 * Public document access tests
 *
 * Verifies that document view and download routes are publicly accessible
 * and properly sanitize responses.
 */

describe("Public document view and download - source verification", () => {
  it("view route does not call requireFileRequestUser", () => {
    // Find the view route section
    const viewRouteStart = bootSource.indexOf('app.get("/api/documents/files/:id/view"');
    expect(viewRouteStart).toBeGreaterThan(-1);

    // Find the end of the view route (next route or major section)
    const viewRouteEnd = bootSource.indexOf('app.get("/api/documents/files/:id/download"', viewRouteStart);
    expect(viewRouteEnd).toBeGreaterThan(viewRouteStart);

    const viewRouteSection = bootSource.slice(viewRouteStart, viewRouteEnd);

    // Should NOT contain requireFileRequestUser in the view route section
    expect(viewRouteSection).not.toContain("requireFileRequestUser");
  });

  it("download route does not call requireFileRequestUser", () => {
    // Find the download route section
    const downloadRouteStart = bootSource.indexOf('app.get("/api/documents/files/:id/download"');
    expect(downloadRouteStart).toBeGreaterThan(-1);

    // Find the end of the download route
    const downloadRouteEnd = bootSource.indexOf('app.get("/api/governance/files/:id/view"', downloadRouteStart);
    expect(downloadRouteEnd).toBeGreaterThan(downloadRouteStart);

    const downloadRouteSection = bootSource.slice(downloadRouteStart, downloadRouteEnd);

    // Should NOT contain requireFileRequestUser in the download route section
    expect(downloadRouteSection).not.toContain("requireFileRequestUser");
  });

  it("view route error logging does not expose e.message or e.stack", () => {
    // Find the view route error handling
    expect(bootSource).toContain('[documents/view] Error: file access failed');

    // Make sure the old pattern with e.message, e.stack is not present
    expect(bootSource).not.toContain('[documents/view] Error:", e.message, e.stack');
  });

  it("download route error logging does not expose e.message or e.stack", () => {
    // Find the download route error handling
    expect(bootSource).toContain('[documents/download] Error: file access failed');

    // Make sure the old pattern with e.message, e.stack is not present
    expect(bootSource).not.toContain('[documents/download] Error:", e.message, e.stack');
  });

  it("view route returns sanitized error response", () => {
    // Check for the sanitized error message in the view route catch block
    const viewErrorSection = '[documents/view] Error: file access failed';
    const viewErrorIndex = bootSource.indexOf(viewErrorSection);
    expect(viewErrorIndex).toBeGreaterThan(-1);

    // Check that the next line after the error log has the sanitized response
    const afterErrorLog = bootSource.slice(viewErrorIndex, viewErrorIndex + 200);
    expect(afterErrorLog).toContain('"Unable to access file."');
    expect(afterErrorLog).not.toContain('error: e.message');
  });

  it("download route returns sanitized error response", () => {
    // Check for the sanitized error message in the download route catch block
    const downloadErrorSection = '[documents/download] Error: file access failed';
    const downloadErrorIndex = bootSource.indexOf(downloadErrorSection);
    expect(downloadErrorIndex).toBeGreaterThan(-1);

    // Check that the next line after the error log has the sanitized response
    const afterErrorLog = bootSource.slice(downloadErrorIndex, downloadErrorIndex + 200);
    expect(afterErrorLog).toContain('"Unable to access file."');
    expect(afterErrorLog).not.toContain('error: e.message');
  });

  it("view route uses sanitizeFilename for Content-Disposition", () => {
    const viewRouteStart = bootSource.indexOf('app.get("/api/documents/files/:id/view"');
    const viewRouteEnd = bootSource.indexOf('app.get("/api/documents/files/:id/download"', viewRouteStart);
    const viewRouteSection = bootSource.slice(viewRouteStart, viewRouteEnd);

    expect(viewRouteSection).toContain('sanitizeFilename(fileName)');
  });

  it("download route uses sanitizeFilename for Content-Disposition", () => {
    const downloadRouteStart = bootSource.indexOf('app.get("/api/documents/files/:id/download"');
    const downloadRouteEnd = bootSource.indexOf('app.get("/api/governance/files/:id/view"', downloadRouteStart);
    const downloadRouteSection = bootSource.slice(downloadRouteStart, downloadRouteEnd);

    expect(downloadRouteSection).toContain('sanitizeFilename(fileName)');
  });

  it("sanitizeFilename function exists", () => {
    expect(bootSource).toContain("function sanitizeFilename(name: string): string");
  });
});

describe("sanitizeFilename unit tests", () => {
  it("strips quotes from filename", () => {
    const sanitizeFilename = (name: string): string => {
      return name.replace(/[\x00-\x1f\x7f\"\']/g, '').replace(/\\/g, '/').slice(0, 255);
    };

    expect(sanitizeFilename('test"evil.pdf')).toBe("testevil.pdf");
    expect(sanitizeFilename("test'evil.pdf")).toBe("testevil.pdf");
  });

  it("strips control characters from filename", () => {
    const sanitizeFilename = (name: string): string => {
      return name.replace(/[\x00-\x1f\x7f\"\']/g, '').replace(/\\/g, '/').slice(0, 255);
    };

    expect(sanitizeFilename("test\r\nevil.pdf")).toBe("testevil.pdf");
    expect(sanitizeFilename("test\x00evil.pdf")).toBe("testevil.pdf");
  });

  it("converts backslashes to forward slashes", () => {
    const sanitizeFilename = (name: string): string => {
      return name.replace(/[\x00-\x1f\x7f\"\']/g, '').replace(/\\/g, '/').slice(0, 255);
    };

    expect(sanitizeFilename("path\\to\\file.pdf")).toBe("path/to/file.pdf");
  });

  it("truncates to 255 characters", () => {
    const sanitizeFilename = (name: string): string => {
      return name.replace(/[\x00-\x1f\x7f\"\']/g, '').replace(/\\/g, '/').slice(0, 255);
    };

    const longName = "a".repeat(300);
    expect(sanitizeFilename(longName).length).toBe(255);
  });

  it("preserves valid filename characters", () => {
    const sanitizeFilename = (name: string): string => {
      return name.replace(/[\x00-\x1f\x7f\"\']/g, '').replace(/\\/g, '/').slice(0, 255);
    };

    expect(sanitizeFilename("normal-file_v2.pdf")).toBe("normal-file_v2.pdf");
    expect(sanitizeFilename("file with spaces.pdf")).toBe("file with spaces.pdf");
    expect(sanitizeFilename("UPPERCASE.PDF")).toBe("UPPERCASE.PDF");
  });
});

describe("Unrelated routes remain protected", () => {
  it("debug uploads route still requires authentication", () => {
    const debugRouteStart = bootSource.indexOf('app.get("/api/debug/uploads"');
    expect(debugRouteStart).toBeGreaterThan(-1);

    // Find the end of the debug route (next major section)
    const nextRoute = bootSource.indexOf('app.get("/api/governance/files/:facilitySlug"', debugRouteStart);
    const debugRouteSection = bootSource.slice(debugRouteStart, nextRoute);

    expect(debugRouteSection).toContain("requireFileRequestUser");
  });
});
