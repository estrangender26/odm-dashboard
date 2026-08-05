-- Roll back only objects introduced by migration 0021. Existing activity data is preserved.
BEGIN;
DROP INDEX IF EXISTS public.gantt_activities_order_idx;
ALTER TABLE public.gantt_activities DROP COLUMN IF EXISTS sort_order;
COMMIT;
