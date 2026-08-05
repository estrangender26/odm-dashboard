-- Migration 0021: Primavera Lite Activity Grid ordering
-- Additive, idempotent, drift-detecting, and data-preserving.

DO $$
DECLARE
  v_type text;
  v_nullable text;
  v_default text;
  v_nulls bigint;
  v_non_nulls bigint;
  v_index_definition text;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO v_type, v_nullable, v_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'gantt_activities'
    AND column_name = 'sort_order';

  IF v_type IS NULL THEN
    ALTER TABLE public.gantt_activities ADD COLUMN sort_order integer;
  ELSIF v_type <> 'integer' THEN
    RAISE EXCEPTION 'gantt_activities.sort_order type conflict: expected integer, found %', v_type;
  END IF;

  SELECT count(*) FILTER (WHERE sort_order IS NULL), count(*) FILTER (WHERE sort_order IS NOT NULL)
    INTO v_nulls, v_non_nulls
  FROM public.gantt_activities;

  IF v_nulls > 0 AND v_non_nulls > 0 THEN
    RAISE EXCEPTION 'gantt_activities.sort_order drift: mixed NULL and non-NULL values';
  END IF;

  IF v_nulls > 0 THEN
    WITH ordered AS (
      SELECT id,
             row_number() OVER (PARTITION BY project_id, wbs_node_id ORDER BY id) - 1 AS sort_order
      FROM public.gantt_activities
    )
    UPDATE public.gantt_activities AS activity
    SET sort_order = ordered.sort_order
    FROM ordered
    WHERE activity.id = ordered.id;
  END IF;

  ALTER TABLE public.gantt_activities ALTER COLUMN sort_order SET DEFAULT 0;
  ALTER TABLE public.gantt_activities ALTER COLUMN sort_order SET NOT NULL;

  SELECT indexdef INTO v_index_definition
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'gantt_activities_order_idx';

  IF v_index_definition IS NULL THEN
    CREATE INDEX gantt_activities_order_idx
      ON public.gantt_activities USING btree (project_id, wbs_node_id, sort_order);
  ELSIF regexp_replace(lower(v_index_definition), '["[:space:]]', '', 'g') NOT LIKE
      '%onpublic.gantt_activitiesusingbtree(project_id,wbs_node_id,sort_order)%' THEN
    RAISE EXCEPTION 'gantt_activities_order_idx definition conflict: %', v_index_definition;
  END IF;
END $$;
