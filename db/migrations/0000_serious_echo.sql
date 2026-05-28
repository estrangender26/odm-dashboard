-- Backfilled migration file.
-- This file is intentionally a no-op to satisfy the migration journal entry
-- and prevent startup failures when Drizzle loads migration files by tag.
-- Original schema changes are represented by current schema and later migrations.

-- no-op
SELECT 1;
