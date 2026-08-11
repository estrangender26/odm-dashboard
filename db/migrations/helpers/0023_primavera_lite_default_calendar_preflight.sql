-- Preflight check for Migration 0023
-- Check count of Primavera Lite projects missing a default calendar vs legacy Gantt projects

SELECT 
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM gantt_wbs_nodes w WHERE w.project_id = p.id)) AS primavera_lite_project_count,
  COUNT(*) FILTER (
    WHERE EXISTS (SELECT 1 FROM gantt_wbs_nodes w WHERE w.project_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM gantt_calendars c WHERE c.project_id = p.id)
  ) AS primavera_lite_missing_default_calendar_count,
  COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM gantt_wbs_nodes w WHERE w.project_id = p.id)) AS legacy_gantt_project_count
FROM gantt_projects p;
