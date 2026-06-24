CREATE TABLE IF NOT EXISTS "presentation_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"file_type" varchar(100) NOT NULL,
	"mime_type" varchar(100) NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	"file_size_bytes" integer NOT NULL,
	"file_blob" text NOT NULL,
	"sha256_hash" varchar(64) NOT NULL,
	"file_category" varchar(50) NOT NULL,
	"generator_id" varchar(100),
	"generator_name" varchar(255),
	"template" varchar(100),
	"scope_json" text,
	"uploaded_by" varchar(255) NOT NULL DEFAULT 'ODM User',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_files_category_idx" ON "presentation_files" ("file_category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_files_generator_idx" ON "presentation_files" ("generator_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_files_hash_idx" ON "presentation_files" ("sha256_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_files_deleted_at_idx" ON "presentation_files" ("deleted_at");
