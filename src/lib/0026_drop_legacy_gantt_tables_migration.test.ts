import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "db/migrations/0026_drop_legacy_gantt_tables.sql"
);
const preflightPath = join(
  process.cwd(),
  "db/migrations/helpers/0026_drop_legacy_gantt_tables_preflight.sql"
);
const verificationPath = join(
  process.cwd(),
  "db/migrations/helpers/0026_drop_legacy_gantt_tables_verification.sql"
);
const docPath = join(
  process.cwd(),
  "db/migrations/helpers/0026_drop_legacy_gantt_tables_migration_doc.md"
);
const recoveryPath = join(
  process.cwd(),
  "db/migrations/helpers/0026_drop_legacy_gantt_tables_recovery.md"
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

const decommissionedTables = [
  "gantt_dependencies",
  "gantt_tasks",
] as const;

const protectedTables = [
  "gantt_projects",
  "gantt_project_events",
  "gantt_calendars",
  "gantt_calendar_exceptions",
  "gantt_wbs_nodes",
  "gantt_activities",
  "gantt_activity_dependencies",
] as const;

function executableSql(sql: string): string {
  return sql
    .replace(/--[^\n]*(?:\n|$)/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "\n");
}

function extractDropStatements(sql: string): string[] {
  const exec = executableSql(sql);
  return [...exec.matchAll(/\bDROP\s+TABLE\b[^;]*;/gi)].map((m) =>
    m[0].trim()
  );
}

function extractDroppedTableName(stmt: string): string | null {
  const match = stmt.match(
    /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/i
  );
  return match ? match[1].toLowerCase() : null;
}

describe("Legacy Gantt table decommission migration 0026", () => {
  it("registers migration 0026 after 0025", () => {
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0026_drop_legacy_gantt_tables"
    );
    const previous = journal.entries.find(
      (candidate) => candidate.tag === "0025_phase1b_decommission"
    );

    expect(entry).toMatchObject({ idx: 26, tag: "0026_drop_legacy_gantt_tables" });
    expect(previous).toBeDefined();
    expect(entry?.when).toBeGreaterThan(previous?.when ?? 0);
  });

  it("drops exactly 2 tables and nothing else", () => {
    const drops = extractDropStatements(migration);

    expect(drops).toHaveLength(2);

    const droppedNames = drops
      .map(extractDroppedTableName)
      .filter((n): n is string => n !== null)
      .sort();

    expect(droppedNames).toEqual([...decommissionedTables].sort());
  });

  it("does not use CASCADE in executable SQL", () => {
    const exec = executableSql(migration);
    expect(exec).not.toMatch(/\bCASCADE\b/i);
    const drops = extractDropStatements(migration);
    for (const stmt of drops) {
      expect(stmt).not.toMatch(/\bCASCADE\b/i);
    }
  });

  it("does not touch any active Primavera table", () => {
    const exec = executableSql(migration);
    for (const table of protectedTables) {
      const pattern = new RegExp(`\\b${table}\\b`, "i");
      expect(exec).not.toMatch(pattern);
    }
  });

  it("does not contain ALTER, GRANT, REVOKE, CREATE, INSERT, UPDATE, DELETE, or TRUNCATE", () => {
    const exec = executableSql(migration);
    const forbidden = [
      /\bALTER\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bCREATE\b/i,
      /\bINSERT\b/i,
      /\bUPDATE\b/i,
      /\bDELETE\b/i,
      /\bTRUNCATE\b/i,
    ];
    for (const pattern of forbidden) {
      expect(exec).not.toMatch(pattern);
    }
  });

  it("documents the decommission rationale and references PR #361", () => {
    expect(doc).toMatch(/PR #361/i);
    expect(doc).toMatch(/gantt_dependencies/);
    expect(doc).toMatch(/gantt_tasks/);
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

  it("preflight checks both target tables", () => {
    for (const table of decommissionedTables) {
      expect(preflight).toContain(table);
    }
  });

  it("keeps the verification read-only with no mutating statements", () => {
    const modifyingStatement =
      /(^|;)\s*(ALTER|GRANT|REVOKE|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im;

    expect(verification).not.toMatch(modifyingStatement);
  });

  it("verification confirms both tables should not exist", () => {
    for (const table of decommissionedTables) {
      expect(verification).toContain(table);
    }
    expect(verification).toMatch(/table_absent/);
  });

  it("verification confirms protected Primavera tables still exist", () => {
    for (const table of protectedTables) {
      expect(verification).toContain(table);
    }
    expect(verification).toMatch(/table_exists/);
  });

  it("recovery plan documents backup and restoration", () => {
    expect(recovery).toMatch(/phase2_legacy_gantt_backup/i);
    expect(recovery).toMatch(/pg_dump/i);
    expect(recovery).toMatch(/restor/i);
    expect(recovery).toMatch(/not.*commit.*production.*data/i);
  });
});
