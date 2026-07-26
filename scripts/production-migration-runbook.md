# Production Migration Commands

## Phase 1: Pilot Dry-Run (3 records)
npx tsx scripts/minimal-storage-migrator.ts --sources doc_files --ids 2,3,5

## Phase 2: Small Batch Dry-Run (25 records)
npx tsx scripts/minimal-storage-migrator.ts --sources doc_files --limit 25

## Phase 3: Full Dry-Run (340 records)
npx tsx scripts/minimal-storage-migrator.ts --sources doc_files --limit 340

## Phase 4: Pilot Execute (3 records)
npx tsx scripts/minimal-storage-migrator.ts --sources doc_files --ids 2,3,5 --execute --confirm-production

## Phase 5: Full Migration Execute (340 records)
npx tsx scripts/minimal-storage-migrator.ts --sources doc_files --limit 340 --execute --confirm-production
