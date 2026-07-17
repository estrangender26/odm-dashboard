-- Rollback: Restore authenticated-only uploads
-- Handles anonymous rows before restoring NOT NULL constraint

DO $$
DECLARE
  system_user_id integer;
BEGIN
  -- Check if there are any NULL requested_by rows
  IF EXISTS (SELECT 1 FROM storage_upload_intents WHERE requested_by IS NULL) THEN
    -- Get or create system user for anonymous uploads
    SELECT id INTO system_user_id FROM users WHERE email = 'system@anonymous.upload';
    
    IF system_user_id IS NULL THEN
      INSERT INTO users (union_id, name, email, created_at)
      VALUES ('system:anonymous', 'Anonymous Upload System', 'system@anonymous.upload', now())
      RETURNING id INTO system_user_id;
    END IF;
    
    -- Assign NULL requested_by to system user
    UPDATE storage_upload_intents 
    SET requested_by = system_user_id 
    WHERE requested_by IS NULL;
  END IF;
END $$;

-- Drop indexes that depend on capability columns
DROP INDEX IF EXISTS "storage_upload_intents_jti_idx";

-- Restore NOT NULL constraint on requested_by
ALTER TABLE "storage_upload_intents" 
  ALTER COLUMN "requested_by" SET NOT NULL;

-- Remove capability columns
ALTER TABLE "storage_upload_intents"
  DROP COLUMN IF EXISTS "capability_jti",
  DROP COLUMN IF EXISTS "capability_token_hash",
  DROP COLUMN IF EXISTS "capability_expires_at",
  DROP COLUMN IF EXISTS "capability_consumed_at";

-- Drop trigger BEFORE dropping table
DROP TRIGGER IF EXISTS update_upload_rate_limits_updated_at ON upload_rate_limits;
DROP FUNCTION IF EXISTS update_upload_rate_limits_updated_at();

-- Drop rate limiting table
DROP TABLE IF EXISTS "upload_rate_limits";
