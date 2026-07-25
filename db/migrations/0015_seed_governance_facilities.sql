-- Seed Governance Onboarding Facilities
-- Inserts the four expected facilities if they don't exist

INSERT INTO public.governance_facilities (slug, name, short_name)
VALUES 
  ('aglipay', 'AGLIPAY Sewage Treatment Plant', 'AGLIPAY STP'),
  ('htt', 'HTT Sewage Treatment Plant', 'HTT STP'),
  ('eastbay', 'EASTBAY Phase 2 Treatment Plant', 'EASTBAY PH-2 TP'),
  ('kaysakat', 'KAYSAKAT Treatment Plant', 'KAYSAKAT TP')
ON CONFLICT (slug) DO NOTHING;

-- Verify insertion
SELECT 'Governance facilities after seed:' as status;
SELECT slug, name, short_name FROM public.governance_facilities ORDER BY slug;
