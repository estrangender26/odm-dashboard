import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  lihokCorporateDocumentCategories,
  lihokCorporateDocuments,
  lihokCorporateDocumentVersions,
  lihokCorporateDocumentAudit,
} from "../db/schema";

const journalJson = readFileSync("./db/migrations/meta/_journal.json", "utf8");
const journal = JSON.parse(journalJson);

const migration0017 = readFileSync(
  "./db/migrations/0017_lihok_corporate_library.sql",
  "utf8"
);

describe("lihok corporate library schema", () => {
  describe("journal registration", () => {
    it("has migration 0017 registered in _journal.json", () => {
      const entry = journal.entries.find(
        (e: any) => e.tag === "0017_lihok_corporate_library"
      );
      expect(entry).toBeDefined();
      expect(entry.idx).toBe(17);
      expect(entry.version).toBe("7");
    });

    it("has a monotonically increasing timestamp after migration 0016", () => {
      const entry0016 = journal.entries.find((e: any) => e.idx === 16);
      const entry0017 = journal.entries.find((e: any) => e.idx === 17);
      expect(entry0016).toBeDefined();
      expect(entry0017).toBeDefined();
      expect(entry0017.when).toBeGreaterThan(entry0016.when);
    });
  });

  describe("migration 0017 idempotency and safety", () => {
    it("uses CREATE TABLE IF NOT EXISTS for all new tables", () => {
      expect(migration0017).toContain('CREATE TABLE IF NOT EXISTS "lihok_corporate_document_categories"');
      expect(migration0017).toContain('CREATE TABLE IF NOT EXISTS "lihok_corporate_documents"');
      expect(migration0017).toContain('CREATE TABLE IF NOT EXISTS "lihok_corporate_document_versions"');
      expect(migration0017).toContain('CREATE TABLE IF NOT EXISTS "lihok_corporate_document_audit"');
    });

    it("uses CREATE INDEX IF NOT EXISTS", () => {
      expect(migration0017).toContain("CREATE INDEX IF NOT EXISTS");
    });

    it("does not contain DROP statements", () => {
      expect(migration0017).not.toMatch(/DROP\s+(TABLE|INDEX|COLUMN)/i);
    });

    it("does not contain DELETE or TRUNCATE statements", () => {
      expect(migration0017).not.toMatch(/DELETE\s+FROM/i);
      expect(migration0017).not.toMatch(/TRUNCATE/i);
    });

    it("does not alter existing tables", () => {
      expect(migration0017).not.toMatch(/ALTER\s+TABLE/i);
    });

    it("seeds only the 16 categories with ON CONFLICT DO NOTHING", () => {
      expect(migration0017).toContain("ON CONFLICT");
      expect(migration0017).toContain("DO NOTHING");
      const matches = migration0017.match(/\('\d{2}',/g);
      expect(matches).toHaveLength(16);
    });

    it("does not seed LT-CORP-001 or any document/version/audit rows", () => {
      expect(migration0017).not.toContain("INSERT INTO \"lihok_corporate_documents\"");
      expect(migration0017).not.toContain("INSERT INTO \"lihok_corporate_document_versions\"");
      expect(migration0017).not.toContain("INSERT INTO \"lihok_corporate_document_audit\"");
      expect(migration0017).not.toContain("LT-CORP-001");
    });
  });

  describe("category table", () => {
    it("has a unique code column", () => {
      const config = getTableConfig(lihokCorporateDocumentCategories);
      const uniqueCode = config.uniqueConstraints.find((u) =>
        u.columns.some((c) => c.name === "code")
      );
      expect(uniqueCode).toBeDefined();
    });
  });

  describe("document master table", () => {
    it("has a unique document_number", () => {
      const config = getTableConfig(lihokCorporateDocuments);
      const uniqueDocNumber = config.uniqueConstraints.find((u) =>
        u.columns.some((c) => c.name === "document_number")
      );
      expect(uniqueDocNumber).toBeDefined();
    });

    it("has a check constraint on default_classification", () => {
      const config = getTableConfig(lihokCorporateDocuments);
      const check = config.checks.find((c) =>
        c.name === "lihok_corporate_documents_classification_check"
      );
      expect(check).toBeDefined();
    });

    it("does not have a currentVersionId column", () => {
      const config = getTableConfig(lihokCorporateDocuments);
      const hasCurrentVersion = config.columns.some(
        (c) => c.name === "current_version_id" || c.name === "currentVersionId"
      );
      expect(hasCurrentVersion).toBe(false);
    });

    it("references the categories table with restrict delete", () => {
      const config = getTableConfig(lihokCorporateDocuments);
      const fk = config.foreignKeys.find((fk) =>
        fk.reference().columns.includes(lihokCorporateDocuments.categoryId)
      );
      expect(fk).toBeDefined();
      expect(fk!.reference().foreignTable).toBe(lihokCorporateDocumentCategories);
      expect(fk!.reference().foreignColumns).toEqual([lihokCorporateDocumentCategories.id]);
      expect(fk!.onDelete).toBe("restrict");
    });
  });

  describe("version table", () => {
    it("has a unique document_id + version_number constraint", () => {
      const config = getTableConfig(lihokCorporateDocumentVersions);
      const uniqueVersion = config.uniqueConstraints.find((u) =>
        u.columns.some((c) => c.name === "document_id") &&
        u.columns.some((c) => c.name === "version_number")
      );
      expect(uniqueVersion).toBeDefined();
    });

    it("has status and classification check constraints", () => {
      const config = getTableConfig(lihokCorporateDocumentVersions);
      const statusCheck = config.checks.find(
        (c) => c.name === "lihok_corporate_document_versions_status_check"
      );
      const classificationCheck = config.checks.find(
        (c) => c.name === "lihok_corporate_document_versions_classification_check"
      );
      expect(statusCheck).toBeDefined();
      expect(classificationCheck).toBeDefined();
    });

    it("has a hash check constraint", () => {
      const config = getTableConfig(lihokCorporateDocumentVersions);
      const hashCheck = config.checks.find(
        (c) => c.name === "lihok_corporate_document_versions_hash_check"
      );
      expect(hashCheck).toBeDefined();
    });

    it("has a no-self-supersede check constraint", () => {
      const config = getTableConfig(lihokCorporateDocumentVersions);
      const selfCheck = config.checks.find(
        (c) => c.name === "lihok_corporate_document_versions_no_self_supersede_check"
      );
      expect(selfCheck).toBeDefined();
    });

    it("references the document master with restrict delete", () => {
      const config = getTableConfig(lihokCorporateDocumentVersions);
      const fk = config.foreignKeys.find((fk) =>
        fk.reference().columns.includes(lihokCorporateDocumentVersions.documentId)
      );
      expect(fk).toBeDefined();
      expect(fk!.reference().foreignTable).toBe(lihokCorporateDocuments);
      expect(fk!.onDelete).toBe("restrict");
    });

    it("has a self-referencing superseded_by_version_id foreign key", () => {
      const config = getTableConfig(lihokCorporateDocumentVersions);
      const fk = config.foreignKeys.find((fk) =>
        fk.reference().columns.includes(lihokCorporateDocumentVersions.supersededByVersionId)
      );
      expect(fk).toBeDefined();
      expect(fk!.reference().foreignTable).toBe(lihokCorporateDocumentVersions);
    });
  });

  describe("audit table", () => {
    it("references document and version with restrict delete", () => {
      const config = getTableConfig(lihokCorporateDocumentAudit);
      const docFk = config.foreignKeys.find((fk) =>
        fk.reference().columns.includes(lihokCorporateDocumentAudit.documentId)
      );
      const versionFk = config.foreignKeys.find((fk) =>
        fk.reference().columns.includes(lihokCorporateDocumentAudit.versionId)
      );
      expect(docFk).toBeDefined();
      expect(docFk!.reference().foreignTable).toBe(lihokCorporateDocuments);
      expect(docFk!.onDelete).toBe("restrict");
      expect(versionFk).toBeDefined();
      expect(versionFk!.reference().foreignTable).toBe(lihokCorporateDocumentVersions);
      expect(versionFk!.onDelete).toBe("restrict");
    });
  });
});
