import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "db/migrations/0025_phase1b_decommission.sql"
);
const preflightPath = join(
  process.cwd(),
  "db/migrations/helpers/0025_phase1b_decommission_preflight.sql"
);
const verificationPath = join(
  process.cwd(),
  "db/migrations/helpers/0025_phase1b_decommission_verification.sql"
);
const docPath = join(
  process.cwd(),
  "db/migrations/helpers/0025_phase1b_decommission_migration_doc.md"
);
const recoveryPath = join(
  process.cwd(),
  "db/migrations/helpers/0025_phase1b_decommission_recovery.md"
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
  "odm_talk_notifications",
  "odm_talk_messages",
  "odm_talk_threads",
  "gantt_links",
] as const;

// Tables that 0025 must NOT touch. gantt_tasks and gantt_dependencies
// are legacy-only but were intentionally preserved by 0025; they are
// decommissioned in migration 0026 instead.
const protectedTables = [
  // Phase 1 tables
  "existing_facilities_maintenance",
  "mw_compliance",
  "mw_escalations",
  // Active Gantt/Primavera tables
  "gantt_projects",
  "gantt_tasks",
  "gantt_dependencies",
  "gantt_project_events",
  "gantt_calendars",
  "gantt_calendar_exceptions",
  "gantt_wbs_nodes",
  "gantt_activities",
  "gantt_activity_dependencies",
  // Other active tables
  "equipment",
  "tasks",
  "monthly_kpi_records",
  "governance_facilities",
  "governance_milestone_state",
  "governance_uploads",
  "governance_deliverable_status",
  "governance_files",
  "doc_folders",
  "doc_files",
  "smp_documents",
  "storage_upload_intents",
  "presentation_files",
  "legacy_storage_migration_ledger",
  "lihok_corporate_document_categories",
  "lihok_corporate_documents",
  "lihok_corporate_document_versions",
  "lihok_corporate_document_audit",
  "mw_inspections",
  "users",
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

describe("Phase 1B decommission migration 0025", () => {
  it("registers migration 0025 after the Phase 1 RLS pilot", () => {
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0025_phase1b_decommission"
    );
    const previous = journal.entries.find(
      (candidate) => candidate.tag === "0024_phase1_rls_pilot"
    );

    expect(entry).toMatchObject({ idx: 25, tag: "0025_phase1b_decommission" });
    expect(previous).toBeDefined();
    expect(entry?.when).toBeGreaterThan(previous?.when ?? 0);
  });

  it("drops exactly 4 tables and nothing else", () => {
    const drops = extractDropStatements(migration);

    expect(drops).toHaveLength(4);

    const droppedNames = drops
      .map(extractDroppedTableName)
      .filter((n): n is string => n !== null)
      .sort();

    expect(droppedNames).toEqual([...decommissionedTables].sort());
  });

  it("drops tables in FK-safe order", () => {
    const drops = extractDropStatements(migration);
    const ordered = drops
      .map(extractDroppedTableName)
      .filter((n): n is string => n !== null);

    // odm_talk_notifications must come before odm_talk_messages and odm_talk_threads
    // because it references both.
    const notifIdx = ordered.indexOf("odm_talk_notifications");
    const msgIdx = ordered.indexOf("odm_talk_messages");
    const threadIdx = ordered.indexOf("odm_talk_threads");
    const ganttIdx = ordered.indexOf("gantt_links");

    expect(notifIdx).toBeLessThan(msgIdx);
    expect(notifIdx).toBeLessThan(threadIdx);
    expect(msgIdx).toBeLessThan(threadIdx);
    // gantt_links has no FK constraints, so its position is unconstrained
    expect(ganttIdx).toBeGreaterThanOrEqual(0);
  });

  it("does not use CASCADE in executable SQL", () => {
    const exec = executableSql(migration);
    expect(exec).not.toMatch(/\bCASCADE\b/i);
    const drops = extractDropStatements(migration);
    for (const stmt of drops) {
      expect(stmt).not.toMatch(/\bCASCADE\b/i);
    }
  });

  it("does not touch any active Gantt/Primavera table", () => {
    const exec = executableSql(migration);
    for (const table of protectedTables) {
      const pattern = new RegExp(`\\b${table}\\b`, "i");
      expect(exec).not.toMatch(pattern);
    }
  });

  it("does not touch Phase 1 RLS pilot tables", () => {
    const exec = executableSql(migration);
    for (const table of [
      "existing_facilities_maintenance",
      "mw_compliance",
      "mw_escalations",
    ]) {
      expect(exec).not.toMatch(new RegExp(`\\b${table}\\b`, "i"));
    }
  });

  it("does not contain ALTER, GRANT, REVOKE, CREATE, INSERT, UPDATE, or DELETE", () => {
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

  it("documents the decommission rationale and drop order", () => {
    expect(migration).toMatch(/ODM-Talk.*removed/i);
    expect(migration).toMatch(/gantt_links.*absent/i);
    expect(migration).toMatch(/CASCADE.*not used|not.*CASCADE/i);
    expect(migration).toMatch(/DROP TABLE.*RESTRICT|RESTRICT|plain DROP TABLE/i);
  });

  it("keeps the preflight read-only with no mutating statements", () => {
    const modifyingStatement =
      /(^|;)\s*(ALTER|GRANT|REVOKE|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im;

    expect(preflight).not.toMatch(modifyingStatement);
  });

  it("preflight checks all 4 target tables", () => {
    for (const table of decommissionedTables) {
      expect(preflight).toContain(table);
    }
  });

  it("keeps the verification read-only with no mutating statements", () => {
    const modifyingStatement =
      /(^|;)\s*(ALTER|GRANT|REVOKE|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im;

    expect(verification).not.toMatch(modifyingStatement);
  });

  it("verification confirms all 4 tables should not exist", () => {
    for (const table of decommissionedTables) {
      expect(verification).toContain(table);
    }
    expect(verification).toMatch(/table_exists/);
  });

  it("recovery plan documents backup and restoration", () => {
    expect(recovery).toMatch(/pg_dump/i);
    expect(recovery).toMatch(/backup/i);
    expect(recovery).toMatch(/restor/i);
    expect(recovery).toMatch(/not.*commit.*production.*data/i);
    expect(recovery).toMatch(/DROP TABLE.*destructive/i);
  });

  it("migration doc covers scope, drop order, and preflight", () => {
    expect(doc).toMatch(/odm_talk_notifications/);
    expect(doc).toMatch(/odm_talk_messages/);
    expect(doc).toMatch(/odm_talk_threads/);
    expect(doc).toMatch(/gantt_links/);
    expect(doc).toMatch(/CASCADE/i);
    expect(doc).toMatch(/preflight/i);
    expect(doc).toMatch(/verification/i);
    expect(doc).toMatch(/recovery/i);
  });
});
