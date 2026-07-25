-- Governance Schema Inspection Script
-- Run this against production to verify column existence before migration

-- Check if table exists
SELECT 'Table exists check:' as check_type;
SELECT to_regclass('public.governance_milestone_state') as table_exists;

-- List all columns in the table
SELECT 'Current columns:' as check_type;
SELECT 
  column_name, 
  data_type,
  character_maximum_length,
  numeric_precision,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'governance_milestone_state'
ORDER BY ordinal_position;

-- Check which expected columns are missing
SELECT 'Missing expected columns:' as check_type;
SELECT column_name
FROM (VALUES 
  ('ppp_date'),
  ('comp_date'),
  ('custom_pct'),
  ('ready_status'),
  ('remarks')
) AS expected_columns(column_name)
WHERE NOT EXISTS (
  SELECT 1 
  FROM information_schema.columns 
  WHERE table_schema = 'public'
    AND table_name = 'governance_milestone_state'
    AND column_name = expected_columns.column_name
);
