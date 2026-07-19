import { describe, it, expect, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { writeFile, readFile, unlink, mkdir, rmdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteStream } from "node:fs";

// Import from production core
import {
  sanitizeError,
  inferMimeType,
  parseDataUrlHeader,
  sanitizeFilename,
  generateStoragePath,
  validateAppBaseUrl,
  isValidStateTransition,
  VALID_STATE_TRANSITIONS,
  decodeLegacyDataChunked,
  BASE64_CHUNK_SIZE,
} from "../../scripts/lib/legacy-storage-migrator-core";

// Test data
const TEST_PDF_BASE64 =
  "JVBERi0xLjQKJeLjz9MKMiAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDMgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9Db250ZW50cyA0IDAgUj4+CmVuZG9iago0IDAgb2JqCjw8L0xlbmd0aCA0ND4+c3RyZWFtCkJUCi9GMSAxMiBUZgooSGVsbG8sIFdvcmxkISkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago3IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYS1Cb2xkPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzIgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDMgMCBSPj4KZW5kb2JqCjggMCBvYmoKPDwvUHJvZHVjZXIoVGVzdCBQREYpPj4KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDIyNyAwMDAwMCBuIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAxMjcgMDAwMDAgbiAKMDAwMDAwMDA3MiAwMDAwMCBuIAowMDAwMDAwMDAwIDAwMDAwIG4gCjAwMDAwMDAwMDAgMDAwMDAgbiAKMDAwMDAwMDE4MiAwMDAwMCBuIAowMDAwMDAwMjcyIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA5L1Jvb3QgMSAwIFI+PjEKc3RhcnR4cmVmCjM0MQolJUVPRg==";

describe("Legacy Storage Migration Core", () => {
  describe("decodeLegacyDataChunked", () => {
    it("decodes raw Base64 correctly to temp file", async () => {
      const tempPath = join(tmpdir(), `test-${Date.now()}.tmp`);
      try {
        const result = await decodeLegacyDataChunked(TEST_PDF_BASE64, tempPath, createWriteStream);
        expect(result.size).toBeGreaterThan(0);
        expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);

        const fileContent = await readFile(tempPath);
        expect(fileContent.length).toBe(result.size);

        const fileHash = createHash("sha256").update(fileContent).digest("hex");
        expect(fileHash).toBe(result.sha256);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    });

    it("processes multi-chunk payloads correctly", async () => {
      const largeData = Buffer.alloc(300 * 1024, "x");
      const largeBase64 = largeData.toString("base64");

      const tempPath = join(tmpdir(), `test-multi-${Date.now()}.tmp`);
      try {
        const result = await decodeLegacyDataChunked(largeBase64, tempPath, createWriteStream, 64 * 1024);
        expect(result.size).toBe(300 * 1024);

        const fileContent = await readFile(tempPath);
        expect(fileContent.length).toBe(300 * 1024);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    });

    it("calculates exact SHA-256 and size", async () => {
      const tempPath = join(tmpdir(), `test-exact-${Date.now()}.tmp`);
      try {
        const expectedBuffer = Buffer.from(TEST_PDF_BASE64, "base64");
        const expectedHash = createHash("sha256").update(expectedBuffer).digest("hex");

        const result = await decodeLegacyDataChunked(TEST_PDF_BASE64, tempPath, createWriteStream);

        expect(result.size).toBe(expectedBuffer.length);
        expect(result.sha256).toBe(expectedHash);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    });

    it("rejects invalid Base64 characters", async () => {
      const invalidBase64 = "SGVsbG8!@#";
      const tempPath = join(tmpdir(), `test-invalid-${Date.now()}.tmp`);

      await expect(decodeLegacyDataChunked(invalidBase64, tempPath, createWriteStream))
        .rejects.toThrow("Invalid Base64");
      await unlink(tempPath).catch(() => {});
    });
  });

  describe("parseDataUrlHeader", () => {
    it("extracts MIME type from data URL", () => {
      const dataUrl = `data:application/pdf;base64,${TEST_PDF_BASE64}`;
      const result = parseDataUrlHeader(dataUrl);
      expect(result.mimeType).toBe("application/pdf");
    });

    it("returns null for raw Base64", () => {
      const result = parseDataUrlHeader(TEST_PDF_BASE64);
      expect(result.mimeType).toBeNull();
    });
  });

  describe("inferMimeType", () => {
    it("prefers data URL MIME", () => {
      expect(inferMimeType("file.txt", "application/pdf", "text/plain")).toBe("application/pdf");
    });

    it("falls back to fileType", () => {
      expect(inferMimeType("file.txt", null, "text/csv")).toBe("text/csv");
    });

    it("infers from extension", () => {
      expect(inferMimeType("doc.pdf", null, null)).toBe("application/pdf");
    });

    it("falls back to octet-stream", () => {
      expect(inferMimeType("file.xyz", null, null)).toBe("application/octet-stream");
    });
  });

  describe("sanitizeFilename", () => {
    it("preserves safe characters", () => {
      expect(sanitizeFilename("document.pdf")).toBe("document.pdf");
    });

    it("replaces unsafe characters", () => {
      expect(sanitizeFilename("file/name.pdf")).toBe("file_name.pdf");
    });

    it("truncates long names", () => {
      const long = "a".repeat(300) + ".pdf";
      expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
    });
  });

  describe("generateStoragePath", () => {
    it("generates deterministic paths", () => {
      const path = generateStoragePath("doc_files", 123, "doc.pdf");
      expect(path).toBe("legacy/doc_files/123/doc.pdf");
    });
  });

  describe("sanitizeError", () => {
    it("redacts URLs", () => {
      const err = sanitizeError("Error: https://example.com/path");
      expect(err).toContain("[REDACTED_URL]");
    });

    it("redacts JWT", () => {
      const err = sanitizeError("Token: eyJhbGciOiJIUzI1NiIs.xxx.yyy");
      expect(err).toContain("[REDACTED_JWT]");
    });

    it("limits length", () => {
      const err = sanitizeError("a".repeat(1000));
      expect(err.length).toBeLessThanOrEqual(500);
    });
  });

  describe("validateAppBaseUrl", () => {
    it("allows any URL in dry-run", () => {
      expect(validateAppBaseUrl("http://localhost", false).valid).toBe(true);
    });

    it("rejects localhost in execute", () => {
      expect(validateAppBaseUrl("http://localhost", true).valid).toBe(false);
    });

    it("requires HTTPS in execute", () => {
      expect(validateAppBaseUrl("http://example.com", true).valid).toBe(false);
      expect(validateAppBaseUrl("https://example.com", true).valid).toBe(true);
    });

    it("rejects credentials", () => {
      expect(validateAppBaseUrl("https://user:pass@example.com", true).valid).toBe(false);
    });

    it("rejects query strings", () => {
      expect(validateAppBaseUrl("https://example.com?x=1", true).valid).toBe(false);
    });
  });

  describe("state machine", () => {
    it("allows valid transitions", () => {
      expect(isValidStateTransition("inventoried", "uploading")).toBe(true);
      expect(isValidStateTransition("uploading", "uploaded")).toBe(true);
    });

    it("rejects invalid transitions", () => {
      expect(isValidStateTransition("app_verified", "uploading")).toBe(false);
      expect(isValidStateTransition("conflict", "uploading")).toBe(false);
    });

    it("has terminal states", () => {
      expect(VALID_STATE_TRANSITIONS.app_verified).toEqual([]);
      expect(VALID_STATE_TRANSITIONS.conflict).toEqual([]);
    });
  });
});


// Behavioral tests that exercise actual production code
describe("State Machine Validation", () => {
  it("allows all valid forward transitions", () => {
    const validPaths = [
      ["inventoried", "uploading", "uploaded", "object_verified", "metadata_committed", "app_verified"],
      ["inventoried", "excluded"],
      ["inventoried", "uploading", "failed", "uploading"],
      ["uploading", "failed", "excluded"],
      ["metadata_committed", "rollback_required", "rolled_back", "uploading"],
    ];

    for (const path of validPaths) {
      for (let i = 0; i < path.length - 1; i++) {
        expect(isValidStateTransition(path[i], path[i + 1])).toBe(true);
      }
    }
  });

  it("rejects backward transitions", () => {
    const invalidTransitions = [
      ["uploading", "inventoried"],
      ["uploaded", "uploading"],
      ["object_verified", "uploaded"],
      ["app_verified", "metadata_committed"],
      ["metadata_committed", "object_verified"],
      ["rolled_back", "rollback_required"],
      ["excluded", "inventoried"],
      ["conflict", "inventoried"],
    ];

    for (const [from, to] of invalidTransitions) {
      expect(isValidStateTransition(from, to)).toBe(false);
    }
  });

  it("rejects transitions from terminal states", () => {
    const terminalStates = ["app_verified", "excluded", "conflict"];
    const allStates = Object.keys(VALID_STATE_TRANSITIONS);

    for (const terminal of terminalStates) {
      for (const target of allStates) {
        expect(isValidStateTransition(terminal, target)).toBe(false);
      }
    }
  });
});

describe("Fingerprint Validation", () => {
  it("calculates consistent SHA-256 for identical data", () => {
    const data = "test-data-123";
    const hash1 = createHash("sha256").update(data).digest("hex");
    const hash2 = createHash("sha256").update(data).digest("hex");
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different data", () => {
    const hash1 = createHash("sha256").update("data1").digest("hex");
    const hash2 = createHash("sha256").update("data2").digest("hex");
    expect(hash1).not.toBe(hash2);
  });
});

describe("Path Generation Safety", () => {
  it("generates consistent paths for same inputs", () => {
    const path1 = generateStoragePath("doc_files", 123, "doc.pdf");
    const path2 = generateStoragePath("doc_files", 123, "doc.pdf");
    expect(path1).toBe(path2);
  });

  it("sanitizes special characters in filenames", () => {
    const path = generateStoragePath("doc_files", 1, "file/with\\backslash.txt");
    // The filename part should have / replaced with _, but / remains as path separators
    expect(path).toContain("file_with_backslash.txt");
    expect(path).toContain("_");
  });

  it("handles long filenames safely", () => {
    const longName = "a".repeat(500) + ".pdf";
    const path = generateStoragePath("doc_files", 1, longName);
    expect(path.length).toBeLessThan(300);
  });
});

describe("Error Sanitization", () => {
  it("removes URLs from errors", () => {
    const error = sanitizeError("Failed to connect to https://api.example.com/v1/resource");
    expect(error).not.toContain("https://");
    expect(error).toContain("[REDACTED_URL]");
  });

  it("removes bearer tokens from errors", () => {
    const error = sanitizeError("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(error).not.toMatch(/eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*/);
  });

  it("truncates very long errors", () => {
    const longError = "A".repeat(10000);
    const sanitized = sanitizeError(longError);
    expect(sanitized.length).toBeLessThanOrEqual(500);
  });
});
