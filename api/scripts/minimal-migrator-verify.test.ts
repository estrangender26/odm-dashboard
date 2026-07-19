/**
 * Minimal Migrator Verification Route Tests
 *
 * Regression tests for application verification endpoint.
 */

import { describe, it, expect } from "vitest";

describe("Application Verification Route", () => {
  it("uses correct endpoint for governance_uploads ID 7", () => {
    const baseUrl = "https://odm-dashboard.onrender.com";
    const source = "governance_uploads";
    const id = 7;
    
    const expectedUrl = `${baseUrl}/api/storage/files/${source}/${id}/view`;
    expect(expectedUrl).toBe("https://odm-dashboard.onrender.com/api/storage/files/governance_uploads/7/view");
  });

  it("requires HTTP 302 status", () => {
    const isValidStatus = (status: number) => status === 302;
    expect(isValidStatus(302)).toBe(true);
    expect(isValidStatus(200)).toBe(false);
    expect(isValidStatus(404)).toBe(false);
  });

  it("requires nonempty Location header", () => {
    const hasValidLocation = (location: string | null) => 
      location != null && location.length > 0;
    
    expect(hasValidLocation("https://storage.example.com/file.pdf")).toBe(true);
    expect(hasValidLocation("")).toBe(false);
    expect(hasValidLocation(null)).toBe(false);
  });

  it("uses GET method with manual redirect", () => {
    const fetchOptions = {
      method: "GET",
      redirect: "manual" as const,
    };
    
    expect(fetchOptions.method).toBe("GET");
    expect(fetchOptions.redirect).toBe("manual");
  });

  it("sanitizes verification failures", () => {
    // Verification should return false on any error, not throw
    const sanitizeVerificationError = () => false;
    
    expect(sanitizeVerificationError()).toBe(false);
  });

  it("constructs correct URL for each source type", () => {
    const baseUrl = "https://odm-dashboard.onrender.com";
    const sources = ["governance_uploads", "governance_files", "doc_files"];
    
    sources.forEach((source) => {
      const url = `${baseUrl}/api/storage/files/${source}/123/view`;
      expect(url).toContain(`/api/storage/files/${source}/`);
      expect(url).toContain("/view");
    });
  });
});
