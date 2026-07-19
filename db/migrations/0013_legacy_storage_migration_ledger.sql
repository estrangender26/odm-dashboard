-- Legacy Storage Migration Ledger
-- Tracks migration of Base64/file_url legacy data to Supabase Storage
-- Keyed by (source, record_id) for idempotency

CREATE TYPE migration_state AS ENUM (
  'inventoried',
  'uploading',
  'uploaded',
  'object_verified',
  'metadata_committed',
  'app_verified',
  'rollback_required',
  'rolled_back',
  'conflict',
  'failed',
  'excluded'
);

CREATE TABLE legacy_storage_migration_ledger (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  record_id INTEGER NOT NULL,
  bucket VARCHAR(100) NOT NULL,
  storage_path TEXT NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  expected_size BIGINT NOT NULL,
  legacy_sha256 VARCHAR(64) NOT NULL,
  detected_mime_type VARCHAR(255) NOT NULL,
  state migration_state NOT NULL DEFAULT 'inventoried',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  object_verified_at TIMESTAMPTZ,
  metadata_committed_at TIMESTAMPTZ,
  app_verified_at TIMESTAMPTZ,
  rollback_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (source, record_id)
);

CREATE INDEX legacy_migration_ledger_state_idx ON legacy_storage_migration_ledger(state);
CREATE INDEX legacy_migration_ledger_source_idx ON legacy_storage_migration_ledger(source);
CREATE INDEX legacy_migration_ledger_updated_idx ON legacy_storage_migration_ledger(updated_at);

-- Prevent concurrent migration workers on the same record
CREATE UNIQUE INDEX legacy_migration_ledger_lock_idx 
ON legacy_storage_migration_ledger(source, record_id) 
WHERE state IN ('uploading', 'metadata_committed');
