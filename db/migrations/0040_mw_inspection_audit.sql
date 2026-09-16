-- Migration 0040: Operator-Driven Maintenance destructive-operation audit trail.
--
-- Why this migration exists
-- ------------------------
-- On 2026-09-16 production `public.mw_inspections` dropped from 16,543 rows
-- (measured 2026-09-11) to 2,372 rows. Approximately 14,171 historical rows were
-- destroyed, and no record existed anywhere of the operation, the actor, the
-- time or the affected count: the ODM mutating tRPC procedures were reachable
-- without authentication and wrote nothing when they ran.
--
-- This migration creates the table that makes every future ODM write
-- attributable. The application writes one row per mutation inside the same
-- transaction as the mutation, so an unattributable destructive write cannot
-- commit.
--
-- Scope and safety
-- ----------------
-- Strictly additive and idempotent:
--   * creates one table and one index with IF NOT EXISTS;
--   * does not read, update, move, truncate or delete any existing row;
--   * does not alter any existing table, column, type, constraint, sequence,
--     policy or privilege;
--   * therefore requires no preflight, backup or rollback artifact
--     (db/migrations/helpers/migration_governance_doc.md, "Future migrations":
--     artifacts are required only when a migration modifies production data or
--     types). A verification helper is provided anyway at
--     helpers/0040_mw_inspection_audit_verification.sql.
--
-- RLS posture follows migration 0028 exactly: this is a backend-only table, so
-- RLS is enabled with no policy and anon/authenticated privileges are revoked.
-- FORCE ROW LEVEL SECURITY stays OFF and the owning backend role is unchanged.
--
-- Authored by hand rather than with `drizzle-kit generate`: the snapshot chain in
-- db/migrations/meta/ ends at 0027_snapshot.json, so 0028-0039 are hand-authored
-- with matching journal entries, and generating from 0027 would emit a spurious
-- reconciliation migration. The journal entry follows the same strictly
-- increasing `when` rule as every entry after 0020.

CREATE TABLE IF NOT EXISTS "mw_inspection_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "operation" varchar(32) NOT NULL,
  "actor_id" integer,
  "actor_role" varchar(50),
  "resource" varchar(255) NOT NULL,
  "affected_count" integer DEFAULT 0 NOT NULL,
  "correlation_id" varchar(64) NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mw_inspection_audit_operation_idx"
  ON "mw_inspection_audit" ("operation", "created_at");

ALTER TABLE public.mw_inspection_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.mw_inspection_audit FROM anon, authenticated;
