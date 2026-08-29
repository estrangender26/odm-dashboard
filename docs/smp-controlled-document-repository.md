# SMP Controlled-Document Repository — Refactor Notes

Status: implemented on `refactor/smp-controlled-document-repository`

## 1. Current-state assessment (pre-refactor, authoritative main `eda84b9`)

### Frontend
- `src/pages/SmpDashboard.tsx` is the entire SMP module UI (657 lines).
  - Hard-coded lists: `EQUIPMENT_TYPES`, `SYSTEMS`, `STATUSES` (module-level arrays).
  - "Load Demo" button wired to `trpc.smp.seed` (fake 15-document dataset).
  - Fake KPI counts (total / Active / Under Review / Expired) computed from rows and rendered as stat chips.
  - Legacy base64 PDF upload path (`FileReader` → `smp.update` with `fileData`) alongside the governed
    Supabase Storage/TUS path.
  - The governed upload path uploads to Storage but the finalize step inserts a **new** `smp_documents`
    row (`code = SMP-<timestamp>`, title = filename), producing orphan rows the UI never links back to.
  - PDF viewer renders the source PDF in an iframe (source is preserved — keep).
- `src/App.tsx` route `/smp-dashboard`; `src/pages/Home.tsx` nav card; `src/pages/Help.tsx` help text
  (describes the old equipment-type/system CRUD flow).
- `src/components/AIAssistant.tsx` builds an "SMP DOCUMENTS" context from `status`/`equipmentType`/
  `system`/`responsible` fields.
- `src/lib/requestTimeout.ts` treats `smp.create` / `smp.update` as large base64-upload paths.

### API
- `api/smp-router.ts`:
  - `ensureSmpTable()` creates `smp_documents` at runtime with raw SQL — the table has **no real
    migration** (migration 0011 only added storage columns, 0028 only enabled RLS).
  - `list` (public), `get` (authed), `create` (authed), `update` (authed), `delete` (authed),
    and `seed` (public) inserting 15 demo documents — **code-level dummy data source**.
  - `update` accepts `fileData` and silently clears Storage metadata on base64 replacement
    (legacy "authoritative replacement" behavior).
- `api/storage-router.ts`: `smp` module authorize/finalize flow. `validateTarget` validates
  `documentId` only; finalize inserts a fresh `smp_documents` row per upload; no revision concept.
- `api/storage-files.ts`: `smp_documents` file accessor (mirror/legacy file on the row).
- `api/storage-validation.ts`: `smp` module accepts PDF only (good — keep).

### Database
- `db/schema.ts` `smpDocuments`: `id, code, title, revision, equipment_type, system, date_issued,
  next_review, status, responsible_party, file_data, file_type, file_name, created_at, updated_at`
  + shared `storage_*` columns. No revision history, no controlled-document metadata, no
  structured procedure data, no uniqueness on reference number.
- No relations in `db/relations.ts`.
- Migrations journal up to `0032`. No snapshot after 0027 (consistent with 0028–0032).
- `scripts/legacy-storage-migrator*.ts` depend on `smp_documents.file_data` (shared infra —
  columns must be preserved).

### Tests touching SMP (all pass on main)
- `api/storage-security.test.ts` (SMP validation + legacy-replacement source assertions +
  browser-source checks incl. `src/pages/SmpDashboard.tsx`).
- `api/storage-finalize-security.test.ts` (wrong module/source capability claims).
- `api/request-body-guard.test.ts`, `api/upload-limits.test.ts` (large-body guards reference
  `smp.create` / `smp.update` — kept intentionally, see below).
- `src/lib/0028_enable_rls_remaining_tables_migration.test.ts` (RLS list includes `smp_documents`).
- `src/lib/phase1b_decommission_migration.test.ts` (active-table list includes `smp_documents`).
- No dedicated SMP router tests; no `SmpDashboard` component tests.

### Dummy-data inventory (code-level, in automatic removal scope)
1. `api/smp-router.ts` `seed` procedure + 15 hard-coded demo rows.
2. `src/pages/SmpDashboard.tsx` "Load Demo" button + empty-state copy pointing to it.
3. `src/pages/SmpDashboard.tsx` hard-coded `EQUIPMENT_TYPES` / `SYSTEMS` / `STATUSES` arrays.
4. Fake stat chips (counts are real but the status model they summarize is a hard-coded list).
5. Base64 upload path that overwrites the stored file without revision governance.

Not touched: persisted production rows in `smp_documents` (cannot be inspected from this
environment; migrations are additive only). `src/modules/presentation-center/generators.ts`
line ~1608 is a *reserved* generator description mentioning SMP coverage — it is an unrelated
module placeholder, not SMP module data; left unchanged (scope control).

## 2. Target architecture

SMP becomes a controlled engineering-document repository. Reference number is the identity;
files are immutable revision objects in the existing governed Supabase Storage flow.

- `smp_documents` — document series + denormalized current-revision snapshot (keeps every
  legacy column for backward compatibility with the storage migrator and legacy rows).
- `smp_document_revisions` — immutable revision rows: revision label/number, status
  (`current`/`superseded`), effectivity date, file metadata (original filename, type, size,
  storage bucket/path/etc.), uploaded by/at, `superseded_by_revision_id`. `UNIQUE(document_id,
  revision)` — uploading an existing revision label is rejected (no silent overwrite).
- `smp_families` — data-driven family catalog (7 approved families + typical equipment +
  suggested subtype tags). Future families are data, not frontend code.
- `smp_sections` — flexible structured procedure sections (key/title/body/position); future
  SMPs may have different section counts.
- `smp_tasks` — structured tasks (operator-driven / technician PM / technician CBM /
  corrective) with task text, frequency, tools & materials, safety controls, field capture
  data, escalation trigger, failure mode (corrective), display order.
- `smp_task_applicability` — flexible subtype/applicability tags per task (All, Belt, Filter,
  PLC, MV, VFD-driven, …). No per-subtype columns.

Upload flow reuses the existing governed storage architecture (TUS + signed URLs +
capability intents): the `smp` finalize flow (extracted into `api/smp-finalize.ts`) creates a
revision row, supersedes the previous current revision, and mirrors the new revision onto the
series row. Ordering guarantees the new revision can never supersede itself: the previous
current revision(s) are superseded BEFORE the new revision is inserted (the supersede
predicate cannot match a row that does not exist yet), and the backfill that points the
previous revision(s) at the new one runs by captured ids with the new id defensively
excluded. After a successful finalize there is exactly one current revision per series.

PDFs remain the authoritative controlled documents. No PDF extraction is performed; the PDFs
are uploaded manually after implementation. Structured procedure tables are empty until a
future ingestion step fills them — the UI renders honest empty states.

## 3. Database / schema changes (migrations 0033 + 0034 + 0035, additive)

**0033** (`0033_smp_controlled_documents.sql`):
- `CREATE TABLE IF NOT EXISTS smp_documents` (full shape; replaces the runtime-created table
  for fresh installs) + additive columns: `smp_id`, `smp_family`, `asset_name`, `asset_type`,
  `facility_type`, `applicability` (jsonb), `criticality`, `document_owner`, `prepared_by`,
  `reviewed_by`, `approved_by`, `effectivity_date` (date), `uploaded_by`, `uploaded_at` +
  indexes.
- New tables: `smp_document_revisions`, `smp_families` (seeded with the 7 approved families),
  `smp_sections`, `smp_tasks`, `smp_task_applicability`.
- New tables follow the repo's RLS posture (ENABLE ROW LEVEL SECURITY + REVOKE from
  `anon`/`authenticated`; backend postgres role has BYPASSRLS).
- Nothing is dropped, renamed, or truncated.

**0034** (`0034_smp_revision_safe_structured_and_identity.sql`, PR #404 review fixes):
- Reference-number identity: `smp_documents.code_key` (lower/trimmed normalized key),
  `CREATE UNIQUE INDEX smp_documents_code_key_unique`, and a BEFORE INSERT/UPDATE trigger
  keeping the key in sync. A read-only duplicate-detection guard runs FIRST and fails the
  migration loudly (no data discarded, no destructive merge).
- Revision-scoped structured data: `smp_sections.revision_id` and `smp_tasks.revision_id`
  become NOT NULL and cascade with their revision; orphan rows fail the migration loudly.
- Canonical family relation: `smp_documents.family_id` → `smp_families(id)` ON DELETE SET
  NULL; the literal `smp_family` document text is preserved verbatim.
- `smp_deletion_records` ledger for staged deletion (storage removal and DB delete are
  deliberately NOT atomic; progress is recorded, confirmations are idempotent/retryable),
  with RLS.

**0035** (`0035_smp_one_current_revision.sql`, PR #404 second-pass fix):
- Partial unique index `smp_document_revisions_one_current_idx` on `(document_id)` WHERE
  `status = 'current'` — the database enforces at most one current revision per document
  series. A read-only preflight guard detects existing violations and fails the migration
  loudly instead of modifying production history.
- Mirrored in `db/schema.ts`.

### Production migration instructions
- Deploy the branch to Render. Production boot runs `drizzle-orm migrate` on
  `db/migrations` (see `api/queries/connection.ts` `ensureDbReady`), which applies
  `0033_smp_controlled_documents.sql`, `0034_smp_revision_safe_structured_and_identity.sql`,
  and `0035_smp_one_current_revision.sql` automatically.
- 0034 requires that no reference-number duplicates and no unattributed sections/tasks exist;
  0035 requires at most one current revision per document series. Both fail the boot loudly
  otherwise (manual reconciliation first). All migrations are additive; no manual SQL is
  required in the normal case. Verify via Render logs
  (`[db] migration finish; verified tasks.procedure_familiarity`) and by opening
  `/smp-dashboard` (empty library state).
- Rollback is not needed for additive migrations; if a problem occurs, redeploy the
  previous commit (columns/tables added by 0033/0034/0035 are unused by the old code).

## 4. Behavior changes
- `smp.seed` removed; "Load Demo" removed; hard-coded filter lists removed (filters are
  populated from persisted data).
- `smp.create` / `smp.update` no longer accept file payloads; files change only through the
  governed revision-upload flow (`/api/storage/uploads/*`).
- New-document uploads are ATOMIC: the document series and its first revision are created
  together at storage finalize, so a failed upload leaves no orphan series and the same
  reference number can be retried.
- Staged deletion (`smp.deletePrepare` / `smp.deleteConfirm`): storage objects are removed
  first, the DB row after, with progress recorded in `smp_deletion_records`; failures are
  explicit and retries are idempotent. No cross-system atomicity is claimed.
- Structured procedure data is revision-scoped: `smp.get({ id, revisionId? })` returns
  sections/tasks for one resolved revision (current by default); historical revision data
  can never mix with newer revision content.
- New: `smp.families` (data-driven), revision uploads with supersession, revision history,
  structured sections/tasks reads, detail page, canonical family classification separate
  from literal document family text.
- `smp.create` / `smp.update` remain in the shared large-body path list
  (`api/upload-body-limit.ts`, `src/lib/requestTimeout.ts`) deliberately: the HTTP body guard
  and timeout infra are shared, and keeping them avoids unrelated changes to
  `api/request-body-guard.test.ts` / `api/upload-limits.test.ts`.

## 5. Known limitations
- The seven approved SMP PDFs are not present in this environment; nothing is fabricated.
  Upload is manual through the module.
- Structured sections/tasks are not yet populated (no extraction); the detail page renders
  empty states until a future ingestion step writes them.
- Legacy `smp_documents` rows (including any created by the old upload flow) have no revision
  rows; they remain visible with their stored status/file. Uploading a new revision to such a
  row creates its first revision row.
- New tables have no drizzle snapshot (consistent with 0028–0032); `drizzle-kit` tooling may
  regenerate snapshots later.
