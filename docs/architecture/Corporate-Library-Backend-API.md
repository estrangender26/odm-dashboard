# Lihok Corporate Library Backend API

**Status:** Draft — aligned with FR-003 / PR #323
**Authentication:** Every route requires a valid session cookie. Anonymous requests are rejected with HTTP 403.
**Authorization baseline:** Write operations require authentication. Approving a version additionally requires `role = "admin"` and the approver must not be the uploader.

## Base path

All routes are mounted under `/api/lihok-corporate`.

## Categories

### `GET /categories`

List the 16 seeded corporate-library categories with the count of active (non-archived) documents per category.

- **Authentication:** required
- **Authorization:** any authenticated user
- **Query:** none
- **Output:** `{ categories: Array<{ id, code, name, sortOrder, activeDocumentCount }> }`
- **Errors:** 403 on anonymous request

## Documents

### `GET /documents`

Search and filter documents.

- **Authentication:** required
- **Authorization:** any authenticated user
- **Query:**
  - `q` (optional) — free-text search across document number and title
  - `documentNumber` (optional)
  - `title` (optional)
  - `ownerName` (optional)
  - `classification` (optional) — `public | internal | confidential | restricted`
  - `categoryId` (optional)
  - `archived` (optional) — `"true"` or `"false"`
  - `limit` (default 20, max 100)
  - `offset` (default 0)
- **Output:** `{ items: Document[], pagination: { total, limit, offset } }`
- **Business rules:** No accepted query parameter is silently ignored. `status` and effective-date filters are intentionally omitted in FR-003; they will be implemented in a future release with clear current-version semantics.
- **Errors:** 400 on invalid query, 403 on anonymous request

### `GET /documents/:id`

Read a single document, including the id of its current version.

- **Authentication:** required
- **Output:** `{ document: Document & { currentVersionId: number | null } }`
- **Errors:** 400 invalid id, 404 not found, 403 anonymous

### `POST /documents`

Create a new controlled document.

- **Authentication:** required
- **Authorization:** any authenticated user
- **Input:** `{ documentNumber, title, description?, categoryId, defaultClassification?, ownerName? }`
- **Business rules:**
  - Document number must be unique.
  - Category must exist.
  - Document creation and its audit entry are committed atomically.
- **Output:** `{ document: { id } }` with HTTP 201
- **Errors:** 400 duplicate number / invalid category / invalid input, 403 anonymous

### `PATCH /documents/:id`

Update document metadata.

- **Authentication:** required
- **Authorization:** any authenticated user
- **Input:** `{ title?, description?, categoryId?, defaultClassification?, ownerName? }`
- **Business rules:**
  - Archived documents cannot be edited until restored.
  - Category, if provided, must exist.
  - Update and audit entry are committed atomically.
- **Errors:** 400 invalid input, 404 not found, 409 archived document, 403 anonymous

### `POST /documents/:id/archive`

Soft-archive a document.

- **Authentication:** required
- **Authorization:** any authenticated user
- **Business rules:**
  - Idempotent if already archived.
  - Archive and audit entry are committed atomically.
- **Errors:** 404 not found, 403 anonymous

### `POST /documents/:id/restore`

Restore an archived document.

- **Authentication:** required
- **Authorization:** any authenticated user
- **Business rules:**
  - Idempotent if not archived.
  - Restore and audit entry are committed atomically.
- **Errors:** 404 not found, 403 anonymous

## Versions

### `GET /documents/:id/versions`

List all versions for a document, ordered by version number descending.

- **Authentication:** required
- **Output:** `{ items: Version[] }`
- **Errors:** 400 invalid id, 404 document not found, 403 anonymous

### `GET /versions/:id`

Read a single version.

- **Authentication:** required
- **Output:** `{ version: Version }`
- **Errors:** 400 invalid id, 404 not found, 403 anonymous

### `POST /versions`

Create a new version for a document.

- **Authentication:** required
- **Authorization:** any authenticated user
- **Input:** `{ documentId, versionNumber, title, description?, classification?, ownerName?, effectiveDate?, changeNotes? }`
- **Business rules:**
  - The document must exist and must not be archived.
  - Version number must be unique within the document.
  - The current user is recorded as `uploadedBy`.
  - Version creation and audit entry are committed atomically.
- **Output:** `{ version: { id } }` with HTTP 201
- **Errors:** 400 duplicate version / invalid input, 404 document not found, 409 archived document, 403 anonymous

### `PATCH /versions/:id`

Update version metadata.

- **Authentication:** required
- **Authorization:** any authenticated user
- **Input:** `{ documentId, title?, description?, classification?, ownerName?, effectiveDate?, changeNotes? }`
- **Business rules:**
  - The version must belong to the specified document.
  - Approved, superseded and archived versions are immutable.
  - Update and audit entry are committed atomically.
- **Errors:** 400 mismatch / invalid input, 403 immutable version, 404 not found, 403 anonymous

### `POST /versions/transition`

Move a version through the controlled status machine.

- **Authentication:** required
- **Authorization:** any authenticated user; **approval requires `role = "admin"` and the approver must not equal `uploadedBy`**
- **Input:** `{ versionId, documentId, status, changeNotes? }`
- **Allowed transitions:**
  - `draft` → `for_review` or `archived`
  - `for_review` → `draft`, `approved`, or `archived`
  - `approved` → `archived`
  - `superseded` → `archived`
  - `archived` is terminal for version records
- **Business rules:**
  - Transitions to `for_review` or `approved` require a completed Storage record (`fileName`, `fileSize`, `mimeType`, `storageProvider`, `storageBucket`, `storagePath`, `storageUploadedAt`).
  - Direct/manual transition to `superseded` is rejected; supersession happens automatically when a new version is approved.
  - Approving a version automatically supersedes any previously approved version for the same document.
  - Same-status requests are treated as an idempotent no-op and do not create audit entries.
  - All consequential writes and their audit entries are committed in a single transaction.
- **Output:** `{ version: { id, status } }`
- **Errors:** 400 invalid transition / missing file / manual supersede, 403 anonymous / non-admin / self-approval, 404 version not found

## Audit

### `GET /documents/:id/audit`

List audit entries for a document, optionally filtered to a specific version.

- **Authentication:** required
- **Query:** `versionId?`, `limit?` (max 100), `offset?`
- **Output:** `{ items: AuditEntry[], pagination: { total, limit, offset } }`
- **Errors:** 400 invalid id, 403 anonymous

## Error handling

- Known validation and business-rule errors return `400`.
- Authentication failures return `403` (the existing Kimi auth helper convention).
- Missing records return `404`.
- Conflicts such as editing archived content return `409`.
- Unexpected errors are logged server-side and return `500` with a generic message; details are never leaked to the client.

## Out of scope for FR-003

- React UI, routes and pages
- Supabase bucket creation
- File upload and download (handled by FR-002 / PR #322)
- RLS policies
- Microsoft Entra ID or multi-tenancy
- Classification-level authorization
- Production deployment
- `status` and effective-date filters in document search (deferred to FR-004)
