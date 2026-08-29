import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "db/migrations/0031_projects_without_ppp_submittal_monitoring.sql",
);
const journalPath = join(process.cwd(), "db/migrations/meta/_journal.json");

const migration = readFileSync(migrationPath, "utf8");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

const entry = journal.entries.find(
  (e) => e.tag === "0031_projects_without_ppp_submittal_monitoring",
);

describe("0031 Projects without PPP migration (content + journal)", () => {
  it("is registered as a journal entry with a unique tag", () => {
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(31);
    expect(entry!.when).toBe(1791312000014);
    // PR #389's reverted 0031 used when = 1791312000013; ours must be newer so
    // the migrator applies it on the already-#389-migrated production DB.
    expect(entry!.when).toBeGreaterThan(1791312000013);
  });

  it("0037 baseline RLS hardening is registered as the final journal entry", () => {
    const last = journal.entries[journal.entries.length - 1];
    expect(last.tag).toBe("0037_primavera_baseline_rls");
    expect(last.idx).toBe(journal.entries.length - 1);
    expect(last.when).toBeGreaterThan(entry!.when);
  });

  it("journal entries are ordered by idx and non-decreasing when", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      expect(journal.entries[i].idx).toBe(journal.entries[i - 1].idx + 1);
      expect(journal.entries[i].when).toBeGreaterThanOrEqual(journal.entries[i - 1].when);
    }
  });

  describe("fresh database starting condition", () => {
    it("creates both tables with CREATE TABLE IF NOT EXISTS", () => {
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.projects_without_ppp");
      expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.project_without_ppp_files");
    });

    it("contains every OWNER reference column including project_name", () => {
      for (const column of [
        "tracking_id varchar(50) NOT NULL UNIQUE",
        "ps_code varchar(50) NOT NULL",
        "coding_mask varchar(50)",
        "project_phase varchar(50) NOT NULL",
        "latest_milestone varchar(50)",
        "pm_headline varchar(255)",
        "work_package varchar(500)",
        "contract_package varchar(500)",
        "contractor varchar(255)",
        "major_project_tag varchar(100)",
        "construction_manager varchar(255)",
        "project_manager varchar(255)",
        "with_ls_ps boolean NOT NULL DEFAULT false",
        "amd_grid_head varchar(255)",
      ]) {
        expect(migration).toContain(column);
      }
      expect(migration).toContain("project_name varchar(255)");
    });

    it("contains submission-evidence columns on the files table", () => {
      for (const column of [
        "project_id integer NOT NULL REFERENCES public.projects_without_ppp(id) ON DELETE CASCADE",
        "file_name varchar(255) NOT NULL",
        "file_data text",
        "storage_bucket varchar(100)",
        "storage_path text",
      ]) {
        expect(migration).toContain(column);
      }
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS submitted_at timestamp");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS superseded_at timestamp");
    });
  });

  describe("already-#389-migrated production starting condition", () => {
    it("is fully additive and idempotent (no DROP, no non-idempotent ALTER)", () => {
      // Evaluate executable SQL only; comments may mention the word "drop".
      const executableSql = migration
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(executableSql).not.toMatch(/DROP\s+TABLE/i);
      expect(executableSql).not.toMatch(/DROP\s+COLUMN/i);
      // Every column-adding ALTER is idempotent (ADD COLUMN IF NOT EXISTS);
      // RLS/REVOKE ALTERs are idempotent by nature.
      const alters = executableSql.match(/ALTER TABLE[^;]+;/g) ?? [];
      const columnAlters = alters.filter((a) => a.includes("ADD COLUMN"));
      expect(columnAlters.length).toBeGreaterThanOrEqual(3);
      for (const alter of columnAlters) {
        expect(alter).toContain("ADD COLUMN IF NOT EXISTS");
      }
      // Every CREATE TABLE / INDEX is guarded with IF NOT EXISTS.
      expect(executableSql).not.toMatch(/CREATE (TABLE|INDEX) (?!.*IF NOT EXISTS)/);
    });

    it("enables RLS and revokes anon/authenticated privileges on both tables (Supabase posture)", () => {
      const executableSql = migration
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(executableSql).toContain(
        "ALTER TABLE public.projects_without_ppp ENABLE ROW LEVEL SECURITY;",
      );
      expect(executableSql).toContain(
        "ALTER TABLE public.project_without_ppp_files ENABLE ROW LEVEL SECURITY;",
      );
      expect(executableSql).toContain(
        "REVOKE ALL PRIVILEGES ON TABLE public.projects_without_ppp FROM anon, authenticated;",
      );
      expect(executableSql).toContain(
        "REVOKE ALL PRIVILEGES ON TABLE public.project_without_ppp_files FROM anon, authenticated;",
      );
      // The posture must not include permissive anon/authenticated policies.
      expect(executableSql).not.toMatch(/CREATE\s+POLICY/i);
    });

    it("reuses the inert PR #389 table names instead of creating new ones", () => {
      expect(migration).toContain("public.projects_without_ppp");
      expect(migration).toContain("public.project_without_ppp_files");
    });

    it("retains the inert PR #389 columns (sub_phase, submitted_by) additively", () => {
      expect(migration).toContain("sub_phase varchar(50)");
      expect(migration).toContain("submitted_by varchar(255)");
    });

    it("creates the current-evidence index for derived status", () => {
      expect(migration).toContain(
        "CREATE INDEX IF NOT EXISTS pwp_files_current_idx ON public.project_without_ppp_files (project_id, superseded_at)",
      );
    });
  });
});
