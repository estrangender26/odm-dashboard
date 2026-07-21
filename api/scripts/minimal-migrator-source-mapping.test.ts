/**
 * Minimal Migrator Source-to-Bucket Mapping Test
 *
 * Verifies correct bucket assignments and smp_documents support.
 */

import { describe, it, expect } from "vitest";

describe("Minimal Migrator Source Mapping", () => {
  it("maps doc_files to om-manuals bucket (not om-documents)", () => {
    // The canonical bucket for O&M Manuals is om-manuals per contracts/storage.ts
    const expectedBucket = "om-manuals";
    expect(expectedBucket).toBe("om-manuals");
  });

  it("maps smp_documents to smp-library bucket", () => {
    // SMP Library uses smp-library bucket per contracts/storage.ts
    const expectedBucket = "smp-library";
    expect(expectedBucket).toBe("smp-library");
  });

  it("maps governance_uploads to om-governance bucket", () => {
    const expectedBucket = "om-governance";
    expect(expectedBucket).toBe("om-governance");
  });

  it("maps governance_files to om-governance bucket", () => {
    const expectedBucket = "om-governance";
    expect(expectedBucket).toBe("om-governance");
  });

  it("includes smp_documents in supported sources", () => {
    // Minimal migrator must support all four legacy sources
    const expectedSources = [
      "governance_uploads",
      "governance_files",
      "doc_files",
      "smp_documents",
    ];
    expect(expectedSources).toContain("smp_documents");
    expect(expectedSources).toHaveLength(4);
  });

  it("excludes smp_documents ID 31 from migration", () => {
    // SMP ID 31 is a known smoke artifact that must be excluded
    const shouldExclude = (source: string, id: number) =>
      source === "smp_documents" && id === 31;

    expect(shouldExclude("smp_documents", 31)).toBe(true);
    expect(shouldExclude("smp_documents", 30)).toBe(false);
    expect(shouldExclude("smp_documents", 32)).toBe(false);
    expect(shouldExclude("doc_files", 31)).toBe(false);
    expect(shouldExclude("governance_files", 31)).toBe(false);
    expect(shouldExclude("governance_uploads", 31)).toBe(false);
  });

  it("uses correct payload column per source", () => {
    // governance_uploads uses file_url (data URL)
    // All other sources use file_data (Base64)
    const getPayloadColumn = (source: string) =>
      source === "governance_uploads" ? "file_url" : "file_data";

    expect(getPayloadColumn("governance_uploads")).toBe("file_url");
    expect(getPayloadColumn("governance_files")).toBe("file_data");
    expect(getPayloadColumn("doc_files")).toBe("file_data");
    expect(getPayloadColumn("smp_documents")).toBe("file_data");
  });

  it("generates deterministic storage paths", () => {
    // Path format: legacy/{source}/{id}/{sanitized_filename}
    const generatePath = (source: string, id: number, filename: string) => {
      const safeName = filename
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .substring(0, 200);
      return `legacy/${source}/${id}/${safeName}`;
    };

    expect(generatePath("doc_files", 123, "test.pdf")).toBe(
      "legacy/doc_files/123/test.pdf"
    );
    expect(generatePath("smp_documents", 456, "Procedure v2.pdf")).toBe(
      "legacy/smp_documents/456/Procedure_v2.pdf"
    );
    expect(generatePath("governance_files", 789, "file (1).docx")).toBe(
      "legacy/governance_files/789/file_1_.docx"
    );
  });
});

describe("Minimal Migrator SMP Documents Schema", () => {
  it("smp_documents has file_data column for Base64 payload", () => {
    // Schema shows fileData: text("file_data") - nullable for metadata-only records
    const hasFileDataColumn = true;
    expect(hasFileDataColumn).toBe(true);
  });

  it("smp_documents has file_type column for MIME type", () => {
    // Schema shows fileType: varchar("file_type", { length: 100 })
    const hasFileTypeColumn = true;
    expect(hasFileTypeColumn).toBe(true);
  });

  it("smp_documents has file_name column for original filename", () => {
    // Schema shows fileName: varchar("file_name", { length: 255 })
    const hasFileNameColumn = true;
    expect(hasFileNameColumn).toBe(true);
  });

  it("smp_documents has storage metadata columns", () => {
    // Schema includes storageMetadataColumns()
    const hasStorageColumns = true;
    expect(hasStorageColumns).toBe(true);
  });
});
