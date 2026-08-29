import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function schemaSource() {
  return readFileSync(join(root, "db/schema.ts"), "utf8");
}

function migrationSource() {
  return readFileSync(join(root, "db/migrations/0033_smp_controlled_documents.sql"), "utf8");
}

function journal() {
  return JSON.parse(readFileSync(join(root, "db/migrations/meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
}

describe("SMP controlled-document schema", () => {
  it("exports the controlled-document tables", () => {
    const source = schemaSource();
    for (const table of [
      "smpDocuments",
      "smpDocumentRevisions",
      "smpFamilies",
      "smpSections",
      "smpTasks",
      "smpTaskApplicability",
    ]) {
      expect(source).toContain(`export const ${table} = pgTable`);
    }
  });

  it("adds controlled-document metadata columns to smp_documents", () => {
    const source = schemaSource();
    for (const column of [
      "smpId:",
      "smpFamily:",
      "assetName:",
      "assetType:",
      "facilityType:",
      "applicability:",
      "criticality:",
      "documentOwner:",
      "preparedBy:",
      "reviewedBy:",
      "approvedBy:",
      "effectivityDate:",
      "uploadedBy:",
      "uploadedAt:",
    ]) {
      expect(source).toContain(column);
    }
  });

  it("keeps legacy smp_documents columns intact (storage migrator dependency)", () => {
    const source = schemaSource();
    for (const column of ["fileData:", "fileType:", "fileName:", "storageMetadataColumns()"]) {
      expect(source).toContain(column);
    }
  });

  it("enforces one revision label per document series", () => {
    const source = schemaSource();
    expect(source).toContain("smp_document_revisions_document_revision_unique");
  });
});

describe("migration 0033 (additive)", () => {
  it("is registered in the drizzle journal", () => {
    expect(journal().entries.some((e) => e.tag === "0033_smp_controlled_documents")).toBe(true);
  });

  it("creates the revision, family, section, task, and applicability tables", () => {
    const sql = migrationSource();
    for (const table of [
      '"smp_document_revisions"',
      '"smp_families"',
      '"smp_sections"',
      '"smp_tasks"',
      '"smp_task_applicability"',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("adds controlled-document columns additively (IF NOT EXISTS)", () => {
    const sql = migrationSource();
    expect(sql).toContain('ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "smp_family" varchar(255)');
    expect(sql).toContain('ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "effectivity_date" date');
    expect(sql).toContain('ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "applicability" jsonb');
  });

  it("seeds exactly the seven approved SMP families", () => {
    const sql = migrationSource();
    for (const family of [
      "Centrifugal Pump System",
      "Blower System",
      "Primary Power Substation",
      "Electric Motor",
      "Dewatering System",
      "Automation Systems",
      "Secondary Power – Generator Set",
    ]) {
      expect(sql).toContain(family);
    }
  });

  it("never drops or truncates existing data", () => {
    const sql = migrationSource();
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/TRUNCATE\s+TABLE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });

  it("enables RLS and revokes anon/authenticated on the new tables", () => {
    const sql = migrationSource();
    for (const table of [
      "smp_document_revisions",
      "smp_families",
      "smp_sections",
      "smp_tasks",
      "smp_task_applicability",
    ]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM anon, authenticated;`);
    }
  });
});
