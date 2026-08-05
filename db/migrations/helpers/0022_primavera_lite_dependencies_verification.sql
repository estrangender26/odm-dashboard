SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'gantt_activity_dependencies'
ORDER BY ordinal_position;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'gantt_activity_dependencies'
ORDER BY indexname;

SELECT COUNT(*) AS legacy_dependency_count FROM gantt_dependencies;
