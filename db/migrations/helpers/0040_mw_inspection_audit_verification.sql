-- Migration 0040 verification: the ODM audit table exists with the expected
-- shape, is backend-only (RLS enabled, no policy, anon/authenticated revoked),
-- and — critically — that no existing inspection row was touched.
--
-- Read-only. Safe to run at any time, including against production.

-- 1. The audit table exists with exactly the expected columns and types.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'mw_inspection_audit'
ORDER BY ordinal_position;
-- Expected: id/integer, operation/varchar, actor_id/integer, actor_role/varchar,
--           resource/varchar, affected_count/integer, correlation_id/varchar,
--           detail/jsonb, created_at/timestamp with time zone

-- 2. The operation index exists.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'mw_inspection_audit';
-- Expected: mw_inspection_audit_pkey and mw_inspection_audit_operation_idx

-- 3. RLS is enabled and no policy exists (backend-only table, migration 0028 posture).
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname = 'mw_inspection_audit';
-- Expected: relrowsecurity = true, relforcerowsecurity = false

SELECT count(*) AS audit_policy_count
FROM pg_policy
WHERE polrelid = 'public.mw_inspection_audit'::regclass;
-- Expected: 0

-- 4. anon/authenticated hold no privilege on the audit table.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'mw_inspection_audit'
  AND grantee IN ('anon', 'authenticated');
-- Expected: 0 rows

-- 5. Migration did not touch inspection data: row count and id range are
--    unchanged from the pre-migration baseline.
SELECT count(*) AS mw_inspections_rows, min(id) AS min_id, max(id) AS max_id
FROM public.mw_inspections;

-- 6. Audit table starts empty.
SELECT count(*) AS audit_rows FROM public.mw_inspection_audit;
