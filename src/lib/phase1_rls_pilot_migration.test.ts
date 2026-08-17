import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "db/migrations/0024_phase1_rls_pilot.sql"
);
const preflightPath = join(
  process.cwd(),
  "db/migrations/helpers/0024_phase1_rls_pilot_preflight.sql"
);
const rollbackPath = join(
  process.cwd(),
  "db/migrations/helpers/0024_phase1_rls_pilot_rollback.sql"
);
const verificationPath = join(
  process.cwd(),
  "db/migrations/helpers/0024_phase1_rls_pilot_verification.sql"
);
const journalPath = join(process.cwd(), "db/migrations/meta/_journal.json");

const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const verification = readFileSync(verificationPath, "utf8");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

const approvedTables = [
  "existing_facilities_maintenance",
  "mw_compliance",
  "mw_escalations",
] as const;

function executableSql(sql: string): string {
  return sql
    .replace(/--[^\n]*(?:\n|$)/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "\n");
}

function publicTableReferences(sql: string): string[] {
  return [
    ...executableSql(sql).matchAll(/\bpublic\.([a-z_][a-z0-9_]*)\b/gi),
  ].map(match => match[1].toLowerCase());
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(sql: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  return [...sql.matchAll(new RegExp(pattern.source, flags))].length;
}

function isApprovedTable(table: string): boolean {
  return (approvedTables as readonly string[]).includes(table);
}

describe("Phase 1 RLS pilot migration 0024", () => {
  it("registers migration 0024 after the authoritative migration", () => {
    const entry = journal.entries.find(
      candidate => candidate.tag === "0024_phase1_rls_pilot"
    );
    const previous = journal.entries.find(
      candidate => candidate.idx === 23
    );

    expect(entry).toMatchObject({ idx: 24, tag: "0024_phase1_rls_pilot" });
    expect(previous).toBeDefined();
    expect(entry?.when).toBeGreaterThan(previous?.when ?? 0);
  });

  it("limits the forward SQL to the three approved tables", () => {
    const sql = executableSql(migration);
    const references = publicTableReferences(migration);

    expect(references).toHaveLength(6);
    expect([...new Set(references)].sort()).toEqual([...approvedTables].sort());
    expect(sql).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+[^;]*\bFORCE\b/i);
    expect(sql).not.toMatch(/\b(?:TO|FROM)\s+PUBLIC\b(?!\.)/i);
    expect(sql).not.toMatch(/\b(?:TO|FROM)\s+(?:postgres|service_role)\b/i);
    expect(sql).not.toMatch(/\bSEQUENCE\b/i);

    for (const table of approvedTables) {
      const tablePattern = escaped(table);
      expect(sql).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+public\\.${tablePattern}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`,
          "i"
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `REVOKE\\s+ALL\\s+PRIVILEGES\\s+ON\\s+TABLE\\s+public\\.${tablePattern}\\s+FROM\\s+anon\\s*,\\s*authenticated\\s*;`,
          "i"
        )
      );
    }

    expect(
      countMatches(
        sql,
        /ALTER\s+TABLE\s+public\.[a-z_]+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
      )
    ).toBe(3);
    expect(countMatches(sql, /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE/i)).toBe(
      3
    );
  });

  it("documents the backend-only, no-policy, BYPASSRLS design", () => {
    expect(migration).toMatch(/backend-only model/i);
    expect(migration).toMatch(/postgres.*BYPASSRLS/i);
    expect(migration).toMatch(/browser.*Supabase Data API.*table CRUD/i);
    expect(migration).toMatch(/No policies are created by design/i);
    expect(migration).toMatch(/TRUNCATE.*REFERENCES/i);
    expect(migration).toMatch(/Sequences are not touched/i);
    expect(migration).toMatch(/PUBLIC is not modified/i);
  });

  it("keeps the dry-run and verification helpers read-only and in scope", () => {
    const modifyingStatement =
      /(^|;)\s*(ALTER|GRANT|REVOKE|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/im;

    expect(preflight).not.toMatch(modifyingStatement);
    expect(verification).not.toMatch(modifyingStatement);
    expect(`${preflight}\n${verification}`).not.toMatch(/odm[-_ ]talk/i);
    expect(`${preflight}\n${verification}`).toMatch(
      /existing_facilities_maintenance/
    );
    expect(`${preflight}\n${verification}`).toMatch(/mw_compliance/);
    expect(`${preflight}\n${verification}`).toMatch(/mw_escalations/);
  });

  it("rolls back all seven confirmed privileges before disabling RLS", () => {
    const sql = executableSql(rollback);
    const privilegeList =
      "SELECT\\s*,\\s*INSERT\\s*,\\s*UPDATE\\s*,\\s*DELETE\\s*,\\s*TRUNCATE\\s*,\\s*REFERENCES\\s*,\\s*TRIGGER";

    expect(publicTableReferences(rollback)).toHaveLength(6);
    expect([...new Set(publicTableReferences(rollback))].sort()).toEqual(
      [...approvedTables].sort()
    );
    expect(sql).toContain("REFERENCES");
    expect(sql).toContain("TRIGGER");

    for (const table of approvedTables) {
      expect(sql).toMatch(
        new RegExp(
          `GRANT\\s+${privilegeList}\\s+ON\\s+TABLE\\s+public\\.${escaped(table)}\\s+TO\\s+anon\\s*,\\s*authenticated\\s*;`,
          "i"
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+public\\.${escaped(table)}\\s+DISABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`,
          "i"
        )
      );
    }

    expect(countMatches(sql, /\bGRANT\b/i)).toBe(3);
    expect(countMatches(sql, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i)).toBe(3);
  });

  it("does not mention ODM-Talk or another table in the migration SQL", () => {
    expect(`${migration}\n${rollback}`).not.toMatch(/odm[-_ ]talk/i);
    expect(publicTableReferences(migration).every(isApprovedTable)).toBe(true);
    expect(publicTableReferences(rollback).every(isApprovedTable)).toBe(true);
  });
});
