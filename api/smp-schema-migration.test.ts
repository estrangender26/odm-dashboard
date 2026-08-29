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

function migrationSource34() {
  return readFileSync(join(root, "db/migrations/0034_smp_revision_safe_structured_and_identity.sql"), "utf8");
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

  it("models the normalized reference-number identity and canonical family relation", () => {
    const source = schemaSource();
    expect(source).toContain('codeKey: varchar("code_key"');
    expect(source).toContain("smp_documents_code_key_unique");
    expect(source).toContain('familyId: integer("family_id")');
  });

  it("scopes structured sections and tasks to a required revision", () => {
    const source = schemaSource();
    expect(source).toContain('revisionId: integer("revision_id").notNull()');
    expect(source).toContain("smp_sections_revision_idx");
    expect(source).toContain("smp_tasks_revision_idx");
  });

  it("exports the staged-deletion ledger table", () => {
    const source = schemaSource();
    expect(source).toContain("export const smpDeletionRecords = pgTable");
    expect(source).toContain("SmpDeletionRecord");
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

describe("migration 0034 (revision-safe structured data + identity + deletion ledger)", () => {
  it("is registered in the drizzle journal", () => {
    expect(journal().entries.some((e) => e.tag === "0034_smp_revision_safe_structured_and_identity")).toBe(true);
  });

  it("detects reference-number duplicates and fails loudly instead of discarding data", () => {
    const sql = migrationSource34();
    expect(sql).toContain("RAISE EXCEPTION");
    expect(sql).toMatch(/SMP reference-number duplicates detected/);
    expect(sql).not.toMatch(/DELETE FROM smp_documents/i);
    expect(sql).not.toMatch(/MERGE/i);
  });

  it("adds the normalized identity key with a unique index and a sync trigger", () => {
    const sql = migrationSource34();
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "code_key" varchar(50) NOT NULL DEFAULT');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "smp_documents_code_key_unique"');
    expect(sql).toContain("smp_documents_set_code_key");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF \"code\"");
  });

  it("makes structured sections and tasks revision-attributable (NOT NULL revision_id)", () => {
    const sql = migrationSource34();
    expect(sql).toContain('ALTER TABLE "smp_sections" ADD COLUMN IF NOT EXISTS "revision_id"');
    expect(sql).toContain('ALTER TABLE "smp_sections" ALTER COLUMN "revision_id" SET NOT NULL');
    expect(sql).toContain('ALTER TABLE "smp_tasks" ALTER COLUMN "revision_id" SET NOT NULL');
    // Orphan rows must fail the migration loudly, not be discarded.
    expect(sql).toMatch(/smp_sections rows without a revision exist/);
    expect(sql).toMatch(/smp_tasks rows without a revision exist/);
  });

  it("separates canonical family classification from literal document text", () => {
    const sql = migrationSource34();
    expect(sql).toContain('ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "family_id"');
    expect(sql).toContain('REFERENCES "smp_families"("id") ON DELETE SET NULL');
  });

  it("creates the staged-deletion ledger with RLS", () => {
    const sql = migrationSource34();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "smp_deletion_records"');
    expect(sql).toContain("token_hash");
    expect(sql).toContain("removed_objects");
    expect(sql).toContain('ALTER TABLE public.smp_deletion_records ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.smp_deletion_records FROM anon, authenticated;');
  });

  it("remains additive: no table/column drops or data truncation", () => {
    const sql = migrationSource34();
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/TRUNCATE\s+TABLE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });
});
