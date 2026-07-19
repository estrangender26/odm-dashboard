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

## Prerequisites

- Environment variables configured:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_STORAGE_URL`
  - `APP_BASE_URL` (for application verification)
- Database connection configured
- Access to production Supabase project

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

When authorized, use both required flags:
```bash
npx tsx scripts/legacy-storage-migrator.ts \
  --execute \
  --confirm-production \
  --sources doc_files \
  --limit 1
```

## Source and ID Filtering

Filter by source:
- `--sources doc_files`
- `--sources governance_files,governance_uploads`

Filter by specific IDs:
- `--ids 1,2,3`

Exclude specific records:
- `--exclude smp_documents:31` (smoke artifact)

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
   npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production --sources smp_documents --exclude smp_documents:31 --limit 1
   ```
5. **Review evidence**: Check ledger states and application routes
6. **Process 10-file batches**: Increase batch size gradually
7. **Complete remaining files**: Process all 404 records

## Resume Behavior

The migration is idempotent and safe to stop and rerun:

- Records with `app_verified` state are skipped on rerun
- Partially completed items continue from their last checkpoint
- Failed items can be retried (attempt count is tracked)

## Ledger States

| State | Description |
|-------|-------------|
| `inventoried` | Record identified for migration |
| `uploading` | Currently uploading to Storage |
| `uploaded` | Upload complete, pending verification |
| `object_verified` | Object verified in Storage |
| `metadata_committed` | Database metadata updated |
| `app_verified` | Application route verified |
| `rollback_required` | Application verification failed |
| `rolled_back` | Metadata cleared, reverted to legacy |
| `conflict` | Object already exists (unexpected) |
| `failed` | Migration failed, requires review |
| `excluded` | Manually excluded from migration |

## Verification

### Check ledger status
```sql
SELECT source, state, COUNT(*) FROM legacy_storage_migration_ledger GROUP BY source, state;
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

1. Storage metadata is cleared from the source record
2. Legacy Base64/file_url is preserved
3. Application falls back to legacy path
4. Storage object is NOT deleted (for audit)
5. Ledger state becomes `rollback_required`

## Orphan Audit

The orphan audit mode scans Storage buckets and classifies objects:

```bash
npx tsx scripts/legacy-storage-migrator.ts --orphan-audit
```

Classifications:
- `referenced`: Object is referenced by source tables
- `active upload intent`: Part of pending upload
- `finalized upload intent`: Completed upload intent
- `migration staged`: In migration ledger
- `possible orphan`: No clear reference found
- `indeterminate`: Cannot determine status

**Note**: The suspected Governance object from the failed pre-PR-274 smoke test will be reported but NOT deleted.

## Prohibited Operations

The following are explicitly NOT authorized:

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
- **Action**: Automatically excluded from migration

## Planned Production Sequence

**⚠️ NOT TO BE RUN NOW**

1. Dry-run inventory
2. Audit SMP ID 31
3. Audit possible Governance orphan
4. Pilot one representative file from each valid source
5. Review evidence
6. Process 10-file batches
7. Complete remaining files sequentially
8. Reconcile all 404 records
9. Perform separate Base64 cleanup only after future approval

## Support

For issues or questions, contact the ODM Dashboard development team.
