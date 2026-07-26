import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const journalJson = readFileSync("./db/migrations/meta/_journal.json", "utf8");
const journal = JSON.parse(journalJson);

const migration0013 = readFileSync(
  "./db/migrations/0013_legacy_storage_migration_ledger.sql",
  "utf8"
);

const migration0014 = readFileSync(
  "./db/migrations/0014_governance_milestone_columns.sql",
  "utf8"
);

const migration0015 = readFileSync(
  "./db/migrations/0015_seed_governance_facilities.sql",
  "utf8"
);

describe("governance migration safety", () => {
  describe("journal registration for migrations 0013-0015", () => {
    it("has migration 0013 registered in _journal.json", () => {
      const entry = journal.entries.find(
        (e: any) => e.tag === "0013_legacy_storage_migration_ledger"
      );
      expect(entry).toBeDefined();
      expect(entry.idx).toBe(13);
      expect(entry.version).toBe("7");
    });

    it("has migration 0014 registered in _journal.json", () => {
      const entry = journal.entries.find(
        (e: any) => e.tag === "0014_governance_milestone_columns"
      );
      expect(entry).toBeDefined();
      expect(entry.idx).toBe(14);
      expect(entry.version).toBe("7");
    });

    it("has migration 0015 registered in _journal.json", () => {
      const entry = journal.entries.find(
        (e: any) => e.tag === "0015_seed_governance_facilities"
      );
      expect(entry).toBeDefined();
      expect(entry.idx).toBe(15);
      expect(entry.version).toBe("7");
    });

    it("has monotonically increasing timestamps for 0013-0015", () => {
      const entries = journal.entries;
      const entry0012 = entries.find((e: any) => e.idx === 12);
      const entry0013 = entries.find((e: any) => e.idx === 13);
      const entry0014 = entries.find((e: any) => e.idx === 14);
      const entry0015 = entries.find((e: any) => e.idx === 15);

      expect(entry0012).toBeDefined();
      expect(entry0013).toBeDefined();
      expect(entry0014).toBeDefined();
      expect(entry0015).toBeDefined();

      expect(entry0013.when).toBeGreaterThan(entry0012.when);
      expect(entry0014.when).toBeGreaterThan(entry0013.when);
      expect(entry0015.when).toBeGreaterThan(entry0014.when);
    });
  });

  describe("migration 0013 idempotency", () => {
    it("checks pg_type before creating enum", () => {
      expect(migration0013).toContain("pg_type");
      expect(migration0013).toContain("typname");
    });

    it("uses CREATE TABLE IF NOT EXISTS", () => {
      expect(migration0013).toContain("CREATE TABLE IF NOT EXISTS legacy_storage_migration_ledger");
    });

    it("uses CREATE INDEX IF NOT EXISTS", () => {
      expect(migration0013).toContain("CREATE INDEX IF NOT EXISTS");
    });

    it("wraps enum creation in existence check", () => {
      // The CREATE TYPE is inside a DO block with IF NOT EXISTS check on pg_type
      expect(migration0013).toContain("DO $$");
      expect(migration0013).toContain("IF NOT EXISTS (SELECT 1 FROM pg_type");
    });

    it("does not contain unguarded CREATE TABLE", () => {
      const lines = migration0013.split('\n');
      const unguardedTable = lines.find((line: string) => 
        line.trim().startsWith('CREATE TABLE') && 
        !line.includes('IF NOT EXISTS')
      );
      expect(unguardedTable).toBeUndefined();
    });

    it("does not contain DROP statements", () => {
      expect(migration0013).not.toMatch(/DROP\s+(TABLE|TYPE|INDEX)/i);
    });
  });

  describe("migration 0014 idempotency", () => {
    it("uses ADD COLUMN IF NOT EXISTS", () => {
      expect(migration0014).toContain("ADD COLUMN IF NOT EXISTS");
    });

    it("does not contain DROP COLUMN", () => {
      expect(migration0014).not.toContain("DROP COLUMN");
    });
  });

  describe("migration 0015 idempotency", () => {
    it("uses ON CONFLICT DO NOTHING", () => {
      expect(migration0015).toContain("ON CONFLICT");
      expect(migration0015).toContain("DO NOTHING");
    });

    it("does not contain DELETE statements", () => {
      expect(migration0015).not.toMatch(/DELETE\s+FROM/i);
    });

    it("does not contain TRUNCATE statements", () => {
      expect(migration0015).not.toMatch(/TRUNCATE/i);
    });
  });
});
