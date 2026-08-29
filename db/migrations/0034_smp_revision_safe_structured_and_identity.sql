-- Migration 0034: SMP revision-safe structured data, reference-number
-- identity, canonical family relation, and recorded deletion.
--
-- Follow-up to 0033 per PR #404 review:
--   1. smp_documents.code (reference number) becomes a database-enforced
--      identity via a normalized key (lower/trimmed) with a unique index and
--      a trigger that keeps the key in sync. Duplicate detection runs first
--      and FAILS THE MIGRATION loudly instead of discarding data.
--   2. Structured procedure content (smp_sections, smp_tasks) becomes
--      revision-attributable: every row must reference a specific
--      smp_document_revisions row (NOT NULL revision_id).
--   3. Literal document family text (smp_family) is preserved as entered;
--      smp_documents.family_id adds an optional canonical catalog relation.
--   4. smp_deletion_records ledger for staged, recorded document deletion
--      (storage removal and DB deletion are deliberately not atomic).
--
-- Strictly additive / data-preserving: no DROP of data-bearing objects, no
-- TRUNCATE, no DELETE. Existing rows are never discarded; constraints that
-- require attribution fail loudly when orphan rows exist.

-- ── 1. Reference-number identity ────────────────────────────────────────────
-- 1a. Read-only duplicate detection: fail clearly rather than silently
--     discarding or merging data. Runs before the unique index is created.
DO $$
DECLARE dup_groups integer;
BEGIN
  SELECT count(*) INTO dup_groups
  FROM (
    SELECT lower(trim(code)) AS key
    FROM smp_documents
    GROUP BY lower(trim(code))
    HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION
      'SMP reference-number duplicates detected (% groups). Reconcile manually before applying migration 0034 uniqueness.',
      dup_groups;
  END IF;
END $$;

-- 1b. Normalized identity key (case/whitespace-insensitive comparison).
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "code_key" varchar(50) NOT NULL DEFAULT '';

UPDATE "smp_documents" SET "code_key" = lower(trim("code")) WHERE "code_key" = '';

CREATE UNIQUE INDEX IF NOT EXISTS "smp_documents_code_key_unique" ON "smp_documents" ("code_key");

-- 1c. Keep the identity key in sync on every insert/update of the reference.
CREATE OR REPLACE FUNCTION smp_documents_set_code_key() RETURNS trigger AS $$
BEGIN
  NEW.code_key := lower(trim(NEW.code));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS smp_documents_code_key_trigger ON smp_documents;
CREATE TRIGGER smp_documents_code_key_trigger
  BEFORE INSERT OR UPDATE OF "code" ON "smp_documents"
  FOR EACH ROW EXECUTE FUNCTION smp_documents_set_code_key();

-- ── 2. Revision-scoped structured data ─────────────────────────────────────
-- 2a. smp_sections: every section belongs to a specific revision.
ALTER TABLE "smp_sections" ADD COLUMN IF NOT EXISTS "revision_id" integer
  REFERENCES "smp_document_revisions"("id") ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM smp_sections WHERE revision_id IS NULL) THEN
    RAISE EXCEPTION
      'smp_sections rows without a revision exist; structured data must be revision-attributable (0034).';
  END IF;
END $$;

ALTER TABLE "smp_sections" ALTER COLUMN "revision_id" SET NOT NULL;

-- 2b. smp_tasks: the previously nullable revision_id becomes required and
--     cascades with its revision.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM smp_tasks WHERE revision_id IS NULL) THEN
    RAISE EXCEPTION
      'smp_tasks rows without a revision exist; structured data must be revision-attributable (0034).';
  END IF;
END $$;

ALTER TABLE "smp_tasks" ALTER COLUMN "revision_id" SET NOT NULL;

ALTER TABLE "smp_tasks" DROP CONSTRAINT IF EXISTS "smp_tasks_revision_id_fkey";
ALTER TABLE "smp_tasks"
  ADD CONSTRAINT "smp_tasks_revision_id_smp_document_revisions_fk"
  FOREIGN KEY ("revision_id") REFERENCES "smp_document_revisions"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "smp_sections_revision_idx" ON "smp_sections" ("revision_id");
CREATE INDEX IF NOT EXISTS "smp_tasks_revision_idx" ON "smp_tasks" ("revision_id");

-- ── 3. Canonical family relation ────────────────────────────────────────────
-- Literal document family text stays in smp_documents.smp_family. family_id
-- optionally classifies the document against the smp_families catalog.
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "family_id" integer
  REFERENCES "smp_families"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "smp_family_id_idx" ON "smp_documents" ("family_id");

-- ── 4. Recorded deletion ledger ─────────────────────────────────────────────
-- Staged destructive deletion: storage object removal and the DB row delete
-- are recorded in this ledger so failures are explicit and retryable. No
-- transactional atomicity across Postgres and Supabase Storage is claimed.
CREATE TABLE IF NOT EXISTS "smp_deletion_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "objects" jsonb NOT NULL DEFAULT '[]',
  "removed_objects" jsonb NOT NULL DEFAULT '[]',
  "failure_reason" text,
  "created_by" varchar(255),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "smp_deletion_records_document_idx"
  ON "smp_deletion_records" ("document_id");
CREATE INDEX IF NOT EXISTS "smp_deletion_records_status_idx"
  ON "smp_deletion_records" ("status");
CREATE INDEX IF NOT EXISTS "smp_deletion_records_token_idx"
  ON "smp_deletion_records" ("token_hash");

ALTER TABLE public.smp_deletion_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.smp_deletion_records FROM anon, authenticated;
