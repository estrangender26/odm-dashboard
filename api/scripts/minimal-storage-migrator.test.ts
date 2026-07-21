/**
 * Minimal Storage Migrator Tests
 * Real behavior tests using exported helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateStoragePath,
  canExecute,
  isRecordExcluded,
  getSourceConfig,
  SOURCES,
  SOURCE_BUCKETS,
} from "../../scripts/minimal-storage-migrator";

describe("generateStoragePath", () => {
  it("generates deterministic paths", () => {
    const path1 = generateStoragePath("governance_uploads", 7, "document.pdf");
    const path2 = generateStoragePath("governance_uploads", 7, "document.pdf");
    expect(path1).toBe(path2);
    expect(path1).toBe("legacy/governance_uploads/7/document.pdf");
  });

  it("sanitizes special characters", () => {
    const path = generateStoragePath("governance_uploads", 1, "file with spaces & symbols!.pdf");
    expect(path).toMatch(/legacy\/governance_uploads\/1\/file_with_spaces?_symbols_\.pdf/);
  });

  it("truncates long filenames", () => {
    const longName = "a".repeat(300) + ".pdf";
    const path = generateStoragePath("governance_uploads", 1, longName);
    expect(path.length).toBeLessThan(250);
  });
});

describe("canExecute", () => {
  it("requires both execute and confirmProduction flags", () => {
    expect(canExecute(false, false)).toBe(false);
    expect(canExecute(true, false)).toBe(false);
    expect(canExecute(false, true)).toBe(false);
    expect(canExecute(true, true)).toBe(true);
  });

  it("neither flag: no execute", () => {
    expect(canExecute(false, false)).toBe(false);
  });

  it("only --execute: no execute", () => {
    expect(canExecute(true, false)).toBe(false);
  });

  it("only --confirm-production: no execute", () => {
    expect(canExecute(false, true)).toBe(false);
  });

  it("both flags: execute allowed", () => {
    expect(canExecute(true, true)).toBe(true);
  });
});

describe("isRecordExcluded", () => {
  it("excludes only smp_documents.id = 31", () => {
    expect(isRecordExcluded("smp_documents", 31)).toBe(true);
    expect(isRecordExcluded("smp_documents", 30)).toBe(false);
    expect(isRecordExcluded("smp_documents", 32)).toBe(false);
  });

  it("allows ID 31 in governance_uploads", () => {
    expect(isRecordExcluded("governance_uploads", 31)).toBe(false);
  });

  it("allows ID 31 in governance_files", () => {
    expect(isRecordExcluded("governance_files", 31)).toBe(false);
  });

  it("allows ID 31 in doc_files", () => {
    expect(isRecordExcluded("doc_files", 31)).toBe(false);
  });

  it("allows non-31 IDs in smp_documents", () => {
    expect(isRecordExcluded("smp_documents", 1)).toBe(false);
    expect(isRecordExcluded("smp_documents", 30)).toBe(false);
    expect(isRecordExcluded("smp_documents", 32)).toBe(false);
  });
});

describe("getSourceConfig", () => {
  it("returns configuration for governance_uploads", () => {
    const config = getSourceConfig("governance_uploads");
    expect(config.bucket).toBe("om-governance");
    expect(config.payloadColumn).toBe("file_url");
    expect(config.filenameColumn).toBe("file_name");
    expect(config.mimeColumn).toBeNull();
  });

  it("returns configuration for governance_files", () => {
    const config = getSourceConfig("governance_files");
    expect(config.bucket).toBe("om-governance");
    expect(config.payloadColumn).toBe("file_data");
    expect(config.filenameColumn).toBe("file_name");
    expect(config.mimeColumn).toBe("file_type");
  });

  it("returns configuration for doc_files", () => {
    const config = getSourceConfig("doc_files");
    expect(config.bucket).toBe("om-manuals");
    expect(config.payloadColumn).toBe("file_data");
    expect(config.filenameColumn).toBe("file_name");
    expect(config.mimeColumn).toBe("file_type");
  });

  it("returns configuration for smp_documents", () => {
    const config = getSourceConfig("smp_documents");
    expect(config.bucket).toBe("smp-library");
    expect(config.payloadColumn).toBe("file_data");
    expect(config.filenameColumn).toBe("file_name");
    expect(config.mimeColumn).toBe("file_type");
  });
});

describe("SOURCES array", () => {
  it("contains all four source mappings", () => {
    expect(SOURCES).toContain("governance_uploads");
    expect(SOURCES).toContain("governance_files");
    expect(SOURCES).toContain("doc_files");
    expect(SOURCES).toContain("smp_documents");
    expect(SOURCES.length).toBe(4);
  });
});

describe("SOURCE_BUCKETS", () => {
  it("maps governance_uploads to om-governance", () => {
    expect(SOURCE_BUCKETS["governance_uploads"]).toBe("om-governance");
  });

  it("maps governance_files to om-governance", () => {
    expect(SOURCE_BUCKETS["governance_files"]).toBe("om-governance");
  });

  it("maps doc_files to om-manuals", () => {
    expect(SOURCE_BUCKETS["doc_files"]).toBe("om-manuals");
  });

  it("maps smp_documents to smp-library", () => {
    expect(SOURCE_BUCKETS["smp_documents"]).toBe("smp-library");
  });
});
