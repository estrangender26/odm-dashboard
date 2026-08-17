-- Migration 0024 Phase 1 RLS pilot: read-only dry-run preflight.
-- Run this query before the forward migration. It performs no writes.
-- The result should show owner=postgres, RLS disabled, FORCE RLS disabled,
-- zero policies, and the confirmed seven table privileges for both roles.

WITH approved_tables(table_name) AS (
  VALUES
    ('existing_facilities_maintenance'::text),
    ('mw_compliance'::text),
    ('mw_escalations'::text)
)
SELECT
  approved_tables.table_name,
  pg_get_userbyid(class.relowner) AS owner,
  class.relrowsecurity AS rls_enabled,
  class.relforcerowsecurity AS force_rls,
  COUNT(policy.policyname)::integer AS policy_count,
  has_table_privilege('anon', format('public.%I', approved_tables.table_name), 'SELECT') AS anon_select,
  has_table_privilege('anon', format('public.%I', approved_tables.table_name), 'INSERT') AS anon_insert,
  has_table_privilege('anon', format('public.%I', approved_tables.table_name), 'UPDATE') AS anon_update,
  has_table_privilege('anon', format('public.%I', approved_tables.table_name), 'DELETE') AS anon_delete,
  has_table_privilege('anon', format('public.%I', approved_tables.table_name), 'TRUNCATE') AS anon_truncate,
  has_table_privilege('anon', format('public.%I', approved_tables.table_name), 'REFERENCES') AS anon_references,
  has_table_privilege('anon', format('public.%I', approved_tables.table_name), 'TRIGGER') AS anon_trigger,
  has_table_privilege('authenticated', format('public.%I', approved_tables.table_name), 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', format('public.%I', approved_tables.table_name), 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', format('public.%I', approved_tables.table_name), 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', format('public.%I', approved_tables.table_name), 'DELETE') AS authenticated_delete,
  has_table_privilege('authenticated', format('public.%I', approved_tables.table_name), 'TRUNCATE') AS authenticated_truncate,
  has_table_privilege('authenticated', format('public.%I', approved_tables.table_name), 'REFERENCES') AS authenticated_references,
  has_table_privilege('authenticated', format('public.%I', approved_tables.table_name), 'TRIGGER') AS authenticated_trigger
FROM approved_tables
JOIN pg_class AS class
  ON class.oid = format('public.%I', approved_tables.table_name)::regclass
LEFT JOIN pg_policies AS policy
  ON policy.schemaname = 'public'
 AND policy.tablename = approved_tables.table_name
GROUP BY approved_tables.table_name, class.relowner, class.relrowsecurity, class.relforcerowsecurity
ORDER BY approved_tables.table_name;
