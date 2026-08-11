-- Verification script for Migration 0023
-- Verify that 0 Primavera Lite projects are missing a default calendar

SELECT p.id, p.name, p.default_calendar_id
FROM gantt_projects p
WHERE EXISTS (SELECT 1 FROM gantt_wbs_nodes w WHERE w.project_id = p.id)
  AND (p.default_calendar_id IS NULL OR NOT EXISTS (SELECT 1 FROM gantt_calendars c WHERE c.id = p.default_calendar_id AND c.project_id = p.id));
