import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "db/migrations/0028_enable_rls_remaining_tables.sql"
);
const preflightPath = join(
  process.cwd(),
  "db/migrations/helpers/0028_enable_rls_remaining_tables_preflight.sql"
);
const verificationPath = join(
  process.cwd(),
  "db/migrations/helpers/0028_enable_rls_remaining_tables_verification.sql"
);
const rollbackPath = join(
  process.cwd(),
  "db/migrations/helpers/0028_enable_rls_remaining_tables_rollback.sql"
);
const docPath = join(
  process.cwd(),
  "db/migrations/helpers/0028_enable_rls_remaining_tables_migration_doc.md"
);
const journalPath = join(process.cwd(), "db/migrations/meta/_journal.json");

const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const verification = readFileSync(verificationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const doc = readFileSync(docPath, "utf8");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

const targetTables = [
  "equipment",
  "governance_facilities",
  "upload_rate_limits",
  "mw_inspections",
  "gantt_project_events",
  "smp_documents",
  "governance_milestone_state",
  "governance_deliverable_status",
  "doc_folders",
  "lihok_corporate_document_categories",
  "lihok_corporate_documents",
  "users",
  "doc_files",
  "lihok_corporate_document_versions",
  "tasks",
  "monthly_kpi_records",
  "lihok_corporate_document_audit",
  "presentation_files",
  "storage_upload_intents",
  "governance_uploads",
  "governance_files",
  "gantt_calendars",
  "gantt_calendar_exceptions",
  "gantt_projects",
  "gantt_wbs_nodes",
  "gantt_activities",
  "gantt_activity_dependencies",
] as const;

function executableSql(sql: string): string {
  return sql
    .replace(/--[^\n]*(?:\n|$)/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "\n");
}

const execMigration = executableSql(migration);

describe("Migration 0028: enable RLS on remaining public tables", () => {
  it("registers migration 0028 after 0027", () => {
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0028_enable_rls_remaining_tables"
    );
    const previous = journal.entries.find(
      (candidate) => candidate.tag === "0027_drop_legacy_gantt_project_columns"
    );

    expect(entry).toMatchObject({
      idx: 28,
      tag: "0028_enable_rls_remaining_tables",
      when: 1791312000010,
    });
    expect(previous).toMatchObject({
      idx: 27,
      tag: "0027_drop_legacy_gantt_project_columns",
    });
    expect((entry?.when ?? 0) > (previous?.when ?? 0)).toBe(true);
  });

  it("targets exactly the 27 approved tables", () => {
    const enableMatches = [
      ...execMigration.matchAll(
        /ALTER\s+TABLE\s+public\.(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi
      ),
    ];
    const enabledTables = enableMatches.map((m) => m[1]).sort();
    expect(enabledTables).toEqual([...targetTables].sort());
    expect(enableMatches.length).toBe(27);
  });

  it("revokes all privileges from anon and authenticated on all 27 tables", () => {
    const revokeMatches = [
      ...execMigration.matchAll(
        /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+public\.(\w+)\s+FROM\s+anon,\s+authenticated/gi
      ),
    ];
    const revokedTables = revokeMatches.map((m) => m[1]).sort();
    expect(revokedTables).toEqual([...targetTables].sort());
    expect(revokeMatches.length).toBe(27);
  });

  it("does not create any policies", () => {
    expect(execMigration).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("does not enable FORCE ROW LEVEL SECURITY", () => {
    expect(execMigration).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it("does not disable ROW LEVEL SECURITY", () => {
    expect(execMigration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it("does not drop, alter columns, truncate, or delete data", () => {
    expect(execMigration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(execMigration).not.toMatch(/\bALTER\s+TABLE\s+\w+\s+(DROP|ALTER|MODIFY)\s+COLUMN/i);
    expect(execMigration).not.toMatch(/\bTRUNCATE\s+TABLE\b/i);
    expect(execMigration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("does not modify postgres, service_role, or PUBLIC", () => {
    expect(execMigration).not.toMatch(/\bpostgres\b/i);
    expect(execMigration).not.toMatch(/\bservice_role\b/i);
    expect(execMigration).not.toMatch(/\bPUBLIC\b/);
  });

  it("does not grant privileges to anon or authenticated", () => {
    expect(execMigration).not.toMatch(/GRANT\s+.*\s+TO\s+anon/i);
    expect(execMigration).not.toMatch(/GRANT\s+.*\s+TO\s+authenticated/i);
  });

  it("has required helper files", () => {
    expect(preflight).toContain("Preflight");
    expect(verification).toContain("Verification");
    expect(rollback).toContain("rollback");
    expect(doc).toContain("Migration 0028");
  });

  it("marks preflight and verification as read-only", () => {
    const execPreflight = executableSql(preflight);
    const execVerification = executableSql(verification);
    expect(execPreflight).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i);
    expect(execVerification).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i);
  });

  it("rollback restores original privileges and disables RLS", () => {
    const execRollback = executableSql(rollback);
    const grantCount = [
      ...execRollback.matchAll(
        /GRANT\s+SELECT,\s+INSERT,\s+UPDATE,\s+DELETE,\s+TRUNCATE,\s+REFERENCES,\s+TRIGGER\s+ON\s+TABLE\s+public\.(\w+)\s+TO\s+anon,\s+authenticated/gi
      ),
    ].length;
    const disableCount = [
      ...execRollback.matchAll(
        /ALTER\s+TABLE\s+public\.(\w+)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/gi
      ),
    ].length;
    expect(grantCount).toBe(27);
    expect(disableCount).toBe(27);
  });
});
