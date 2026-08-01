-- Governance Deliverable Status Table
-- Canonical source for O&M Manual Governance readiness.
-- governance_uploads remains evidence only.

CREATE TABLE IF NOT EXISTS "governance_deliverable_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_slug" varchar(50) NOT NULL,
	"toc_item" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'missing' NOT NULL,
	"approved_at" timestamp,
	"approved_by" varchar(255),
	"evidence_upload_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "governance_deliverable_status_unique" UNIQUE("facility_slug","toc_item"),
	CONSTRAINT "governance_deliverable_status_status_check" CHECK ("status" IN ('approved', 'submitted', 'missing', 'not_required'))
);

--> statement-breakpoint

-- Seed all 56 facility × TOC rows for the approved 19/56 baseline.
-- AGLIPAY: 3 approved (8, 11, 12)
-- HTT: 11 approved (1,2,3,4,5,6,7,8,10,11,12)
-- EASTBAY: 4 approved (2,7,8,12)
-- KAYSAKAT: 1 approved (8)
-- Remaining 37 rows: missing

INSERT INTO "governance_deliverable_status" ("facility_slug", "toc_item", "status")
VALUES
  ('aglipay', '1', 'missing'),
  ('aglipay', '2', 'missing'),
  ('aglipay', '3', 'missing'),
  ('aglipay', '4', 'missing'),
  ('aglipay', '5', 'missing'),
  ('aglipay', '6', 'missing'),
  ('aglipay', '7', 'missing'),
  ('aglipay', '8', 'approved'),
  ('aglipay', '9', 'missing'),
  ('aglipay', '10', 'missing'),
  ('aglipay', '11', 'approved'),
  ('aglipay', '12', 'approved'),
  ('aglipay', '13', 'missing'),
  ('aglipay', '14', 'missing'),
  ('htt', '1', 'approved'),
  ('htt', '2', 'approved'),
  ('htt', '3', 'approved'),
  ('htt', '4', 'approved'),
  ('htt', '5', 'approved'),
  ('htt', '6', 'approved'),
  ('htt', '7', 'approved'),
  ('htt', '8', 'approved'),
  ('htt', '9', 'missing'),
  ('htt', '10', 'approved'),
  ('htt', '11', 'approved'),
  ('htt', '12', 'approved'),
  ('htt', '13', 'missing'),
  ('htt', '14', 'missing'),
  ('eastbay', '1', 'missing'),
  ('eastbay', '2', 'approved'),
  ('eastbay', '3', 'missing'),
  ('eastbay', '4', 'missing'),
  ('eastbay', '5', 'missing'),
  ('eastbay', '6', 'missing'),
  ('eastbay', '7', 'approved'),
  ('eastbay', '8', 'approved'),
  ('eastbay', '9', 'missing'),
  ('eastbay', '10', 'missing'),
  ('eastbay', '11', 'missing'),
  ('eastbay', '12', 'approved'),
  ('eastbay', '13', 'missing'),
  ('eastbay', '14', 'missing'),
  ('kaysakat', '1', 'missing'),
  ('kaysakat', '2', 'missing'),
  ('kaysakat', '3', 'missing'),
  ('kaysakat', '4', 'missing'),
  ('kaysakat', '5', 'missing'),
  ('kaysakat', '6', 'missing'),
  ('kaysakat', '7', 'missing'),
  ('kaysakat', '8', 'approved'),
  ('kaysakat', '9', 'missing'),
  ('kaysakat', '10', 'missing'),
  ('kaysakat', '11', 'missing'),
  ('kaysakat', '12', 'missing'),
  ('kaysakat', '13', 'missing'),
  ('kaysakat', '14', 'missing')
ON CONFLICT ("facility_slug", "toc_item") DO NOTHING;
