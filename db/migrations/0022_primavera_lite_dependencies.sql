-- Migration 0022: normalized Primavera Lite activity dependencies.
-- Additive, idempotent, drift-detecting, and isolated from legacy gantt_dependencies.

DO $$
DECLARE
  v_exists boolean;
  v_column record;
  v_expected text[][] := ARRAY[
    ['id','integer','NO','',''], ['project_id','integer','NO','',''],
    ['predecessor_activity_id','integer','NO','',''], ['successor_activity_id','integer','NO','',''],
    ['dependency_type','character varying','NO','10','FS'], ['lag_days','integer','NO','','0'],
    ['revision','integer','NO','','1'], ['updated_by_name','character varying','YES','255',''],
    ['archived_at','timestamp with time zone','YES','',''], ['created_at','timestamp with time zone','YES','','now'],
    ['updated_at','timestamp with time zone','YES','','now']
  ];
  v_item text[];
  v_pk text;
  v_count integer;
  v_definition text;
  v_constraint text;
BEGIN
  SELECT to_regclass('public.gantt_activity_dependencies') IS NOT NULL INTO v_exists;
  IF NOT v_exists THEN
    CREATE TABLE public.gantt_activity_dependencies (
      id serial PRIMARY KEY NOT NULL,
      project_id integer NOT NULL,
      predecessor_activity_id integer NOT NULL,
      successor_activity_id integer NOT NULL,
      dependency_type varchar(10) DEFAULT 'FS' NOT NULL,
      lag_days integer DEFAULT 0 NOT NULL,
      revision integer DEFAULT 1 NOT NULL,
      updated_by_name varchar(255),
      archived_at timestamp with time zone,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT gantt_activity_dependencies_project_fk FOREIGN KEY (project_id) REFERENCES public.gantt_projects(id) ON DELETE RESTRICT,
      CONSTRAINT gantt_activity_dependencies_predecessor_fk FOREIGN KEY (predecessor_activity_id) REFERENCES public.gantt_activities(id) ON DELETE RESTRICT,
      CONSTRAINT gantt_activity_dependencies_successor_fk FOREIGN KEY (successor_activity_id) REFERENCES public.gantt_activities(id) ON DELETE RESTRICT,
      CONSTRAINT gantt_activity_dependencies_type_check CHECK (dependency_type IN ('FS','SS','FF','SF')),
      CONSTRAINT gantt_activity_dependencies_no_self_check CHECK (predecessor_activity_id <> successor_activity_id)
    );
  END IF;

  FOREACH v_item SLICE 1 IN ARRAY v_expected LOOP
    SELECT data_type, is_nullable, character_maximum_length, column_default INTO v_column
    FROM information_schema.columns WHERE table_schema='public' AND table_name='gantt_activity_dependencies' AND column_name=v_item[1];
    IF NOT FOUND THEN RAISE EXCEPTION 'gantt_activity_dependencies column drift: missing %', v_item[1]; END IF;
    IF v_column.data_type <> v_item[2] OR v_column.is_nullable <> v_item[3] OR
       (v_item[4] <> '' AND v_column.character_maximum_length::text <> v_item[4]) THEN
      RAISE EXCEPTION 'gantt_activity_dependencies column drift at %: expected % % length %, found % % length %',
        v_item[1], v_item[2], v_item[3], nullif(v_item[4],''), v_column.data_type, v_column.is_nullable, v_column.character_maximum_length;
    END IF;
    IF v_item[5] <> '' AND lower(coalesce(v_column.column_default,'')) NOT LIKE '%' || lower(v_item[5]) || '%' THEN
      RAISE EXCEPTION 'gantt_activity_dependencies default drift at %: expected %, found %', v_item[1], v_item[5], v_column.column_default;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='gantt_activity_dependencies') <> array_length(v_expected,1) THEN
    RAISE EXCEPTION 'gantt_activity_dependencies column drift: unexpected extra columns';
  END IF;
  IF pg_get_serial_sequence('public.gantt_activity_dependencies','id') IS NULL THEN
    RAISE EXCEPTION 'gantt_activity_dependencies.id drift: expected owned serial sequence';
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY array_position(c.conkey,a.attnum)) INTO v_pk
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
  WHERE c.conrelid='public.gantt_activity_dependencies'::regclass AND c.contype='p';
  IF v_pk IS DISTINCT FROM 'id' THEN RAISE EXCEPTION 'gantt_activity_dependencies PK drift: expected id, found %', v_pk; END IF;

  SELECT count(*) INTO v_count FROM pg_constraint c
  WHERE c.conrelid='public.gantt_activity_dependencies'::regclass AND c.contype='f'
    AND ((c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='project_id')]::smallint[] AND c.confrelid='public.gantt_projects'::regclass)
      OR (c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='predecessor_activity_id')]::smallint[] AND c.confrelid='public.gantt_activities'::regclass)
      OR (c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='successor_activity_id')]::smallint[] AND c.confrelid='public.gantt_activities'::regclass))
    AND c.confdeltype='r' AND c.confupdtype='a';
  IF v_count <> 3 THEN RAISE EXCEPTION 'gantt_activity_dependencies FK/delete-rule drift: expected 3 canonical RESTRICT foreign keys, found %', v_count; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.gantt_activity_dependencies'::regclass AND contype='f') <> 3 THEN
    RAISE EXCEPTION 'gantt_activity_dependencies FK drift: unexpected foreign keys';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_constraint FROM pg_constraint WHERE conrelid='public.gantt_activity_dependencies'::regclass AND conname='gantt_activity_dependencies_type_check' AND contype='c';
  IF v_constraint IS NULL OR regexp_replace(lower(v_constraint),'["[:space:]()]','','g') NOT LIKE '%dependency_type%fs%ss%ff%sf%' THEN
    RAISE EXCEPTION 'gantt_activity_dependencies dependency-type constraint drift: %', coalesce(v_constraint,'missing');
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_constraint FROM pg_constraint WHERE conrelid='public.gantt_activity_dependencies'::regclass AND conname='gantt_activity_dependencies_no_self_check' AND contype='c';
  IF v_constraint IS NULL OR regexp_replace(lower(v_constraint),'["[:space:]()]','','g') NOT LIKE '%predecessor_activity_id<>successor_activity_id%' THEN
    RAISE EXCEPTION 'gantt_activity_dependencies no-self constraint drift: %', coalesce(v_constraint,'missing');
  END IF;

  IF to_regclass('public.gantt_activity_dependencies_project_idx') IS NULL THEN CREATE INDEX gantt_activity_dependencies_project_idx ON public.gantt_activity_dependencies USING btree(project_id); END IF;
  IF to_regclass('public.gantt_activity_dependencies_pred_idx') IS NULL THEN CREATE INDEX gantt_activity_dependencies_pred_idx ON public.gantt_activity_dependencies USING btree(project_id,predecessor_activity_id); END IF;
  IF to_regclass('public.gantt_activity_dependencies_succ_idx') IS NULL THEN CREATE INDEX gantt_activity_dependencies_succ_idx ON public.gantt_activity_dependencies USING btree(project_id,successor_activity_id); END IF;
  IF to_regclass('public.gantt_activity_dependencies_active_unique') IS NULL THEN CREATE UNIQUE INDEX gantt_activity_dependencies_active_unique ON public.gantt_activity_dependencies USING btree(project_id,predecessor_activity_id,successor_activity_id,dependency_type) WHERE archived_at IS NULL; END IF;

  FOR v_item IN SELECT ARRAY[indexname::text, regexp_replace(lower(indexdef),'["[:space:]]','','g')::text] FROM pg_indexes WHERE schemaname='public' AND indexname IN ('gantt_activity_dependencies_project_idx','gantt_activity_dependencies_pred_idx','gantt_activity_dependencies_succ_idx','gantt_activity_dependencies_active_unique') LOOP
    v_definition := v_item[2];
    IF (v_item[1]='gantt_activity_dependencies_project_idx' AND v_definition NOT LIKE '%usingbtree(project_id)%') OR
       (v_item[1]='gantt_activity_dependencies_pred_idx' AND v_definition NOT LIKE '%usingbtree(project_id,predecessor_activity_id)%') OR
       (v_item[1]='gantt_activity_dependencies_succ_idx' AND v_definition NOT LIKE '%usingbtree(project_id,successor_activity_id)%') OR
       (v_item[1]='gantt_activity_dependencies_active_unique' AND (v_definition NOT LIKE 'createuniqueindex%usingbtree(project_id,predecessor_activity_id,successor_activity_id,dependency_type)%' OR v_definition NOT LIKE '%where(archived_atisnull)')) THEN
      RAISE EXCEPTION 'gantt_activity_dependencies index drift at %: %', v_item[1], v_definition;
    END IF;
  END LOOP;
END $$;
