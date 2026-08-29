-- Migration 0037_primavera_baseline_rls
-- Baseline table security hardening: make public.gantt_baselines and
-- public.gantt_baseline_activities match the established Gantt security
-- posture (RLS enabled, no anon/authenticated table privileges).
--
-- Architecture invariant (unchanged):
--   Browser -> Primavera tRPC router -> project-token authorization
--             -> server Drizzle DB connection (DATABASE_URL, postgres/service
--                role with BYPASSRLS)
-- NOT:
--   Browser -> Supabase Data API -> baseline tables
--
-- The Primavera router accesses these tables only through the server-side
-- Drizzle connection, which runs as the backend role. Like migrations 0024 and
-- 0028, this migration therefore:
--   * enables RLS (no FORCE ROW LEVEL SECURITY),
--   * revokes ALL table privileges from anon and authenticated,
--   * creates NO policies (backend owner path remains available),
--   * never touches the postgres / service_role roles.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY and REVOKE are safe to re-run.

ALTER TABLE public.gantt_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_baseline_activities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gantt_baselines FROM anon, authenticated;
REVOKE ALL ON TABLE public.gantt_baseline_activities FROM anon, authenticated;

DO $$
DECLARE
  v_rls_baselines boolean;
  v_rls_activities boolean;
  v_browser_grants bigint;
BEGIN
  SELECT relrowsecurity INTO v_rls_baselines
    FROM pg_class WHERE oid = 'public.gantt_baselines'::regclass;
  SELECT relrowsecurity INTO v_rls_activities
    FROM pg_class WHERE oid = 'public.gantt_baseline_activities'::regclass;

  IF v_rls_baselines IS DISTINCT FROM true OR v_rls_activities IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Baseline RLS hardening incomplete: RLS not enabled on both baseline tables';
  END IF;

  SELECT count(*) INTO v_browser_grants
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('gantt_baselines', 'gantt_baseline_activities')
      AND grantee IN ('anon', 'authenticated');

  IF v_browser_grants > 0 THEN
    RAISE EXCEPTION 'Baseline RLS hardening incomplete: anon/authenticated privileges remain (%)', v_browser_grants;
  END IF;
END $$;
