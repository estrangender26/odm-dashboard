SELECT to_regclass('public.gantt_activity_dependencies') AS existing_normalized_dependency_table,
       to_regclass('public.gantt_dependencies') AS legacy_dependency_table;

SELECT COUNT(*) AS legacy_dependency_count FROM gantt_dependencies;
