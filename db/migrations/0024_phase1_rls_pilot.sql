-- Migration 0024: Phase 1 RLS pilot for the approved maintenance/compliance tables.
--
-- Scope is intentionally limited to exactly these three tables:
--   public.existing_facilities_maintenance
--   public.mw_compliance
--   public.mw_escalations
--
-- This is a backend-only model. Render connects through the PostgreSQL connection
-- as postgres, and postgres has BYPASSRLS = true. The postgres role is therefore
-- deliberately left unchanged so the existing backend path continues to work.
-- service_role also has BYPASSRLS = true and is deliberately left unchanged.
-- The browser is not intended to use Supabase Data API table CRUD for these tables.
--
-- No policies are created by design. Revoking table privileges from anon and
-- authenticated prevents browser Data API table access; the backend owner path
-- remains available through postgres. RLS does not govern TRUNCATE or REFERENCES,
-- so revoking ALL TABLE PRIVILEGES is required as defense in depth and includes
-- those privileges. Sequences are not touched.
--
-- RLS is enabled without FORCE ROW LEVEL SECURITY. FORCE RLS remains OFF, and
-- PUBLIC is not modified. The migration does not alter any role attributes.

ALTER TABLE public.existing_facilities_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_escalations ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.existing_facilities_maintenance FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mw_compliance FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mw_escalations FROM anon, authenticated;
