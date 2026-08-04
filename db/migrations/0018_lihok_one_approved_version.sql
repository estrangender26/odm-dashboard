-- Lihok Corporate Library — enforce one approved version per document
-- Additive migration; no existing tables, columns or data are altered destructively.

CREATE UNIQUE INDEX IF NOT EXISTS "lihok_corporate_document_versions_approved_unique"
	ON "lihok_corporate_document_versions" ("document_id")
	WHERE "status" = 'approved';

--> statement-breakpoint
