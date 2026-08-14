-- Migration 0024 Phase 1 RLS pilot: exact rollback to the confirmed live baseline.
-- Restore all seven confirmed table privileges for anon and authenticated first,
-- then disable RLS. No sequences, roles, PUBLIC grants, or data are changed.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.existing_facilities_maintenance
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.mw_compliance
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.mw_escalations
  TO anon, authenticated;

ALTER TABLE public.existing_facilities_maintenance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_compliance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_escalations DISABLE ROW LEVEL SECURITY;

COMMIT;
