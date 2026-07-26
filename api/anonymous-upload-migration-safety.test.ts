import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const journalJson = readFileSync("./db/migrations/meta/_journal.json", "utf8");
const journal = JSON.parse(journalJson);

const forwardMigrationSql = readFileSync(
  "./db/migrations/0012_anonymous_upload_capability.sql",
  "utf8"
);

const rollbackSql = readFileSync(
  "./db/rollbacks/0012_anonymous_upload_capability.rollback.sql",
  "utf8"
);

describe("anonymous upload migration safety", () => {
  describe("journal registration", () => {
    it("has migration 0011 registered in _journal.json", () => {
      const entry = journal.entries.find(
        (e: any) => e.tag === "0011_supabase_storage_metadata"
      );
      expect(entry).toBeDefined();
      expect(entry.idx).toBe(11);
      expect(entry.version).toBe("7");
    });

    it("has migration 0012 registered in _journal.json", () => {
      const entry = journal.entries.find(
        (e: any) => e.tag === "0012_anonymous_upload_capability"
      );
      expect(entry).toBeDefined();
      expect(entry.idx).toBe(12);
      expect(entry.version).toBe("7");
    });

    it("has migration 0012 ordered immediately after 0011", () => {
      const entries = journal.entries;
      const entry0011 = entries.find((e: any) => e.idx === 11);
      const entry0012 = entries.find((e: any) => e.idx === 12);
      expect(entry0011).toBeDefined();
      expect(entry0012).toBeDefined();
      expect(entry0012.idx).toBe(entry0011.idx + 1);
      expect(entry0011.tag).toBe("0011_supabase_storage_metadata");
      expect(entry0012.tag).toBe("0012_anonymous_upload_capability");
    });

    it("has 0012 timestamp strictly greater than 0011 timestamp", () => {
      const entries = journal.entries;
      const entry0011 = entries.find((e: any) => e.idx === 11);
      const entry0012 = entries.find((e: any) => e.idx === 12);
      expect(entry0011).toBeDefined();
      expect(entry0012).toBeDefined();
      expect(entry0012.when).toBeGreaterThan(entry0011.when);
    });

    it("has monotonically increasing timestamps across all entries", () => {
      const entries = journal.entries;
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].when).toBeGreaterThanOrEqual(entries[i - 1].when);
      }
    });

    it("has unique migration indices", () => {
      const indices = journal.entries.map((e: any) => e.idx);
      const uniqueIndices = new Set(indices);
      expect(uniqueIndices.size).toBe(indices.length);
    });

    it("has unique migration tags", () => {
      const tags = journal.entries.map((e: any) => e.tag);
      const uniqueTags = new Set(tags);
      expect(uniqueTags.size).toBe(tags.length);
    });

    it("does not have rollback migration in _journal.json", () => {
      const rollbackEntry = journal.entries.find(
        (e: any) => e.tag === "0013_rollback_anonymous_uploads"
      );
      expect(rollbackEntry).toBeUndefined();
    });

  });

  describe("forward migration file", () => {
    it("exists in db/migrations/", () => {
      expect(existsSync("./db/migrations/0012_anonymous_upload_capability.sql")).toBe(true);
    });

    it("makes requested_by nullable", () => {
      expect(forwardMigrationSql).toContain('ALTER COLUMN "requested_by" DROP NOT NULL');
    });

    it("adds capability_jti column", () => {
      expect(forwardMigrationSql).toContain('ADD COLUMN IF NOT EXISTS "capability_jti" uuid NULL');
    });

    it("adds capability_token_hash column", () => {
      expect(forwardMigrationSql).toContain('ADD COLUMN IF NOT EXISTS "capability_token_hash" varchar(64) NULL');
    });

    it("adds capability_expires_at column", () => {
      expect(forwardMigrationSql).toContain('ADD COLUMN IF NOT EXISTS "capability_expires_at" timestamptz NULL');
    });

    it("adds capability_consumed_at column", () => {
      expect(forwardMigrationSql).toContain('ADD COLUMN IF NOT EXISTS "capability_consumed_at" timestamptz NULL');
    });

    it("creates unique JTI index", () => {
      expect(forwardMigrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "storage_upload_intents_jti_idx"');
      expect(forwardMigrationSql).toContain('WHERE "capability_jti" IS NOT NULL');
    });

    it("creates upload_rate_limits table", () => {
      expect(forwardMigrationSql).toContain('CREATE TABLE IF NOT EXISTS "upload_rate_limits"');
      expect(forwardMigrationSql).toContain('"client_identifier" varchar(64) NOT NULL');
      expect(forwardMigrationSql).toContain('"window_start" timestamptz NOT NULL');
      expect(forwardMigrationSql).toContain('"intent_count" integer NOT NULL DEFAULT 0');
      expect(forwardMigrationSql).toContain('"total_bytes" bigint NOT NULL DEFAULT 0');
    });

    it("adds unique constraint on upload_rate_limits", () => {
      expect(forwardMigrationSql).toContain('UNIQUE("client_identifier", "window_start")');
    });

    it("creates lookup index", () => {
      expect(forwardMigrationSql).toContain('CREATE INDEX IF NOT EXISTS "upload_rate_limits_lookup_idx"');
    });

    it("creates cleanup index without now()", () => {
      expect(forwardMigrationSql).toContain('CREATE INDEX IF NOT EXISTS "upload_rate_limits_cleanup_idx"');
      expect(forwardMigrationSql).not.toMatch(/now\(\)\s*[-+]/);
    });

    it("creates updated_at trigger function", () => {
      expect(forwardMigrationSql).toContain('CREATE OR REPLACE FUNCTION update_upload_rate_limits_updated_at()');
    });

    it("creates updated_at trigger", () => {
      expect(forwardMigrationSql).toContain('CREATE TRIGGER update_upload_rate_limits_updated_at');
    });
  });

  describe("rollback file isolation", () => {
    it("exists in db/rollbacks/", () => {
      expect(existsSync("./db/rollbacks/0012_anonymous_upload_capability.rollback.sql")).toBe(true);
    });

    it("does not exist in db/migrations/", () => {
      expect(existsSync("./db/migrations/0013_rollback_anonymous_uploads.sql")).toBe(false);
    });

    it("handles anonymous rows before restoring NOT NULL", () => {
      expect(rollbackSql).toContain('UPDATE storage_upload_intents');
      expect(rollbackSql).toContain("SET requested_by = system_user_id");
      expect(rollbackSql).toContain('WHERE requested_by IS NULL');
    });

    it("restores NOT NULL constraint", () => {
      expect(rollbackSql).toContain('ALTER COLUMN "requested_by" SET NOT NULL');
    });

    it("drops capability columns", () => {
      expect(rollbackSql).toContain('DROP COLUMN IF EXISTS "capability_jti"');
      expect(rollbackSql).toContain('DROP COLUMN IF EXISTS "capability_token_hash"');
      expect(rollbackSql).toContain('DROP COLUMN IF EXISTS "capability_expires_at"');
      expect(rollbackSql).toContain('DROP COLUMN IF EXISTS "capability_consumed_at"');
    });

    it("drops JTI index before columns", () => {
      const jtiDropIndex = rollbackSql.indexOf('DROP INDEX IF EXISTS "storage_upload_intents_jti_idx"');
      const capabilityDrop = rollbackSql.indexOf('DROP COLUMN IF EXISTS "capability_jti"');
      expect(jtiDropIndex).toBeGreaterThanOrEqual(0);
      expect(capabilityDrop).toBeGreaterThanOrEqual(0);
      expect(jtiDropIndex).toBeLessThan(capabilityDrop);
    });

    it("drops trigger before table", () => {
      const triggerDrop = rollbackSql.indexOf('DROP TRIGGER IF EXISTS update_upload_rate_limits_updated_at');
      const tableDrop = rollbackSql.indexOf('DROP TABLE IF EXISTS "upload_rate_limits"');
      expect(triggerDrop).toBeGreaterThanOrEqual(0);
      expect(tableDrop).toBeGreaterThanOrEqual(0);
      expect(triggerDrop).toBeLessThan(tableDrop);
    });

    it("drops rate_limits table", () => {
      expect(rollbackSql).toContain('DROP TABLE IF EXISTS "upload_rate_limits"');
    });
  });

  describe("migration runner safety", () => {
    it("forward migration directory contains only expected SQL files", () => {
      const migrationsDir = "./db/migrations";
      const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !f.startsWith('.'));
      expect(files).toContain("0012_anonymous_upload_capability.sql");
      expect(files).not.toContain("0013_rollback_anonymous_uploads.sql");
      const rollbackNamedFiles = files.filter((f: string) => f.toLowerCase().includes('rollback'));
      expect(rollbackNamedFiles).toHaveLength(0);
    });

    it("rollback directory contains only rollback files", () => {
      const rollbacksDir = "./db/rollbacks";
      const files = readdirSync(rollbacksDir).filter(f => f.endsWith('.sql') && !f.startsWith('.'));
      expect(files).toContain("0012_anonymous_upload_capability.rollback.sql");
      for (const file of files) {
        expect(file).toMatch(/\.rollback\.sql$/);
      }
    });
  });
});
