-- Verification for migration 0021. Every query should return the expected value shown.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'gantt_activities'
  AND column_name = 'sort_order';
-- Expected: integer, NO, 0.

SELECT indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'gantt_activities_order_idx';
-- Expected columns: project_id, wbs_node_id, sort_order.

WITH ranked AS (
  SELECT project_id, wbs_node_id, sort_order,
         row_number() OVER (PARTITION BY project_id, wbs_node_id ORDER BY sort_order, id) - 1 AS expected
  FROM public.gantt_activities
)
SELECT count(*) AS non_contiguous_rows
FROM ranked
WHERE sort_order <> expected;
-- Expected: 0.
