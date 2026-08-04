-- Lihok Corporate Library — database foundation
-- Additive migration; no existing tables are altered or deleted.

CREATE TABLE IF NOT EXISTS "lihok_corporate_document_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "lihok_corporate_document_categories_code_unique" UNIQUE("code")
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lihok_corporate_document_categories_sort_idx"
	ON "lihok_corporate_document_categories" ("sort_order");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lihok_corporate_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_number" varchar(50) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"category_id" integer NOT NULL,
	"default_classification" varchar(20) DEFAULT 'internal' NOT NULL,
	"owner_name" varchar(255),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"archived_at" timestamp,
	CONSTRAINT "lihok_corporate_documents_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "lihok_corporate_documents_classification_check" CHECK ("default_classification" IN ('public', 'internal', 'confidential', 'restricted')),
	CONSTRAINT "lihok_doc_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."lihok_corporate_document_categories"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "lihok_doc_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "lihok_doc_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lihok_corporate_documents_category_idx"
	ON "lihok_corporate_documents" ("category_id");
CREATE INDEX IF NOT EXISTS "lihok_corporate_documents_classification_idx"
	ON "lihok_corporate_documents" ("default_classification");
CREATE INDEX IF NOT EXISTS "lihok_corporate_documents_owner_idx"
	ON "lihok_corporate_documents" ("owner_name");
CREATE INDEX IF NOT EXISTS "lihok_corporate_documents_archived_at_idx"
	ON "lihok_corporate_documents" ("archived_at");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lihok_corporate_document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"version_number" varchar(20) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"classification" varchar(20) DEFAULT 'internal' NOT NULL,
	"owner_name" varchar(255),
	"effective_date" date,
	"change_notes" text,
	"file_name" varchar(255),
	"file_size" bigint,
	"mime_type" varchar(255),
	"file_hash" varchar(64),
	"storage_provider" varchar(32),
	"storage_bucket" varchar(100),
	"storage_path" text,
	"storage_etag" text,
	"storage_uploaded_at" timestamptz,
	"uploaded_by" integer,
	"reviewed_by" integer,
	"reviewed_at" timestamptz,
	"approved_by" integer,
	"approved_at" timestamptz,
	"superseded_by_version_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "lihok_corporate_document_versions_unique" UNIQUE("document_id","version_number"),
	CONSTRAINT "lihok_corporate_document_versions_status_check" CHECK ("status" IN ('draft', 'for_review', 'approved', 'superseded', 'archived')),
	CONSTRAINT "lihok_corporate_document_versions_classification_check" CHECK ("classification" IN ('public', 'internal', 'confidential', 'restricted')),
	CONSTRAINT "lihok_corporate_document_versions_hash_check" CHECK ("file_hash" IS NULL OR "file_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "lihok_corporate_document_versions_no_self_supersede_check" CHECK ("superseded_by_version_id" IS NULL OR "superseded_by_version_id" <> "id"),
	CONSTRAINT "lihok_ver_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."lihok_corporate_documents"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "lihok_ver_uploaded_by_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "lihok_ver_reviewed_by_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "lihok_ver_approved_by_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "lihok_ver_superseded_fk" FOREIGN KEY ("superseded_by_version_id") REFERENCES "public"."lihok_corporate_document_versions"("id") ON DELETE set null ON UPDATE no action
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "lihok_corporate_document_versions_storage_unique"
	ON "lihok_corporate_document_versions" ("storage_bucket", "storage_path") WHERE "storage_path" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_versions_document_idx"
	ON "lihok_corporate_document_versions" ("document_id");
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_versions_status_idx"
	ON "lihok_corporate_document_versions" ("status");
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_versions_classification_idx"
	ON "lihok_corporate_document_versions" ("classification");
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_versions_owner_idx"
	ON "lihok_corporate_document_versions" ("owner_name");
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_versions_superseded_idx"
	ON "lihok_corporate_document_versions" ("superseded_by_version_id");
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_versions_effective_date_idx"
	ON "lihok_corporate_document_versions" ("effective_date");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lihok_corporate_document_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"version_id" integer,
	"action" varchar(50) NOT NULL,
	"actor_user_id" integer,
	"actor_name" varchar(255),
	"old_value" jsonb,
	"new_value" jsonb,
	"request_id" varchar(100),
	"created_at" timestamptz DEFAULT now(),
	CONSTRAINT "lihok_aud_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."lihok_corporate_documents"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "lihok_aud_version_fk" FOREIGN KEY ("version_id") REFERENCES "public"."lihok_corporate_document_versions"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "lihok_aud_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lihok_corporate_document_audit_document_idx"
	ON "lihok_corporate_document_audit" ("document_id");
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_audit_version_idx"
	ON "lihok_corporate_document_audit" ("version_id");
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_audit_action_idx"
	ON "lihok_corporate_document_audit" ("action");
CREATE INDEX IF NOT EXISTS "lihok_corporate_document_audit_created_at_idx"
	ON "lihok_corporate_document_audit" ("created_at");

--> statement-breakpoint

-- Seed the fixed 16 Lihok Corporate Library document categories.
INSERT INTO "lihok_corporate_document_categories" ("code", "name", "sort_order")
VALUES
  ('01', 'Corporate Foundation', 10),
  ('02', 'Legal & Compliance', 20),
  ('03', 'Governance', 30),
  ('04', 'Finance & Accounting', 40),
  ('05', 'Human Resources', 50),
  ('06', 'Brand & Marketing', 60),
  ('07', 'Sales & Business Development', 70),
  ('08', 'Technology Strategy', 80),
  ('09', 'Product Management', 90),
  ('10', 'Software Engineering', 100),
  ('11', 'AI Governance', 110),
  ('12', 'Cybersecurity', 120),
  ('13', 'Operations', 130),
  ('14', 'Quality & Risk', 140),
  ('15', 'Research & Innovation', 150),
  ('16', 'Templates & Controlled Forms', 160)
ON CONFLICT ("code") DO NOTHING;
