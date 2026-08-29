-- Migration 0033: SMP controlled-document repository.
--
-- Converts the SMP module from a flat demo-style document table into a
-- controlled engineering-document repository:
--   * reference number is the document-series identity
--   * revisions are immutable rows in smp_document_revisions (never overwritten)
--   * controlled-document metadata columns on smp_documents
--   * data-driven family catalog (7 approved Manila Water families seeded)
--   * flexible structured sections / tasks / applicability tags
--
-- Strictly additive: nothing is dropped, renamed, or truncated. Existing
-- smp_documents rows (and the legacy storage migrator's file_data dependency)
-- remain fully intact.

-- ── 1. Base table (fresh installs; existing environments already have it) ──
CREATE TABLE IF NOT EXISTS "smp_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" varchar(50) NOT NULL,
  "title" varchar(500) NOT NULL,
  "revision" varchar(50) DEFAULT 'Rev. 1',
  "equipment_type" varchar(100),
  "system" varchar(100),
  "date_issued" varchar(20),
  "next_review" varchar(20),
  "status" varchar(50) DEFAULT 'Active',
  "responsible_party" varchar(255),
  "file_data" text,
  "file_type" varchar(100),
  "file_name" varchar(255),
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "storage_provider" varchar(32),
  "storage_bucket" varchar(100),
  "storage_path" text,
  "storage_size" bigint,
  "storage_mime_type" varchar(255),
  "storage_etag" text,
  "storage_uploaded_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "smp_equip_idx" ON "smp_documents" ("equipment_type");
CREATE INDEX IF NOT EXISTS "smp_system_idx" ON "smp_documents" ("system");
CREATE INDEX IF NOT EXISTS "smp_status_idx" ON "smp_documents" ("status");

-- ── 2. Controlled-document metadata columns (additive) ──
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "smp_id" varchar(100);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "smp_family" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "asset_name" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "asset_type" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "facility_type" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "applicability" jsonb;
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "criticality" varchar(20);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "document_owner" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "prepared_by" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "reviewed_by" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "approved_by" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "effectivity_date" date;
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "uploaded_by" varchar(255);
ALTER TABLE "smp_documents" ADD COLUMN IF NOT EXISTS "uploaded_at" timestamptz;

CREATE INDEX IF NOT EXISTS "smp_family_idx" ON "smp_documents" ("smp_family");
CREATE INDEX IF NOT EXISTS "smp_facility_type_idx" ON "smp_documents" ("facility_type");
CREATE INDEX IF NOT EXISTS "smp_criticality_idx" ON "smp_documents" ("criticality");

-- ── 3. Revisions (immutable revision history) ──
CREATE TABLE IF NOT EXISTS "smp_document_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL REFERENCES "smp_documents"("id") ON DELETE CASCADE,
  "revision" varchar(50) NOT NULL,
  "revision_number" integer NOT NULL DEFAULT 0,
  "status" varchar(32) NOT NULL DEFAULT 'current',
  "effectivity_date" date,
  "superseded_by_revision_id" integer REFERENCES "smp_document_revisions"("id") ON DELETE SET NULL,
  "original_file_name" varchar(255),
  "file_type" varchar(100),
  "file_size" bigint,
  "uploaded_by" varchar(255),
  "uploaded_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "storage_provider" varchar(32),
  "storage_bucket" varchar(100),
  "storage_path" text,
  "storage_size" bigint,
  "storage_mime_type" varchar(255),
  "storage_etag" text,
  "storage_uploaded_at" timestamptz,
  CONSTRAINT "smp_document_revisions_document_revision_unique" UNIQUE("document_id", "revision")
);

CREATE INDEX IF NOT EXISTS "smp_document_revisions_document_idx"
  ON "smp_document_revisions" ("document_id");
CREATE INDEX IF NOT EXISTS "smp_document_revisions_status_idx"
  ON "smp_document_revisions" ("document_id", "status");

-- ── 4. Family catalog (data-driven; the seven approved families seeded) ──
CREATE TABLE IF NOT EXISTS "smp_families" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "code" varchar(100),
  "typical_equipment" jsonb,
  "suggested_tags" jsonb,
  "sort_order" integer NOT NULL DEFAULT 0,
  CONSTRAINT "smp_families_name_unique" UNIQUE("name"),
  CONSTRAINT "smp_families_code_unique" UNIQUE("code")
);

INSERT INTO "smp_families" ("name", "code", "typical_equipment", "suggested_tags", "sort_order") VALUES
  ('Centrifugal Pump System', 'centrifugal-pump-system',
   '["end-suction pumps","split-case pumps","vertical pumps","vertical turbine pumps","submersible pumps"]',
   '["All","Volute","Vertical","Submersible"]', 1),
  ('Blower System', 'blower-system',
   '["lobe blowers","screw blowers","turbo blowers"]',
   '["All","Belt","Screw","Turbo","Screw Blower"]', 2),
  ('Primary Power Substation', 'primary-power-substation',
   '["MV switchgear","LV switchgear","power transformers","load break switches","reclosers","overhead lines/poles"]',
   '["All","MV","LV"]', 3),
  ('Electric Motor', 'electric-motor',
   '["LV motors","MV motors","VFD-driven motors","grease-lubricated motors","oil-lubricated motors"]',
   '["All","MV","LV","VFD-driven","Grease","Oil"]', 4),
  ('Dewatering System', 'dewatering-system',
   '["belt press","filter press","screw press","volute press","decanter centrifuge"]',
   '["All","Belt","Filter","Screw","Volute","Decanter"]', 5),
  ('Automation Systems', 'automation-systems',
   '["PLC","I/O","HMI","SCADA","OT/network components","UPS","pneumatic systems","control panels"]',
   '["All","PLC","SCADA","UPS","Pneumatic"]', 6),
  ('Secondary Power – Generator Set', 'secondary-power-generator-set',
   '["diesel engine","alternator","controls","ATS","starting system","cooling system","lubrication system"]',
   '["All","Diesel","ATS","Pneumatic"]', 7)
ON CONFLICT ("name") DO NOTHING;

-- ── 5. Structured sections ──
CREATE TABLE IF NOT EXISTS "smp_sections" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL REFERENCES "smp_documents"("id") ON DELETE CASCADE,
  "section_key" varchar(64) NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "smp_sections_document_idx" ON "smp_sections" ("document_id");

-- ── 6. Structured tasks ──
CREATE TABLE IF NOT EXISTS "smp_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL REFERENCES "smp_documents"("id") ON DELETE CASCADE,
  "revision_id" integer REFERENCES "smp_document_revisions"("id") ON DELETE SET NULL,
  "category" varchar(32) NOT NULL,
  "responsibility_type" varchar(32),
  "maintenance_class" varchar(32),
  "task_text" text NOT NULL,
  "frequency" varchar(100),
  "tools_materials" text,
  "safety_controls" text,
  "field_capture_data" jsonb,
  "escalation_trigger" text,
  "failure_mode" text,
  "display_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "smp_tasks_document_idx" ON "smp_tasks" ("document_id");
CREATE INDEX IF NOT EXISTS "smp_tasks_category_idx" ON "smp_tasks" ("document_id", "category");

-- ── 7. Task applicability tags (flexible subtype model) ──
CREATE TABLE IF NOT EXISTS "smp_task_applicability" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "smp_tasks"("id") ON DELETE CASCADE,
  "tag" varchar(100) NOT NULL
);

CREATE INDEX IF NOT EXISTS "smp_task_applicability_task_idx" ON "smp_task_applicability" ("task_id");
CREATE INDEX IF NOT EXISTS "smp_task_applicability_tag_idx" ON "smp_task_applicability" ("tag");

-- ── 8. RLS posture for the new tables (backend postgres role has BYPASSRLS) ──
ALTER TABLE public.smp_document_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smp_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smp_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smp_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smp_task_applicability ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.smp_document_revisions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.smp_families FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.smp_sections FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.smp_tasks FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.smp_task_applicability FROM anon, authenticated;
