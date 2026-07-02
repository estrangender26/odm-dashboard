ALTER TABLE "presentation_files" ADD COLUMN IF NOT EXISTS "title" varchar(255);
ALTER TABLE "presentation_files" ADD COLUMN IF NOT EXISTS "version" varchar(50) DEFAULT '1.0';
ALTER TABLE "presentation_files" ADD COLUMN IF NOT EXISTS "original_file_url" text;

UPDATE "presentation_files" SET "title" = "display_name" WHERE "title" IS NULL;
UPDATE "presentation_files" SET "version" = '1.0' WHERE "version" IS NULL;
UPDATE "presentation_files" SET "original_file_url" = '/api/presentation-files/' || id || '/download' WHERE "original_file_url" IS NULL;
