-- Read-only preflight for migration 0021.
SELECT current_database() AS database_name, version() AS postgres_version;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'gantt_activities'
  AND column_name = 'sort_order';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'gantt_activities_order_idx';

SELECT count(*) AS activity_count,
       count(*) FILTER (WHERE project_id IS NULL OR wbs_node_id IS NULL) AS invalid_partition_keys
FROM public.gantt_activities;
