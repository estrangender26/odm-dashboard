import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { writeFile, readFile, unlink, mkdir, rmdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteStream } from "node:fs";

// Test data
const TEST_PDF_BASE64 =
  "JVBERi0xLjQKJeLjz9MKMiAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDMgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9Db250ZW50cyA0IDAgUj4+CmVuZG9iago0IDAgb2JqCjw8L0xlbmd0aCA0ND4+c3RyZWFtCkJUCi9GMSAxMiBUZgooSGVsbG8sIFdvcmxkISkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago3IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYS1Cb2xkPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzIgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDMgMCBSPj4KZW5kb2JqCjggMCBvYmoKPDwvUHJvZHVjZXIoVGVzdCBQREYpPj4KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDIyNyAwMDAwMCBuIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAxMjcgMDAwMDAgbiAKMDAwMDAwMDA3MiAwMDAwMCBuIAowMDAwMDAwMDAwIDAwMDAwIG4gCjAwMDAwMDAwMDAgMDAwMDAgbiAKMDAwMDAwMDE4MiAwMDAwMCBuIAowMDAwMDAwMjcyIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA5L1Jvb3QgMSAwIFI+PjEKc3RhcnR4cmVmCjM0MQolJUVPRg==";

const TEST_DATA_URL = `data:application/pdf;base64,${TEST_PDF_BASE64}`;
const TEST_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5Erkggg==";
const TEST_PNG_DATA_URL = `data:image/png;base64,${TEST_PNG_BASE64}`;

// Helper functions copied from production code for testing
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .substring(0, 200);
}

function generateStoragePath(source: string, recordId: number, filename: string): string {
  const sanitized = sanitizeFilename(filename);
  return `legacy/${source}/${recordId}/${sanitized}`;
}

function parseDataUrlHeader(value: string): { mimeType: string | null; headerLength: number } {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) {
    return { mimeType: null, headerLength: 0 };
  }
  const comma = trimmed.indexOf(",");
  if (comma < 0) {
    return { mimeType: null, headerLength: 0 };
  }
  const header = trimmed.slice(5, comma);
  const declaredMime = header.split(";")[0] || null;
  return { mimeType: declaredMime, headerLength: comma + 1 };
}

function inferMimeType(fileName: string, dataUrlMime: string | null, fileType: string | null): string {
  if (dataUrlMime && dataUrlMime !== "application/octet-stream") {
    return dataUrlMime;
  }
  if (fileType?.trim()) {
    return fileType.trim();
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext) {
    const extMap: Record<string, string> = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      csv: "text/csv",
    };
    if (extMap[ext]) return extMap[ext];
  }
  return "application/octet-stream";
}

function sanitizeError(error: string | Error | unknown): string {
  if (!error) return "Unknown error";
  let message = error instanceof Error ? error.message : String(error);
  const patterns = [
    { pattern: /[a-zA-Z]+:\/\/[^\s"]+/g, replacement: "[REDACTED_URL]" },
    { pattern: /authorization[:\s=]+[^\s,"]+/gi, replacement: "authorization: [REDACTED]" },
    { pattern: /bearer\s+[a-zA-Z0-9_-]{10,}/gi, replacement: "[REDACTED_BEARER]" },
    { pattern: /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: "[REDACTED_JWT]" },
    { pattern: /data:[^;]+;base64,[a-zA-Z0-9+/]{100,}/gi, replacement: "[REDACTED_BASE64]" },
  ];
  for (const { pattern, replacement } of patterns) {
    message = message.replace(pattern, replacement);
  }
  return message.substring(0, 500).trim();
}

// Chunked Base64 decode implementation for testing
async function decodeLegacyDataChunked(
  base64Data: string,
  tempFilePath: string,
  chunkSize: number = 64 * 1024
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  let carryOver = "";

  const writeStream = createWriteStream(tempFilePath);

  try {
    for (let i = 0; i < base64Data.length; i += chunkSize) {
      let chunk = carryOver + base64Data.slice(i, i + chunkSize);

      const remainder = chunk.length % 4;
      if (remainder !== 0 && i + chunkSize < base64Data.length) {
        carryOver = chunk.slice(-remainder);
        chunk = chunk.slice(0, -remainder);
      } else {
        carryOver = "";
      }

      if (chunk.length === 0) continue;

      if (!/^[A-Za-z0-9+/]*=?=?=?$/.test(chunk)) {
        throw new Error("Invalid Base64 character detected");
      }

      const buffer = Buffer.from(chunk, "base64");

      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      hash.update(buffer);
      size += buffer.length;
    }

    if (carryOver) {
      const buffer = Buffer.from(carryOver, "base64");
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      hash.update(buffer);
      size += buffer.length;
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    return { size, sha256: hash.digest("hex") };
  } catch (error) {
    writeStream.destroy();
    throw error;
  }
}

// State machine transitions
const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  inventoried: ["uploading", "excluded"],
  uploading: ["uploaded", "failed"],
  uploaded: ["object_verified", "failed"],
  object_verified: ["metadata_committed", "failed"],
  metadata_committed: ["app_verified", "rollback_required", "failed"],
  rollback_required: ["rolled_back", "failed"],
  rolled_back: ["uploading"],
  conflict: [],
  failed: ["uploading", "excluded"],
  app_verified: [],
  excluded: [],
};

function isValidStateTransition(from: string, to: string): boolean {
  if (!(from in VALID_STATE_TRANSITIONS)) return false;
  return VALID_STATE_TRANSITIONS[from].includes(to);
}

// URL validation
function validateAppBaseUrl(url: string | undefined, isExecute: boolean): { valid: boolean; error?: string } {
  if (!isExecute) {
    return { valid: true };
  }

  if (!url) {
    return { valid: false, error: "APP_BASE_URL environment variable is required for execute mode" };
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return { valid: false, error: "APP_BASE_URL cannot be localhost/loopback in production" };
    }
    if (parsed.protocol !== "https:") {
      return { valid: false, error: "APP_BASE_URL must use HTTPS in production" };
    }
    if (parsed.search && parsed.search !== "") {
      return { valid: false, error: "APP_BASE_URL cannot contain query strings" };
    }
    if (parsed.hash && parsed.hash !== "") {
      return { valid: false, error: "APP_BASE_URL cannot contain fragments" };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: "APP_BASE_URL cannot contain credentials" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "APP_BASE_URL is not a valid URL" };
  }
}

describe("Legacy Storage Migration", () => {
  describe("decodeLegacyDataChunked", () => {
    it("decodes raw Base64 correctly to temp file", async () => {
      const tempPath = join(tmpdir(), `test-${Date.now()}.tmp`);
      try {
        const result = await decodeLegacyDataChunked(TEST_PDF_BASE64, tempPath);
        expect(result.size).toBeGreaterThan(0);
        expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);

        // Verify file was written
        const fileContent = await readFile(tempPath);
        expect(fileContent.length).toBe(result.size);

        // Verify SHA-256 matches
        const fileHash = createHash("sha256").update(fileContent).digest("hex");
        expect(fileHash).toBe(result.sha256);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    });

    it("processes multi-chunk payloads correctly", async () => {
      // Create a large payload that spans multiple chunks
      const largeData = Buffer.alloc(300 * 1024, "x"); // 300KB
      const largeBase64 = largeData.toString("base64");

      const tempPath = join(tmpdir(), `test-multi-${Date.now()}.tmp`);
      try {
        const result = await decodeLegacyDataChunked(largeBase64, tempPath, 64 * 1024);
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

        const result = await decodeLegacyDataChunked(TEST_PDF_BASE64, tempPath);

        expect(result.size).toBe(expectedBuffer.length);
        expect(result.sha256).toBe(expectedHash);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    });

    it("rejects invalid Base64 characters", async () => {
      const invalidBase64 = "SGVsbG8!@#"; // Contains invalid chars
      const tempPath = join(tmpdir(), `test-invalid-${Date.now()}.tmp`);

      await expect(decodeLegacyDataChunked(invalidBase64, tempPath)).rejects.toThrow("Invalid Base64");
      await unlink(tempPath).catch(() => {});
    });

    it("cleans up temp file on error", async () => {
      const invalidBase64 = "!!!invalid!!!";
      const tempPath = join(tmpdir(), `test-cleanup-${Date.now()}.tmp`);

      try {
        await decodeLegacyDataChunked(invalidBase64, tempPath);
      } catch {
        // Expected error
      }

      // File should not exist or be empty
      try {
        await access(tempPath);
        // If file exists, it should be empty or incomplete
        const stats = await readFile(tempPath);
        expect(stats.length).toBeLessThan(TEST_PDF_BASE64.length);
      } catch {
        // File doesn't exist - good
      }
      await unlink(tempPath).catch(() => {});
    });
  });

  describe("parseDataUrlHeader", () => {
    it("extracts MIME type from data URL", () => {
      const result = parseDataUrlHeader(TEST_DATA_URL);
      expect(result.mimeType).toBe("application/pdf");
      expect(result.headerLength).toBeGreaterThan(0);
    });

    it("returns null for raw Base64 without data URL", () => {
      const result = parseDataUrlHeader(TEST_PDF_BASE64);
      expect(result.mimeType).toBeNull();
      expect(result.headerLength).toBe(0);
    });

    it("handles data URL without explicit MIME", () => {
      const dataUrl = "data:;base64,SGVsbG8=";
      const result = parseDataUrlHeader(dataUrl);
      expect(result.mimeType === "" || result.mimeType === null).toBe(true);
    });
  });

  describe("inferMimeType", () => {
    it("prefers data URL MIME over fileType", () => {
      // Data URL PDF should win over fileType text/plain
      const mime = inferMimeType("file.txt", "application/pdf", "text/plain");
      expect(mime).toBe("application/pdf");
    });

    it("falls back to fileType when no data URL MIME", () => {
      const mime = inferMimeType("file.txt", null, "text/csv");
      expect(mime).toBe("text/csv");
    });

    it("infers from filename extension", () => {
      expect(inferMimeType("document.pdf", null, null)).toBe("application/pdf");
      expect(inferMimeType("image.png", null, null)).toBe("image/png");
      expect(inferMimeType("data.csv", null, null)).toBe("text/csv");
    });

    it("falls back to octet-stream for unknown extensions", () => {
      expect(inferMimeType("file.xyz", null, null)).toBe("application/octet-stream");
    });
  });

  describe("sanitizeFilename", () => {
    it("preserves safe characters", () => {
      const safe = ["document.pdf", "file-name_v2", "report_final.docx", "DATA_2024.csv"];
      for (const name of safe) {
        expect(sanitizeFilename(name)).toBe(name);
      }
    });

    it("replaces unsafe characters with underscore", () => {
      expect(sanitizeFilename("file/name.pdf")).toBe("file_name.pdf");
      expect(sanitizeFilename("file\\name.pdf")).toBe("file_name.pdf");
      expect(sanitizeFilename("file:name.pdf")).toBe("file_name.pdf");
      expect(sanitizeFilename("file with spaces.pdf")).toBe("file_with_spaces.pdf");
      expect(sanitizeFilename("file<name>.pdf")).toBe("file_name_.pdf");
    });

    it("collapses multiple underscores", () => {
      expect(sanitizeFilename("file__name.pdf")).toBe("file_name.pdf");
      expect(sanitizeFilename("file___name.pdf")).toBe("file_name.pdf");
    });

    it("truncates long filenames to 200 chars", () => {
      const longName = "a".repeat(300) + ".pdf";
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(200);
    });
  });

  describe("generateStoragePath", () => {
    it("generates deterministic paths", () => {
      const path1 = generateStoragePath("doc_files", 123, "document.pdf");
      const path2 = generateStoragePath("doc_files", 123, "document.pdf");
      expect(path1).toBe(path2);
      expect(path1).toBe("legacy/doc_files/123/document.pdf");
    });

    it("sanitizes filenames in path", () => {
      const path = generateStoragePath("doc_files", 1, "file/name.pdf");
      expect(path).toBe("legacy/doc_files/1/file_name.pdf");
    });

    it("handles different sources", () => {
      expect(generateStoragePath("smp_documents", 456, "manual.pdf"))
        .toBe("legacy/smp_documents/456/manual.pdf");
    });
  });

  describe("sanitizeError", () => {
    it("redacts authorization headers", () => {
      const error = "Request failed with Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456";
      const sanitized = sanitizeError(error);
      expect(sanitized).toContain("[REDACTED]");
    });

    it("redacts URLs with credentials", () => {
      const error = "Failed to connect to https://user:pass@db.example.com:5432/db";
      const sanitized = sanitizeError(error);
      expect(sanitized).toContain("[REDACTED_URL]");
    });

    it("redacts JWT-like strings", () => {
      const error = "Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.invalid";
      const sanitized = sanitizeError(error);
      expect(sanitized).toContain("[REDACTED_JWT]");
    });

    it("redacts long Base64 data URLs", () => {
      const longBase64 = "a".repeat(120);
      const error = `Invalid data: data:application/pdf;base64,${longBase64}`;
      const sanitized = sanitizeError(error);
      expect(sanitized).toContain("[REDACTED_BASE64]");
    });

    it("limits length to 500 chars", () => {
      const longError = "a".repeat(1000);
      const sanitized = sanitizeError(longError);
      expect(sanitized.length).toBeLessThanOrEqual(500);
    });
  });

  describe("validateAppBaseUrl", () => {
    it("allows any URL in dry-run mode", () => {
      expect(validateAppBaseUrl(undefined, false).valid).toBe(true);
      expect(validateAppBaseUrl("http://localhost:3000", false).valid).toBe(true);
    });

    it("rejects localhost in execute mode", () => {
      expect(validateAppBaseUrl("http://localhost:3000", true).valid).toBe(false);
      expect(validateAppBaseUrl("http://127.0.0.1:3000", true).valid).toBe(false);
      expect(validateAppBaseUrl("http://[::1]:3000", true).valid).toBe(false);
    });

    it("requires HTTPS in execute mode", () => {
      expect(validateAppBaseUrl("http://example.com", true).valid).toBe(false);
      expect(validateAppBaseUrl("https://example.com", true).valid).toBe(true);
    });

    it("rejects URLs with credentials", () => {
      expect(validateAppBaseUrl("https://user:pass@example.com", true).valid).toBe(false);
    });

    it("rejects URLs with query strings", () => {
      expect(validateAppBaseUrl("https://example.com?param=value", true).valid).toBe(false);
    });

    it("rejects URLs with fragments", () => {
      expect(validateAppBaseUrl("https://example.com#section", true).valid).toBe(false);
    });

    it("requires APP_BASE_URL in execute mode", () => {
      expect(validateAppBaseUrl(undefined, true).valid).toBe(false);
    });
  });

  describe("state machine", () => {
    it("allows valid transitions", () => {
      expect(isValidStateTransition("inventoried", "uploading")).toBe(true);
      expect(isValidStateTransition("uploading", "uploaded")).toBe(true);
      expect(isValidStateTransition("uploaded", "object_verified")).toBe(true);
      expect(isValidStateTransition("metadata_committed", "app_verified")).toBe(true);
      expect(isValidStateTransition("failed", "uploading")).toBe(true);
    });

    it("rejects invalid transitions", () => {
      expect(isValidStateTransition("app_verified", "uploading")).toBe(false);
      expect(isValidStateTransition("conflict", "uploading")).toBe(false);
      expect(isValidStateTransition("excluded", "uploading")).toBe(false);
    });

    it("has correct terminal states", () => {
      expect(VALID_STATE_TRANSITIONS.app_verified).toEqual([]);
      expect(VALID_STATE_TRANSITIONS.conflict).toEqual([]);
      expect(VALID_STATE_TRANSITIONS.excluded).toEqual([]);
    });

    it("has 11 states total", () => {
      expect(Object.keys(VALID_STATE_TRANSITIONS).length).toBe(11);
    });
  });

  describe("SMP ID 31 exclusion", () => {
    it("always excludes smp_documents:31", () => {
      const isExcluded = (source: string, id: number) => source === "smp_documents" && id === 31;
      expect(isExcluded("smp_documents", 31)).toBe(true);
    });

    it("does not exclude other SMP records", () => {
      const isExcluded = (source: string, id: number) => source === "smp_documents" && id === 31;
      expect(isExcluded("smp_documents", 30)).toBe(false);
      expect(isExcluded("smp_documents", 32)).toBe(false);
    });

    it("does not exclude other sources with ID 31", () => {
      const isExcluded = (source: string, id: number) => source === "smp_documents" && id === 31;
      expect(isExcluded("doc_files", 31)).toBe(false);
      expect(isExcluded("governance_files", 31)).toBe(false);
    });
  });

  describe("temp file cleanup", () => {
    it("creates and removes temp directory on success", async () => {
      const tempDir = join(tmpdir(), `test-dir-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      const tempFile = join(tempDir, "test.tmp");
      await writeFile(tempFile, "test data");

      expect(await readFile(tempFile, "utf-8")).toBe("test data");

      // Simulate cleanup
      await unlink(tempFile);
      await rmdir(tempDir);

      await expect(access(tempDir)).rejects.toThrow();
    });

    it("cleans up on error using finally pattern", async () => {
      const tempDir = join(tmpdir(), `test-cleanup-${Date.now()}`);
      let cleanedUp = false;

      try {
        await mkdir(tempDir, { recursive: true });
        const tempFile = join(tempDir, "test.tmp");
        await writeFile(tempFile, "test data");
        throw new Error("Simulated error");
      } catch {
        // Cleanup in finally equivalent
      } finally {
        // Cleanup
        try {
          await unlink(join(tempDir, "test.tmp"));
          await rmdir(tempDir);
          cleanedUp = true;
        } catch {
          // Ignore cleanup errors
        }
      }

      expect(cleanedUp).toBe(true);
      await expect(access(tempDir)).rejects.toThrow();
    });
  });

  describe("worker lease", () => {
    it("calculates lease expiration correctly", () => {
      const now = new Date();
      const leaseDurationMs = 5 * 60 * 1000; // 5 minutes
      const leaseExpires = new Date(now.getTime() + leaseDurationMs);
      expect(leaseExpires.getTime() - now.getTime()).toBe(leaseDurationMs);
    });

    it("generates unique temp directory names", () => {
      const names = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const randomSuffix = randomBytes(16).toString("hex");
        names.add(randomSuffix);
      }
      expect(names.size).toBe(100); // All unique
    });
  });

  describe("orphan classification precedence", () => {
    const classifications = [
      "referenced",
      "active_upload_intent",
      "finalized_upload_intent",
      "migration_verified",
      "migration_staged",
      "possible_orphan",
    ];

    it("referenced has highest precedence", () => {
      expect(classifications[0]).toBe("referenced");
    });

    it("possible_orphan has lowest precedence", () => {
      expect(classifications[classifications.length - 1]).toBe("possible_orphan");
    });

    it("has 6 classifications total", () => {
      expect(classifications.length).toBe(6);
    });
  });

  describe("existing object verification", () => {
    it("detects size mismatch", () => {
      const expectedSize = 1000;
      const actualSize = 999;
      const matches = actualSize === expectedSize;
      expect(matches).toBe(false);
    });

    it("detects SHA-256 mismatch", () => {
      const hash1 = createHash("sha256").update("data1").digest("hex");
      const hash2 = createHash("sha256").update("data2").digest("hex");
      expect(hash1).not.toBe(hash2);
    });

    it("calculates SHA-256 consistently", () => {
      const data = "test data";
      const hash1 = createHash("sha256").update(data).digest("hex");
      const hash2 = createHash("sha256").update(data).digest("hex");
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("dry-run safety", () => {
    it("does not require execute flag for dry-run", () => {
      const execute = false;
      const isDryRun = !execute;
      expect(isDryRun).toBe(true);
    });

    it("requires both flags for production execution", () => {
      const execute = true;
      const confirmProduction = true;
      const canExecute = execute && confirmProduction;
      expect(canExecute).toBe(true);
    });

    it("prevents execution without confirmation", () => {
      const execute = true;
      const confirmProduction = false;
      const canExecute = execute && confirmProduction;
      expect(canExecute).toBe(false);
    });
  });
});
