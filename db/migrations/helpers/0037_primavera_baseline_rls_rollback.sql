-- Rollback for migration 0037_primavera_baseline_rls.
-- Restores the pre-hardening state (RLS disabled, anon/authenticated granted).
-- This intentionally re-opens the browser-role exposure and should only be used
-- to undo the hardening; re-apply 0037 afterward.
ALTER TABLE public.gantt_baselines DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_baseline_activities DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.gantt_baselines TO anon, authenticated;
GRANT ALL ON TABLE public.gantt_baseline_activities TO anon, authenticated;
