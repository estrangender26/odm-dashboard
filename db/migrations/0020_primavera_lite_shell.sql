-- Migration 0020_primavera_lite_shell
-- Idempotent, drift-detecting, data-preserving.
-- Safe to re-run on a database where these objects were manually created.
-- Each existing object is validated against the canonical definition below.
-- On conflict the migration raises a clear error and rolls back.

DO $$
DECLARE
  col_type text;
  col_nullable text;
  col_varchar_max int;
BEGIN
  -- gantt_projects.admin_token_hash
  SELECT data_type, is_nullable, character_maximum_length
  INTO col_type, col_nullable, col_varchar_max
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'gantt_projects'
    AND column_name = 'admin_token_hash';

  IF col_type IS NULL THEN
    ALTER TABLE "gantt_projects" ADD COLUMN "admin_token_hash" varchar(64);
  ELSE
    IF col_type != 'character varying' OR col_nullable != 'YES' OR col_varchar_max != 64 THEN
      RAISE EXCEPTION 'gantt_projects.admin_token_hash conflict: type=%, nullable=%, max_length=%', col_type, col_nullable, col_varchar_max;
    END IF;
  END IF;

  -- gantt_projects.archived_at
  SELECT data_type, is_nullable
  INTO col_type, col_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'gantt_projects'
    AND column_name = 'archived_at';

  IF col_type IS NULL THEN
    ALTER TABLE "gantt_projects" ADD COLUMN "archived_at" timestamp with time zone;
  ELSE
    IF col_type != 'timestamp with time zone' OR col_nullable != 'YES' THEN
      RAISE EXCEPTION 'gantt_projects.archived_at conflict: type=%, nullable=%', col_type, col_nullable;
    END IF;
  END IF;
END $$;

--> statement-breakpoint

DO $$
DECLARE
  tbl regclass;
BEGIN
  SELECT to_regclass('public.gantt_wbs_nodes') INTO tbl;

  IF tbl IS NULL THEN
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
    -- Validate required columns exist with correct types/nullability
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'id' AND data_type = 'integer' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.id conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'project_id' AND data_type = 'integer' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.project_id conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'parent_node_id' AND data_type = 'integer' AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.parent_node_id conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'code' AND data_type = 'character varying' AND is_nullable = 'NO' AND character_maximum_length = 100
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.code conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'name' AND data_type = 'character varying' AND is_nullable = 'NO' AND character_maximum_length = 500
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.name conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'sort_order' AND data_type = 'integer' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.sort_order conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'is_leaf' AND data_type = 'boolean' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.is_leaf conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'archived_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.archived_at conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'created_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.created_at conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
        AND column_name = 'updated_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'gantt_wbs_nodes.updated_at conflict or missing';
    END IF;
  END IF;
END $$;

--> statement-breakpoint

DO $$
DECLARE
  tbl regclass;
BEGIN
  SELECT to_regclass('public.gantt_activities') INTO tbl;

  IF tbl IS NULL THEN
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
      "updated_at" timestamp with time zone DEFAULT now()
    );
  ELSE
    -- Validate a representative set of critical columns
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_activities'
        AND column_name = 'id' AND data_type = 'integer' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'gantt_activities.id conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_activities'
        AND column_name = 'project_id' AND data_type = 'integer' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'gantt_activities.project_id conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_activities'
        AND column_name = 'wbs_node_id' AND data_type = 'integer' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'gantt_activities.wbs_node_id conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_activities'
        AND column_name = 'frontend_activity_uid' AND data_type = 'character varying' AND is_nullable = 'YES' AND character_maximum_length = 64
    ) THEN
      RAISE EXCEPTION 'gantt_activities.frontend_activity_uid conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_activities'
        AND column_name = 'activity_name' AND data_type = 'character varying' AND is_nullable = 'NO' AND character_maximum_length = 500
    ) THEN
      RAISE EXCEPTION 'gantt_activities.activity_name conflict or missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_activities'
        AND column_name = 'revision' AND data_type = 'integer' AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'gantt_activities.revision conflict or missing';
    END IF;
  END IF;
END $$;

--> statement-breakpoint

DO $$
DECLARE
  fk_rule text;
BEGIN
  -- gantt_activities.project_id -> gantt_projects.id ON DELETE RESTRICT
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
    SELECT rc.delete_rule INTO fk_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'gantt_activities'
      AND tc.constraint_name = 'gantt_activities_project_id_gantt_projects_id_fk';
    IF fk_rule != 'RESTRICT' THEN
      RAISE EXCEPTION 'gantt_activities_project_id_gantt_projects_id_fk delete_rule conflict: %', fk_rule;
    END IF;
  END IF;

  -- gantt_activities.wbs_node_id -> gantt_wbs_nodes.id ON DELETE RESTRICT
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
    SELECT rc.delete_rule INTO fk_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'gantt_activities'
      AND tc.constraint_name = 'gantt_activities_wbs_node_id_gantt_wbs_nodes_id_fk';
    IF fk_rule != 'RESTRICT' THEN
      RAISE EXCEPTION 'gantt_activities_wbs_node_id_gantt_wbs_nodes_id_fk delete_rule conflict: %', fk_rule;
    END IF;
  END IF;
END $$;

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'gantt_activities'
      AND constraint_name = 'gantt_activities_calendar_id_gantt_calendars_id_fk'
  ) THEN
    ALTER TABLE "gantt_activities"
      ADD CONSTRAINT "gantt_activities_calendar_id_gantt_calendars_id_fk"
      FOREIGN KEY ("calendar_id") REFERENCES "public"."gantt_calendars"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
      AND constraint_name = 'gantt_wbs_nodes_project_id_gantt_projects_id_fk'
  ) THEN
    ALTER TABLE "gantt_wbs_nodes"
      ADD CONSTRAINT "gantt_wbs_nodes_project_id_gantt_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."gantt_projects"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes'
      AND constraint_name = 'gantt_wbs_nodes_parent_node_id_gantt_wbs_nodes_id_fk'
  ) THEN
    ALTER TABLE "gantt_wbs_nodes"
      ADD CONSTRAINT "gantt_wbs_nodes_parent_node_id_gantt_wbs_nodes_id_fk"
      FOREIGN KEY ("parent_node_id") REFERENCES "public"."gantt_wbs_nodes"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_projects_admin_token_idx'
  ) THEN
    CREATE INDEX "gantt_projects_admin_token_idx" ON "gantt_projects" USING btree ("admin_token_hash");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_activities_project_idx'
  ) THEN
    CREATE INDEX "gantt_activities_project_idx" ON "gantt_activities" USING btree ("project_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_activities_wbs_idx'
  ) THEN
    CREATE INDEX "gantt_activities_wbs_idx" ON "gantt_activities" USING btree ("project_id","wbs_node_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_activities_uid_idx'
  ) THEN
    CREATE INDEX "gantt_activities_uid_idx" ON "gantt_activities" USING btree ("frontend_activity_uid");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_wbs_nodes_project_idx'
  ) THEN
    CREATE INDEX "gantt_wbs_nodes_project_idx" ON "gantt_wbs_nodes" USING btree ("project_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_wbs_nodes_parent_idx'
  ) THEN
    CREATE INDEX "gantt_wbs_nodes_parent_idx" ON "gantt_wbs_nodes" USING btree ("project_id","parent_node_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_wbs_nodes_sort_idx'
  ) THEN
    CREATE INDEX "gantt_wbs_nodes_sort_idx" ON "gantt_wbs_nodes" USING btree ("project_id","sort_order");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_wbs_nodes_project_code_unique'
  ) THEN
    CREATE UNIQUE INDEX "gantt_wbs_nodes_project_code_unique" ON "gantt_wbs_nodes" USING btree ("project_id","code") WHERE "gantt_wbs_nodes"."archived_at" IS NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'gantt_activities_frontend_activity_uid_unique'
  ) THEN
    CREATE UNIQUE INDEX "gantt_activities_frontend_activity_uid_unique" ON "gantt_activities" USING btree ("frontend_activity_uid");
  END IF;
END $$;
