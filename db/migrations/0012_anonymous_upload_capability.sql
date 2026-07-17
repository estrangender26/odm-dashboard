-- Anonymous upload capability support
-- Adds capability tokens and rate limiting for anonymous uploads

-- Allow anonymous intents (requested_by becomes nullable)
ALTER TABLE "storage_upload_intents" 
  ALTER COLUMN "requested_by" DROP NOT NULL;

-- Add capability token columns
ALTER TABLE "storage_upload_intents"
  ADD COLUMN IF NOT EXISTS "capability_jti" uuid NULL,
  ADD COLUMN IF NOT EXISTS "capability_token_hash" varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS "capability_expires_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "capability_consumed_at" timestamptz NULL;

-- Unique constraint on JTI to prevent replay
CREATE UNIQUE INDEX IF NOT EXISTS "storage_upload_intents_jti_idx" 
  ON "storage_upload_intents" ("capability_jti") 
  WHERE "capability_jti" IS NOT NULL;

-- Rate limiting table with bytes tracking
CREATE TABLE IF NOT EXISTS "upload_rate_limits" (
  "id" serial PRIMARY KEY,
  "client_identifier" varchar(64) NOT NULL,
  "window_start" timestamptz NOT NULL,
  "intent_count" integer NOT NULL DEFAULT 0,
  "total_bytes" bigint NOT NULL DEFAULT 0,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  UNIQUE("client_identifier", "window_start")
);

-- Indexes for rate limit lookups
CREATE INDEX IF NOT EXISTS "upload_rate_limits_lookup_idx" 
  ON "upload_rate_limits" ("client_identifier", "window_start");

-- Cleanup index (no immutable function in WHERE clause)
CREATE INDEX IF NOT EXISTS "upload_rate_limits_cleanup_idx" 
  ON "upload_rate_limits" ("window_start");

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_upload_rate_limits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_upload_rate_limits_updated_at ON upload_rate_limits;
CREATE TRIGGER update_upload_rate_limits_updated_at
  BEFORE UPDATE ON upload_rate_limits
  FOR EACH ROW EXECUTE FUNCTION update_upload_rate_limits_updated_at();
