-- Migration 0020_primavera_lite_shell
-- Idempotent, drift-detecting, data-preserving.
-- Safe to re-run on a database where these objects were manually created.
-- Each existing object is validated against the canonical definition below.
-- On conflict the migration raises a clear error and rolls back.

-- Helper functions for validation (dropped at the end of the migration).
CREATE OR REPLACE FUNCTION public._mig_normalize_default(expr text) RETURNS text AS $$
DECLARE
  v text;
BEGIN
  IF expr IS NULL THEN RETURN NULL; END IF;
  v := lower(regexp_replace(regexp_replace(trim(expr), '^\s*\((.*)\)\s*$', '\1'), '\s+', ' ', 'g'));
  -- Strip PostgreSQL type casts such as 'task'::character varying
  v := regexp_replace(v, '::[a-z0-9_ ]+(\([0-9,]+\))?$', '', 'g');
  -- Normalize predicate column references: "table"."column" -> column, "column" -> column
  v := regexp_replace(v, '"([^"]+)"\."([^"]+)"', '\2', 'g');
  v := regexp_replace(v, '"([^"]+)"', '\1', 'g');
  RETURN v;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._mig_check_column(
  p_table text,
  p_column text,
  p_expected_type text,
  p_expected_nullable text,
  p_expected_varchar_length int,
  p_expected_default text
) RETURNS void AS $$
DECLARE
  v_type text;
  v_nullable text;
  v_varchar_length int;
  v_default text;
BEGIN
  SELECT data_type, is_nullable, character_maximum_length, column_default
  INTO v_type, v_nullable, v_varchar_length, v_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = p_table
    AND column_name = p_column;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Column %.% does not exist', p_table, p_column;
  END IF;

  IF lower(v_type) != lower(p_expected_type) THEN
    RAISE EXCEPTION 'Column %.% type conflict: expected %, found %', p_table, p_column, p_expected_type, v_type;
  END IF;

  IF v_nullable != p_expected_nullable THEN
    RAISE EXCEPTION 'Column %.% nullability conflict: expected %, found %', p_table, p_column, p_expected_nullable, v_nullable;
  END IF;

  IF p_expected_varchar_length IS NOT NULL AND v_varchar_length IS DISTINCT FROM p_expected_varchar_length THEN
    RAISE EXCEPTION 'Column %.% length conflict: expected %, found %', p_table, p_column, p_expected_varchar_length, COALESCE(v_varchar_length::text, 'NULL');
  END IF;

  IF p_expected_default IS NOT NULL THEN
    IF public._mig_normalize_default(v_default) IS DISTINCT FROM public._mig_normalize_default(p_expected_default) THEN
      RAISE EXCEPTION 'Column %.% default conflict: expected %, found %', p_table, p_column, p_expected_default, COALESCE(v_default, 'NULL');
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._mig_check_pk(p_table text, p_columns text) RETURNS void AS $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position)
  INTO v_cols
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = p_table
    AND tc.constraint_type = 'PRIMARY KEY';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'Table % has no primary key', p_table;
  END IF;

  IF v_cols != p_columns THEN
    RAISE EXCEPTION 'Table % primary key columns conflict: expected %, found %', p_table, p_columns, v_cols;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._mig_check_serial(p_table text, p_column text) RETURNS void AS $$
DECLARE
  v_default text;
  v_owned text;
BEGIN
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;

  IF v_default IS NULL OR lower(v_default) !~ 'nextval' THEN
    RAISE EXCEPTION 'Column %.% is not a serial column (no nextval default)', p_table, p_column;
  END IF;

  SELECT pg_get_serial_sequence(quote_ident(p_table), quote_ident(p_column)) INTO v_owned;
  IF v_owned IS NULL THEN
    RAISE EXCEPTION 'Column %.% has no owned sequence', p_table, p_column;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._mig_check_fk(
  p_constraint_name text,
  p_source_table text,
  p_source_columns text,
  p_referenced_table text,
  p_referenced_columns text,
  p_on_delete text,
  p_on_update text
) RETURNS void AS $$
DECLARE
  v_source_cols text;
  v_ref_table text;
  v_ref_cols text;
  v_on_delete text;
  v_on_update text;
BEGIN
  SELECT
    string_agg(a_src.attname, ',' ORDER BY array_position(c.conkey, a_src.attnum)),
    c.confrelid::regclass::text,
    string_agg(a_ref.attname, ',' ORDER BY array_position(c.confkey, a_ref.attnum))
  INTO v_source_cols, v_ref_table, v_ref_cols
  FROM pg_constraint c
  JOIN pg_class cl ON c.conrelid = cl.oid
  JOIN pg_attribute a_src ON a_src.attrelid = cl.oid AND a_src.attnum = ANY(c.conkey)
  JOIN pg_class cl_ref ON c.confrelid = cl_ref.oid
  JOIN pg_attribute a_ref ON a_ref.attrelid = cl_ref.oid AND a_ref.attnum = ANY(c.confkey)
  WHERE c.contype = 'f'
    AND cl.relnamespace = 'public'::regnamespace
    AND cl.relname = p_source_table
    AND c.conname = p_constraint_name
  GROUP BY c.confrelid;

  IF v_source_cols IS NULL THEN
    RAISE EXCEPTION 'Foreign key % on % does not exist', p_constraint_name, p_source_table;
  END IF;

  SELECT
    CASE c.confdeltype
      WHEN 'a' THEN 'no action'
      WHEN 'r' THEN 'restrict'
      WHEN 'c' THEN 'cascade'
      WHEN 'n' THEN 'set null'
      WHEN 'd' THEN 'set default'
      ELSE c.confdeltype::text
    END,
    CASE c.confupdtype
      WHEN 'a' THEN 'no action'
      WHEN 'r' THEN 'restrict'
      WHEN 'c' THEN 'cascade'
      WHEN 'n' THEN 'set null'
      WHEN 'd' THEN 'set default'
      ELSE c.confupdtype::text
    END
  INTO v_on_delete, v_on_update
  FROM pg_constraint c
  JOIN pg_class cl ON c.conrelid = cl.oid
  WHERE c.contype = 'f'
    AND cl.relnamespace = 'public'::regnamespace
    AND cl.relname = p_source_table
    AND c.conname = p_constraint_name;

  IF v_source_cols != p_source_columns THEN
    RAISE EXCEPTION 'Foreign key % source columns conflict: expected %, found %', p_constraint_name, p_source_columns, v_source_cols;
  END IF;

  IF v_ref_table != p_referenced_table THEN
    RAISE EXCEPTION 'Foreign key % referenced table conflict: expected %, found %', p_constraint_name, p_referenced_table, v_ref_table;
  END IF;

  IF v_ref_cols != p_referenced_columns THEN
    RAISE EXCEPTION 'Foreign key % referenced columns conflict: expected %, found %', p_constraint_name, p_referenced_columns, v_ref_cols;
  END IF;

  IF lower(v_on_delete) != lower(p_on_delete) THEN
    RAISE EXCEPTION 'Foreign key % ON DELETE conflict: expected %, found %', p_constraint_name, p_on_delete, v_on_delete;
  END IF;

  IF lower(v_on_update) != lower(p_on_update) THEN
    RAISE EXCEPTION 'Foreign key % ON UPDATE conflict: expected %, found %', p_constraint_name, p_on_update, v_on_update;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public._mig_check_index(
  p_index_name text,
  p_table_name text,
  p_columns text,
  p_unique boolean,
  p_am_name text,
  p_predicate text
) RETURNS void AS $$
DECLARE
  v_table text;
  v_cols text;
  v_unique boolean;
  v_am text;
  v_predicate text;
BEGIN
  SELECT
    c.relname AS table_name,
    string_agg(a.attname, ',' ORDER BY array_position(i.indkey, a.attnum)),
    i.indisunique,
    am.amname,
    pg_get_expr(i.indpred, i.indrelid)
  INTO v_table, v_cols, v_unique, v_am, v_predicate
  FROM pg_index i
  JOIN pg_class c ON i.indrelid = c.oid
  JOIN pg_class ic ON i.indexrelid = ic.oid
  JOIN pg_am am ON ic.relam = am.oid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
  WHERE c.relnamespace = 'public'::regnamespace
    AND ic.relname = p_index_name
  GROUP BY c.relname, i.indisunique, am.amname, i.indpred, i.indrelid;

  IF v_table IS NULL THEN
    RAISE EXCEPTION 'Index % does not exist', p_index_name;
  END IF;

  IF v_table != p_table_name THEN
    RAISE EXCEPTION 'Index % table conflict: expected %, found %', p_index_name, p_table_name, v_table;
  END IF;

  IF v_cols != p_columns THEN
    RAISE EXCEPTION 'Index % columns conflict: expected %, found %', p_index_name, p_columns, v_cols;
  END IF;

  IF v_unique != p_unique THEN
    RAISE EXCEPTION 'Index % uniqueness conflict: expected %, found %', p_index_name, p_unique, v_unique;
  END IF;

  IF lower(v_am) != lower(p_am_name) THEN
    RAISE EXCEPTION 'Index % access method conflict: expected %, found %', p_index_name, p_am_name, v_am;
  END IF;

  IF p_predicate IS NOT NULL THEN
    IF public._mig_normalize_default(v_predicate) IS DISTINCT FROM public._mig_normalize_default(p_predicate) THEN
      RAISE EXCEPTION 'Index % predicate conflict: expected %, found %', p_index_name, p_predicate, COALESCE(v_predicate, 'NULL');
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Create/validate gantt_projects columns
DO $$
DECLARE
  v_type text;
BEGIN
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'gantt_projects'
    AND column_name = 'admin_token_hash';

  IF v_type IS NULL THEN
    ALTER TABLE "gantt_projects" ADD COLUMN "admin_token_hash" varchar(64);
  ELSE
    PERFORM public._mig_check_column('gantt_projects', 'admin_token_hash', 'character varying', 'YES', 64, NULL);
  END IF;

  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'gantt_projects'
    AND column_name = 'archived_at';

  IF v_type IS NULL THEN
    ALTER TABLE "gantt_projects" ADD COLUMN "archived_at" timestamp with time zone;
  ELSE
    PERFORM public._mig_check_column('gantt_projects', 'archived_at', 'timestamp with time zone', 'YES', NULL, NULL);
  END IF;
END $$;

--> statement-breakpoint

-- Create/validate gantt_wbs_nodes
DO $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
  ) INTO v_exists;

  IF NOT v_exists THEN
    CREATE TABLE "gantt_wbs_nodes" (
      "id" serial PRIMARY KEY NOT NULL,
      "project_id" integer NOT NULL,
      "parent_node_id" integer,
      "code" varchar(100) NOT NULL,
      "name" varchar(500) NOT NULL,
      "sort_order" integer DEFAULT 0 NOT NULL,
      "is_leaf" boolean DEFAULT true NOT NULL,
      "archived_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now(),
      "updated_at" timestamp with time zone DEFAULT now()
    );
  ELSE
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'id', 'integer', 'NO', NULL, NULL);
    PERFORM public._mig_check_serial('gantt_wbs_nodes', 'id');
    PERFORM public._mig_check_pk('gantt_wbs_nodes', 'id');
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'project_id', 'integer', 'NO', NULL, NULL);
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'parent_node_id', 'integer', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'code', 'character varying', 'NO', 100, NULL);
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'name', 'character varying', 'NO', 500, NULL);
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'sort_order', 'integer', 'NO', NULL, '0');
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'is_leaf', 'boolean', 'NO', NULL, 'true');
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'archived_at', 'timestamp with time zone', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'created_at', 'timestamp with time zone', 'YES', NULL, 'now()');
    PERFORM public._mig_check_column('gantt_wbs_nodes', 'updated_at', 'timestamp with time zone', 'YES', NULL, 'now()');
  END IF;
END $$;

--> statement-breakpoint

-- Create/validate gantt_activities
DO $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'gantt_activities'
  ) INTO v_exists;

  IF NOT v_exists THEN
    CREATE TABLE "gantt_activities" (
      "id" serial PRIMARY KEY NOT NULL,
      "project_id" integer NOT NULL,
      "wbs_node_id" integer NOT NULL,
      "frontend_activity_uid" varchar(64),
      "activity_id" varchar(100),
      "activity_name" varchar(500) NOT NULL,
      "activity_type" varchar(20) DEFAULT 'task' NOT NULL,
      "calendar_id" integer,
      "original_duration_days" integer DEFAULT 0 NOT NULL,
      "remaining_duration_days" integer DEFAULT 0 NOT NULL,
      "planned_start" date,
      "planned_finish" date,
      "early_start" date,
      "early_finish" date,
      "late_start" date,
      "late_finish" date,
      "total_float_days" integer DEFAULT 0 NOT NULL,
      "free_float_days" integer DEFAULT 0 NOT NULL,
      "actual_start" date,
      "actual_finish" date,
      "percent_complete" integer DEFAULT 0 NOT NULL,
      "status" varchar(50),
      "constraint_type" varchar(20),
      "constraint_date" date,
      "notes" text,
      "revision" integer DEFAULT 1 NOT NULL,
      "updated_by_name" varchar(255),
      "archived_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now(),
      "updated_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "gantt_activities_frontend_activity_uid_unique" UNIQUE("frontend_activity_uid")
    );
  ELSE
    PERFORM public._mig_check_column('gantt_activities', 'id', 'integer', 'NO', NULL, NULL);
    PERFORM public._mig_check_serial('gantt_activities', 'id');
    PERFORM public._mig_check_pk('gantt_activities', 'id');
    PERFORM public._mig_check_column('gantt_activities', 'project_id', 'integer', 'NO', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'wbs_node_id', 'integer', 'NO', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'frontend_activity_uid', 'character varying', 'YES', 64, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'activity_id', 'character varying', 'YES', 100, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'activity_name', 'character varying', 'NO', 500, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'activity_type', 'character varying', 'NO', 20, '''task''');
    PERFORM public._mig_check_column('gantt_activities', 'calendar_id', 'integer', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'original_duration_days', 'integer', 'NO', NULL, '0');
    PERFORM public._mig_check_column('gantt_activities', 'remaining_duration_days', 'integer', 'NO', NULL, '0');
    PERFORM public._mig_check_column('gantt_activities', 'planned_start', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'planned_finish', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'early_start', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'early_finish', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'late_start', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'late_finish', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'total_float_days', 'integer', 'NO', NULL, '0');
    PERFORM public._mig_check_column('gantt_activities', 'free_float_days', 'integer', 'NO', NULL, '0');
    PERFORM public._mig_check_column('gantt_activities', 'actual_start', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'actual_finish', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'percent_complete', 'integer', 'NO', NULL, '0');
    PERFORM public._mig_check_column('gantt_activities', 'status', 'character varying', 'YES', 50, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'constraint_type', 'character varying', 'YES', 20, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'constraint_date', 'date', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'notes', 'text', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'revision', 'integer', 'NO', NULL, '1');
    PERFORM public._mig_check_column('gantt_activities', 'updated_by_name', 'character varying', 'YES', 255, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'archived_at', 'timestamp with time zone', 'YES', NULL, NULL);
    PERFORM public._mig_check_column('gantt_activities', 'created_at', 'timestamp with time zone', 'YES', NULL, 'now()');
    PERFORM public._mig_check_column('gantt_activities', 'updated_at', 'timestamp with time zone', 'YES', NULL, 'now()');
  END IF;
END $$;

--> statement-breakpoint

-- Validate/create foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'gantt_activities'
      AND constraint_name = 'gantt_activities_project_id_gantt_projects_id_fk'
  ) THEN
    ALTER TABLE "gantt_activities"
      ADD CONSTRAINT "gantt_activities_project_id_gantt_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."gantt_projects"("id")
      ON DELETE restrict ON UPDATE no action;
  ELSE
    PERFORM public._mig_check_fk(
      'gantt_activities_project_id_gantt_projects_id_fk',
      'gantt_activities', 'project_id',
      'gantt_projects', 'id',
      'restrict', 'no action'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'gantt_activities'
      AND constraint_name = 'gantt_activities_wbs_node_id_gantt_wbs_nodes_id_fk'
  ) THEN
    ALTER TABLE "gantt_activities"
      ADD CONSTRAINT "gantt_activities_wbs_node_id_gantt_wbs_nodes_id_fk"
      FOREIGN KEY ("wbs_node_id") REFERENCES "public"."gantt_wbs_nodes"("id")
      ON DELETE restrict ON UPDATE no action;
  ELSE
    PERFORM public._mig_check_fk(
      'gantt_activities_wbs_node_id_gantt_wbs_nodes_id_fk',
      'gantt_activities', 'wbs_node_id',
      'gantt_wbs_nodes', 'id',
      'restrict', 'no action'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'gantt_activities'
      AND constraint_name = 'gantt_activities_calendar_id_gantt_calendars_id_fk'
  ) THEN
    ALTER TABLE "gantt_activities"
      ADD CONSTRAINT "gantt_activities_calendar_id_gantt_calendars_id_fk"
      FOREIGN KEY ("calendar_id") REFERENCES "public"."gantt_calendars"("id")
      ON DELETE restrict ON UPDATE no action;
  ELSE
    PERFORM public._mig_check_fk(
      'gantt_activities_calendar_id_gantt_calendars_id_fk',
      'gantt_activities', 'calendar_id',
      'gantt_calendars', 'id',
      'restrict', 'no action'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
      AND constraint_name = 'gantt_wbs_nodes_project_id_gantt_projects_id_fk'
  ) THEN
    ALTER TABLE "gantt_wbs_nodes"
      ADD CONSTRAINT "gantt_wbs_nodes_project_id_gantt_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."gantt_projects"("id")
      ON DELETE restrict ON UPDATE no action;
  ELSE
    PERFORM public._mig_check_fk(
      'gantt_wbs_nodes_project_id_gantt_projects_id_fk',
      'gantt_wbs_nodes', 'project_id',
      'gantt_projects', 'id',
      'restrict', 'no action'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
      AND constraint_name = 'gantt_wbs_nodes_parent_node_id_gantt_wbs_nodes_id_fk'
  ) THEN
    ALTER TABLE "gantt_wbs_nodes"
      ADD CONSTRAINT "gantt_wbs_nodes_parent_node_id_gantt_wbs_nodes_id_fk"
      FOREIGN KEY ("parent_node_id") REFERENCES "public"."gantt_wbs_nodes"("id")
      ON DELETE restrict ON UPDATE no action;
  ELSE
    PERFORM public._mig_check_fk(
      'gantt_wbs_nodes_parent_node_id_gantt_wbs_nodes_id_fk',
      'gantt_wbs_nodes', 'parent_node_id',
      'gantt_wbs_nodes', 'id',
      'restrict', 'no action'
    );
  END IF;
END $$;

--> statement-breakpoint

-- Validate/create indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_projects_admin_token_idx'
  ) THEN
    CREATE INDEX "gantt_projects_admin_token_idx" ON "gantt_projects" USING btree ("admin_token_hash");
  ELSE
    PERFORM public._mig_check_index('gantt_projects_admin_token_idx', 'gantt_projects', 'admin_token_hash', false, 'btree', NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_activities_project_idx'
  ) THEN
    CREATE INDEX "gantt_activities_project_idx" ON "gantt_activities" USING btree ("project_id");
  ELSE
    PERFORM public._mig_check_index('gantt_activities_project_idx', 'gantt_activities', 'project_id', false, 'btree', NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_activities_wbs_idx'
  ) THEN
    CREATE INDEX "gantt_activities_wbs_idx" ON "gantt_activities" USING btree ("project_id","wbs_node_id");
  ELSE
    PERFORM public._mig_check_index('gantt_activities_wbs_idx', 'gantt_activities', 'project_id,wbs_node_id', false, 'btree', NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_activities_uid_idx'
  ) THEN
    CREATE INDEX "gantt_activities_uid_idx" ON "gantt_activities" USING btree ("frontend_activity_uid");
  ELSE
    PERFORM public._mig_check_index('gantt_activities_uid_idx', 'gantt_activities', 'frontend_activity_uid', false, 'btree', NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_wbs_nodes_project_idx'
  ) THEN
    CREATE INDEX "gantt_wbs_nodes_project_idx" ON "gantt_wbs_nodes" USING btree ("project_id");
  ELSE
    PERFORM public._mig_check_index('gantt_wbs_nodes_project_idx', 'gantt_wbs_nodes', 'project_id', false, 'btree', NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_wbs_nodes_parent_idx'
  ) THEN
    CREATE INDEX "gantt_wbs_nodes_parent_idx" ON "gantt_wbs_nodes" USING btree ("project_id","parent_node_id");
  ELSE
    PERFORM public._mig_check_index('gantt_wbs_nodes_parent_idx', 'gantt_wbs_nodes', 'project_id,parent_node_id', false, 'btree', NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_wbs_nodes_sort_idx'
  ) THEN
    CREATE INDEX "gantt_wbs_nodes_sort_idx" ON "gantt_wbs_nodes" USING btree ("project_id","sort_order");
  ELSE
    PERFORM public._mig_check_index('gantt_wbs_nodes_sort_idx', 'gantt_wbs_nodes', 'project_id,sort_order', false, 'btree', NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_wbs_nodes_project_code_unique'
  ) THEN
    CREATE UNIQUE INDEX "gantt_wbs_nodes_project_code_unique" ON "gantt_wbs_nodes" USING btree ("project_id","code") WHERE "gantt_wbs_nodes"."archived_at" IS NULL;
  ELSE
    PERFORM public._mig_check_index('gantt_wbs_nodes_project_code_unique', 'gantt_wbs_nodes', 'project_id,code', true, 'btree', '"gantt_wbs_nodes"."archived_at" IS NULL');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gantt_activities_frontend_activity_uid_unique'
  ) THEN
    CREATE UNIQUE INDEX "gantt_activities_frontend_activity_uid_unique" ON "gantt_activities" USING btree ("frontend_activity_uid");
  ELSE
    PERFORM public._mig_check_index('gantt_activities_frontend_activity_uid_unique', 'gantt_activities', 'frontend_activity_uid', true, 'btree', NULL);
  END IF;
END $$;

--> statement-breakpoint

-- Drop helper functions
DROP FUNCTION IF EXISTS public._mig_normalize_default(text);
DROP FUNCTION IF EXISTS public._mig_check_column(text, text, text, text, int, text);
DROP FUNCTION IF EXISTS public._mig_check_pk(text, text);
DROP FUNCTION IF EXISTS public._mig_check_serial(text, text);
DROP FUNCTION IF EXISTS public._mig_check_fk(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public._mig_check_index(text, text, text, boolean, text, text);
