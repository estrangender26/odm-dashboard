# Legacy Storage Migration Runbook

## Overview

This runbook covers the safe migration of legacy Base64/file_url content to Supabase Storage.

**Important**: This document describes the migration tooling. Production execution requires explicit authorization.

## Inventory

- **Total legacy files**: 404
- **Total decoded size**: ~1.5784 GiB
- **Sources**:
  - doc_files: 340 files
  - governance_files: 62 files
  - governance_uploads: 1 file
  - smp_documents: 1 file

## Architecture

### Memory Safety

The migration uses **streaming with temporary files** to handle large files safely:

- Base64 is decoded incrementally to a secure temp file
- SHA-256 is calculated during decoding
- Files are uploaded via TUS resumable upload (6 MiB chunks)
- Temp files are cleaned up in `finally` blocks
- Memory usage remains bounded regardless of file size

### State-Based Continuation

Records can resume from any state:

| State | Action on Resume |
|-------|------------------|
| `inventoried` | Begin upload |
| `uploading` | Check existing upload or restart |
| `uploaded` | Verify object |
| `object_verified` | Commit metadata |
| `metadata_committed` | Verify application route |
| `rollback_required` | Complete rollback |
| `rolled_back` | Report and require review |
| `conflict` | **Human review required** |
| `failed` | Retry if safe |
| `app_verified` | **Skip** - already complete |
| `excluded` | **Skip** - excluded |

### Worker Exclusion

PostgreSQL advisory locks ensure only one worker processes a record:

```sql
SELECT pg_try_advisory_lock(hashtextextended('legacy:source:record_id', 0))
```

Locks are automatically released after processing.

### Idempotent Object Handling

When an object already exists at the deterministic path:

1. Verify object size matches expected
2. Verify MIME type matches expected
3. Stream download and verify SHA-256
4. **If all match**: Reuse object (idempotent)
5. **If any mismatch**: Mark as `conflict` (never overwrite)

## Prerequisites

- Environment variables:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_STORAGE_URL`
  - `APP_BASE_URL` (required for execute mode, must be HTTPS)
- Database connection
- Access to Supabase project

## Dry-Run Commands

### Inventory all sources
```bash
npx tsx scripts/legacy-storage-migrator.ts
```

### Inventory specific source
```bash
npx tsx scripts/legacy-storage-migrator.ts --sources doc_files --limit 5
```

### Check specific records
```bash
npx tsx scripts/legacy-storage-migrator.ts --sources doc_files --ids 1,2,3
```

## Execution Commands (Production)

**⚠️ WARNING: Production execution is NOT authorized in this PR.**

Required flags for production:
```bash
npx tsx scripts/legacy-storage-migrator.ts \
  --execute \
  --confirm-production \
  --sources doc_files \
  --limit 1
```

**APP_BASE_URL Requirements for Execute Mode:**
- Must be set to a valid URL
- Must use **HTTPS** (HTTP rejected)
- Cannot be **localhost** or **127.0.0.1**
- Cannot contain **query strings**
- Cannot contain **credentials**

## Source and ID Filtering

Filter by source:
- `--sources doc_files`
- `--sources governance_files,governance_uploads`

Filter by specific IDs:
- `--ids 1,2,3`

## Pilot Sequence

When authorized for production:

1. **Dry-run inventory**: `npx tsx scripts/legacy-storage-migrator.ts`
2. **Audit SMP ID 31**: Verify the 129-byte smoke artifact
3. **Audit Governance orphan**: Check for any orphaned objects
4. **Pilot one file from each source**:
   ```bash
   npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production --sources doc_files --limit 1
   npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production --sources governance_files --limit 1
   npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production --sources governance_uploads --limit 1
   npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production --sources smp_documents --limit 1
   ```
5. **Review evidence**: Check ledger states and application routes
6. **Process batches**: Default batch size is 1, increase as confidence grows
7. **Complete remaining files**: Process all 404 records

## Resume Behavior

The migration is **idempotent** and safe to stop and rerun:

- Records with `app_verified` state are skipped on rerun
- Records with `conflict` state require human review
- Partially completed items continue from their last checkpoint
- Failed items can be retried (attempt count is tracked)
- Worker locks are advisory and expire with the session

## Ledger States

| State | Description | Terminal |
|-------|-------------|----------|
| `inventoried` | Record identified for migration | No |
| `uploading` | Currently uploading to Storage | No |
| `uploaded` | Upload complete, pending verification | No |
| `object_verified` | Object verified in Storage | No |
| `metadata_committed` | Database metadata updated | No |
| `app_verified` | Application route verified | **Yes** |
| `rollback_required` | Application verification failed | No |
| `rolled_back` | Metadata cleared, reverted | **Yes** |
| `conflict` | Object exists with mismatch | **Yes** |
| `failed` | Migration failed | No |
| `excluded` | Manually excluded | **Yes** |

## Verification

### Check ledger status
```sql
SELECT source, state, COUNT(*)
FROM legacy_storage_migration_ledger
GROUP BY source, state;
```

### Verify specific record
```bash
# Check ledger entry
curl /api/storage/files/doc_files/123/view
```

### Orphan audit
```bash
npx tsx scripts/legacy-storage-migrator.ts --orphan-audit
```

## Rollback Behavior

If application verification fails after metadata commit:

1. Storage metadata is **cleared** from the source record
2. Legacy Base64/file_url is **preserved**
3. Application falls back to legacy path
4. Storage object is **NOT deleted** (for audit)
5. Ledger state becomes `rollback_required` → `rolled_back`

## Object Reuse

When the deterministic object already exists:

1. **Size check**: Must match exactly
2. **MIME check**: Must match expected type
3. **SHA-256 check**: Full content hash must match
4. **If all pass**: Object is reused, no re-upload
5. **If any fail**: Marked as `conflict`, **never overwritten**

## Orphan Audit Classification

```bash
npx tsx scripts/legacy-storage-migrator.ts --orphan-audit
```

Classification precedence (highest to lowest):

1. `referenced` - Referenced by source tables
2. `active_upload_intent` - Pending/active upload intent
3. `finalized_upload_intent` - Completed upload intent
4. `migration_verified` - Verified in migration ledger
5. `migration_staged` - Staged in migration ledger
6. `possible_orphan` - No clear reference found

**Note**: The suspected Governance object from the failed pre-PR-274 smoke test will be reported but **NOT deleted**.

## Prohibited Operations

The following are explicitly **NOT authorized**:

- ❌ Executing migration without `--execute --confirm-production`
- ❌ Modifying production database or Storage directly
- ❌ Deleting Storage objects automatically
- ❌ Removing legacy Base64/file_url content
- ❌ Running the 150 MiB + 1 byte upload rejection smoke test
- ❌ Migrating SMP ID 31 without human review

## Special Exclusions

### SMP ID 31
- **Filename**: render-smoke-20260715073609120.pdf
- **Size**: 129 bytes
- **Status**: Smoke artifact requiring human audit
- **Action**: **Automatically excluded** from migration
- **Behavior**: Reported in dry-run and audit modes

## Planned Production Sequence

**⚠️ NOT TO BE RUN NOW**

1. Dry-run inventory
2. Audit SMP ID 31
3. Audit possible Governance orphan
4. Pilot one representative file from each valid source
5. Review evidence (size, SHA-256, application routes)
6. Process small batches (1-10 files)
7. Complete remaining files sequentially
8. Reconcile all 404 records
9. **Separate**: Base64 cleanup only after future approval

## Error Sanitization

All errors in logs and ledger are sanitized to remove:
- Authorization headers
- Bearer tokens
- JWT-like strings
- Database URLs with credentials
- Signed URLs with query parameters
- Long Base64 payloads
- Stack traces

## TUS Upload Details

- **Chunk size**: 6 MiB (TUS_CHUNK_SIZE_BYTES)
- **Endpoint**: `/storage/v1/upload/resumable`
- **Retry delays**: 0, 1s, 3s, 5s, 10s
- **Upload URLs**: Never logged
- **Authorization**: Via header (not logged)

## Support

For issues or questions, contact the ODM Dashboard development team.
