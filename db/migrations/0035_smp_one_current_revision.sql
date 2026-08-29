-- Migration 0035: at most one current revision per SMP document series.
--
-- Strengthens the controlled-document invariant at the database level: a
-- document series must never have two revisions with status = 'current'
-- simultaneously. The application already preserves this invariant (the
-- finalize flow supersedes the previous current revision before inserting the
-- new one — see api/smp-finalize.ts); this partial unique index makes the
-- invariant unenforceable-to-bypass.
--
-- Additive and data-preserving. A read-only preflight guard detects any
-- existing violations and FAILS THE MIGRATION loudly instead of silently
-- modifying production history.

DO $$
DECLARE violation_documents integer;
BEGIN
  SELECT count(*) INTO violation_documents
  FROM (
    SELECT document_id
    FROM smp_document_revisions
    WHERE status = 'current'
    GROUP BY document_id
    HAVING count(*) > 1
  ) v;
  IF violation_documents > 0 THEN
    RAISE EXCEPTION
      'SMP documents with multiple current revisions detected (% documents). Reconcile manually before applying migration 0035.',
      violation_documents;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "smp_document_revisions_one_current_idx"
  ON "smp_document_revisions" ("document_id")
  WHERE "status" = 'current';
