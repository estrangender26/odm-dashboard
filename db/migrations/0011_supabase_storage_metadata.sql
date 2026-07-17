-- Additive dual-storage metadata for ODM document modules.
-- Existing base64/database content is not rewritten or deleted.

ALTER TABLE IF EXISTS "doc_files"
  ADD COLUMN IF NOT EXISTS "storage_provider" varchar(32),
  ADD COLUMN IF NOT EXISTS "storage_bucket" varchar(100),
  ADD COLUMN IF NOT EXISTS "storage_path" text,
  ADD COLUMN IF NOT EXISTS "storage_size" bigint,
  ADD COLUMN IF NOT EXISTS "storage_mime_type" varchar(255),
  ADD COLUMN IF NOT EXISTS "storage_etag" text,
  ADD COLUMN IF NOT EXISTS "storage_uploaded_at" timestamptz;

ALTER TABLE IF EXISTS "governance_uploads"
  ADD COLUMN IF NOT EXISTS "storage_provider" varchar(32),
  ADD COLUMN IF NOT EXISTS "storage_bucket" varchar(100),
  ADD COLUMN IF NOT EXISTS "storage_path" text,
  ADD COLUMN IF NOT EXISTS "storage_size" bigint,
  ADD COLUMN IF NOT EXISTS "storage_mime_type" varchar(255),
  ADD COLUMN IF NOT EXISTS "storage_etag" text,
  ADD COLUMN IF NOT EXISTS "storage_uploaded_at" timestamptz;

ALTER TABLE IF EXISTS "governance_files"
  ADD COLUMN IF NOT EXISTS "storage_provider" varchar(32),
  ADD COLUMN IF NOT EXISTS "storage_bucket" varchar(100),
  ADD COLUMN IF NOT EXISTS "storage_path" text,
  ADD COLUMN IF NOT EXISTS "storage_size" bigint,
  ADD COLUMN IF NOT EXISTS "storage_mime_type" varchar(255),
  ADD COLUMN IF NOT EXISTS "storage_etag" text,
  ADD COLUMN IF NOT EXISTS "storage_uploaded_at" timestamptz;

ALTER TABLE IF EXISTS "smp_documents"
  ADD COLUMN IF NOT EXISTS "storage_provider" varchar(32),
  ADD COLUMN IF NOT EXISTS "storage_bucket" varchar(100),
  ADD COLUMN IF NOT EXISTS "storage_path" text,
  ADD COLUMN IF NOT EXISTS "storage_size" bigint,
  ADD COLUMN IF NOT EXISTS "storage_mime_type" varchar(255),
  ADD COLUMN IF NOT EXISTS "storage_etag" text,
  ADD COLUMN IF NOT EXISTS "storage_uploaded_at" timestamptz;

CREATE TABLE IF NOT EXISTS "storage_upload_intents" (
  "id" uuid PRIMARY KEY,
  "module" varchar(32) NOT NULL,
  "target_context" jsonb NOT NULL,
  "expected_bucket" varchar(100) NOT NULL,
  "expected_path" text NOT NULL,
  "original_filename" varchar(255) NOT NULL,
  "expected_size" bigint NOT NULL,
  "expected_mime_type" varchar(255) NOT NULL,
  "requested_by" integer NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "expires_at" timestamptz NOT NULL,
  "finalized_at" timestamptz,
  "abandoned_at" timestamptz,
  "cleanup_at" timestamptz,
  "failure_reason" text,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "storage_upload_intents_bucket_path_unique" UNIQUE("expected_bucket", "expected_path")
);

CREATE INDEX IF NOT EXISTS "storage_upload_intents_status_expiry_idx"
  ON "storage_upload_intents" ("status", "expires_at");
CREATE INDEX IF NOT EXISTS "storage_upload_intents_user_idx"
  ON "storage_upload_intents" ("requested_by");

CREATE UNIQUE INDEX IF NOT EXISTS "doc_files_storage_object_unique"
  ON "doc_files" ("storage_bucket", "storage_path") WHERE "storage_path" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "governance_uploads_storage_object_unique"
  ON "governance_uploads" ("storage_bucket", "storage_path") WHERE "storage_path" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "governance_files_storage_object_unique"
  ON "governance_files" ("storage_bucket", "storage_path") WHERE "storage_path" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "smp_documents_storage_object_unique"
  ON "smp_documents" ("storage_bucket", "storage_path") WHERE "storage_path" IS NOT NULL;
