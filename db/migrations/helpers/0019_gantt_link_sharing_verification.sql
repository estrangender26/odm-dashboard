-- Post-migration verification for 0019_gantt_link_sharing
-- Run this after applying the migration to confirm completeness.

SELECT
  'public_id coverage' AS check_name,
  CASE WHEN count(*) FILTER (WHERE public_id IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  count(*) FILTER (WHERE public_id IS NULL) AS null_count,
  count(*) AS total_rows
FROM gantt_projects

UNION ALL

SELECT
  'slug coverage' AS check_name,
  CASE WHEN count(*) FILTER (WHERE slug IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  count(*) FILTER (WHERE slug IS NULL) AS null_count,
  count(*) AS total_rows
FROM gantt_projects

UNION ALL

SELECT
  'public_id uniqueness' AS check_name,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  count(*) AS null_count,
  (SELECT count(*) FROM gantt_projects) AS total_rows
FROM (
  SELECT public_id FROM gantt_projects WHERE public_id IS NOT NULL
  GROUP BY public_id HAVING count(*) > 1
) d

UNION ALL

SELECT
  'slug uniqueness' AS check_name,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  count(*) AS null_count,
  (SELECT count(*) FROM gantt_projects) AS total_rows
FROM (
  SELECT slug FROM gantt_projects WHERE slug IS NOT NULL
  GROUP BY slug HAVING count(*) > 1
) d

UNION ALL

SELECT
  'helper columns present' AS check_name,
  CASE WHEN count(*) = 8 THEN 'PASS' ELSE 'FAIL' END AS result,
  count(*) AS null_count,
  8 AS total_rows
FROM information_schema.columns
WHERE table_name = 'gantt_projects'
  AND column_name IN (
    'public_id','slug','edit_token_hash','view_token_hash','revision',
    'data_date','default_calendar_id','sharing_enabled','last_scheduled_at'
  );
