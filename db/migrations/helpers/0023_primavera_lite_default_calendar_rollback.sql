-- Rollback script for Migration 0023
-- Note: Migration 0023 is additive data backfill only and does not modify schema columns.
-- Manual rollback of backfilled default calendars is not required unless explicit recovery is requested.
-- Never drop default_calendar_id column or modify legacy Gantt projects.

SELECT 'Migration 0023 is additive backfill; no schema changes to roll back.' AS rollback_note;
