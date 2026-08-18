import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "db/migrations/0027_drop_legacy_gantt_project_columns.sql"
);
const preflightPath = join(
  process.cwd(),
  "db/migrations/helpers/0027_drop_legacy_gantt_project_columns_preflight.sql"
);
const verificationPath = join(
  process.cwd(),
  "db/migrations/helpers/0027_drop_legacy_gantt_project_columns_verification.sql"
);
const docPath = join(
  process.cwd(),
  "db/migrations/helpers/0027_drop_legacy_gantt_project_columns_migration_doc.md"
);
const recoveryPath = join(
  process.cwd(),
  "db/migrations/helpers/0027_drop_legacy_gantt_project_columns_recovery.md"
);
const journalPath = join(process.cwd(), "db/migrations/meta/_journal.json");

const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const verification = readFileSync(verificationPath, "utf8");
const doc = readFileSync(docPath, "utf8");
const recovery = readFileSync(recoveryPath, "utf8");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

const legacyColumns = [
  "session_id",
  "user_id",
  "tasks_data",
  "links_data",
  "created_by",
  "updated_by",
] as const;

const protectedColumns = [
  "id",
  "name",
  "project_name",
  "description",
  "status",
  "start_date",
  "finish_date",
  "revision",
  "slug",
  "public_id",
  "owner_id",
  "tenant_id",
  "org_id",
  "admin_token_hash",
  "edit_token_hash",
  "view_token_hash",
  "sharing_enabled",
  "data_date",
  "default_calendar_id",
  "archived_at",
  "created_at",
  "updated_at",
] as const;

const protectedTables = [
  "gantt_projects",
  "gantt_project_events",
  "gantt_wbs_nodes",
  "gantt_activities",
  "gantt_activity_dependencies",
  "gantt_calendars",
  "gantt_calendar_exceptions",
] as const;

function executableSql(sql: string): string {
  return sql
    .replace(/--[^\n]*(?:\n|$)/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "\n");
}

describe("Legacy gantt_projects column decommission migration 0027", () => {
  it("registers migration 0027 after 0026", () => {
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0027_drop_legacy_gantt_project_columns"
    );
    const previous = journal.entries.find(
      (candidate) => candidate.tag === "0026_drop_legacy_gantt_tables"
    );

    expect(entry).toMatchObject({ idx: 27, tag: "0027_drop_legacy_gantt_project_columns" });
    expect(previous).toBeDefined();
    expect(entry?.when).toBeGreaterThan(previous?.when ?? 0);
  });

  it("drops exactly 6 columns from public.gantt_projects", () => {
    const exec = executableSql(migration);
    const matches = [...exec.matchAll(/\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(\w+)/gi)];
    const droppedColumns = matches.map((m) => m[1].toLowerCase()).sort();

    expect(droppedColumns).toHaveLength(6);
    expect(droppedColumns).toEqual([...legacyColumns].sort());
  });

  it("only targets public.gantt_projects", () => {
    const exec = executableSql(migration);
    expect(exec).toMatch(/\bALTER\s+TABLE\s+public\.gantt_projects\b/i);
    expect(exec).not.toMatch(/\bALTER\s+TABLE\s+public\.(?!gantt_projects)\w+/i);
  });

  it("does not use CASCADE", () => {
    const exec = executableSql(migration);
    expect(exec).not.toMatch(/\bCASCADE\b/i);
  });

  it("does not drop protected columns", () => {
    const exec = executableSql(migration);
    for (const col of protectedColumns) {
      const pattern = new RegExp(`\\bDROP\\s+COLUMN\\s+${col}\\b`, "i");
      expect(exec).not.toMatch(pattern);
    }
  });

  it("does not touch other tables", () => {
    const exec = executableSql(migration);
    for (const table of protectedTables) {
      if (table === "gantt_projects") continue;
      const pattern = new RegExp(`\\b${table}\\b`, "i");
      expect(exec).not.toMatch(pattern);
    }
  });

  it("does not contain CREATE, INSERT, UPDATE, DELETE, GRANT, REVOKE, or TRUNCATE", () => {
    const exec = executableSql(migration);
    const forbidden = [
      /\bCREATE\b/i,
      /\bINSERT\b/i,
      /\bUPDATE\b/i,
      /\bDELETE\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bTRUNCATE\b/i,
    ];
    for (const pattern of forbidden) {
      expect(exec).not.toMatch(pattern);
    }
  });

  it("documents the decommission rationale and protected columns", () => {
    expect(doc).toMatch(/PR #361/i);
    for (const col of legacyColumns) {
      expect(doc).toContain(col);
    }
    expect(doc).toMatch(/CASCADE/i);
    expect(doc).toMatch(/preflight/i);
    expect(doc).toMatch(/verification/i);
    expect(doc).toMatch(/recovery/i);
  });

  it("keeps the preflight read-only with no mutating statements", () => {
    const modifyingStatement =
      /(^|;)\s*(ALTER|GRANT|REVOKE|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im;

    expect(preflight).not.toMatch(modifyingStatement);
  });

  it("preflight checks all 6 legacy columns", () => {
    for (const col of legacyColumns) {
      expect(preflight).toContain(col);
    }
  });

  it("keeps the verification read-only with no mutating statements", () => {
    const modifyingStatement =
      /(^|;)\s*(ALTER|GRANT|REVOKE|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im;

    expect(verification).not.toMatch(modifyingStatement);
  });

  it("verification confirms all 6 legacy columns should be absent", () => {
    for (const col of legacyColumns) {
      expect(verification).toContain(col);
    }
    expect(verification).toMatch(/column_absent/);
  });

  it("verification confirms protected columns and tables remain", () => {
    for (const col of protectedColumns) {
      expect(verification).toContain(col);
    }
    for (const table of protectedTables) {
      expect(verification).toContain(table);
    }
    expect(verification).toMatch(/column_exists/);
    expect(verification).toMatch(/table_exists/);
  });

  it("recovery plan references the existing server-side backup", () => {
    expect(recovery).toMatch(/phase2_legacy_gantt_backup/i);
    expect(recovery).toMatch(/gantt_projects_legacy_columns/i);
    expect(recovery).toMatch(/not.*commit.*production.*data/i);
  });
});
