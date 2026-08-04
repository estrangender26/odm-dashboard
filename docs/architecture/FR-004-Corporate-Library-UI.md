# FR-004 — Lihok Corporate Library UI

## Mission

Build the first user-facing React interface for the Lihok Corporate Library.

This release transforms the backend foundation (FR-001, FR-002, FR-003) into an
enterprise document workspace. It also begins the **Lihok Design System** so
future Lihok modules feel like one coherent platform rather than a collection of
ODM-derived pages.

## Out of Scope

- RLS policies
- Microsoft Entra ID / multi-tenancy
- Production deployment
- Supabase bucket creation (already configured in FR-002)
- New backend endpoints (FR-003 is complete)

## Design Direction

The page should feel like a controlled-document workspace, not a generic table.

### Proposed Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Lihok Corporate Library                                    │
├──────────────┬──────────────────────────┬─────────────────┤
│              │                          │                 │
│ Categories   │  Document List           │  Document Detail │
│              │  [Search]                │                 │
│ 📁 Corporate │  Filters                 │  Title          │
│    Foundation│  • Status                │  Number         │
│ 📁 Legal &   │  • Classification        │  Version        │
│    Compliance│  • Owner                 │  Owner          │
│ 📁 Governance│  • Effective date       │  Effective Date │
│ 📁 Finance   │                          │  Status badge   │
│ ...          │  LT-CORP-001             │  Version        │
│              │  LT-GOV-003              │  Timeline       │
│              │  LT-HR-014               │                 │
│              │  ...                     │  [Download]     │
│              │                          │  [Upload New    │
│              │                          │   Version]      │
│              │                          │  [Archive]      │
│              │                          │                 │
│              │                          │  Audit Trail    │
│              │                          │                 │
└──────────────┴──────────────────────────┴─────────────────┘
```

## Routes

Add in `src/App.tsx`:

```tsx
import LihokCorporateLibrary from "./pages/LihokCorporateLibrary";

<Route path="/lihok-corporate-library" element={<LihokCorporateLibrary />} />;
```

Also add a card on the `Home` dashboard so authenticated users can discover it.

## Lihok Design System (Started in FR-004)

Create `src/lib/lihok-theme.ts` with a small, explicit token set:

- **Primary:** `#0F172A` (deep slate) + `#1E40AF` (Lihok blue accent)
- **Surface:** white, `#F8FAFC`, `#E2E8F0`
- **Text:** `#0F172A`, `#475569`, `#94A3B8`
- **Status colors:**
  - draft: `#94A3B8`
  - for_review: `#F59E0B`
  - approved: `#10B981`
  - superseded: `#6366F1`
  - archived: `#64748B`
- **Classification badges:** distinct but subtle.
- **Font:** continue `Inter` initially; reserve the ability to introduce a Lihok
  brand typeface later.
- **Radius:** `8px` cards, `6px` inputs, `9999px` badges.

Do not hardcode these values in components; import from the theme file so the
system can grow.

## Components to Build

All new components live under `src/modules/lihok-corporate-library/`:

| Component | Responsibility |
|---|---|
| `LihokCorporateLibraryPage.tsx` | Top-level page wiring |
| `CategorySidebar.tsx` | Render categories, active doc counts, selection |
| `DocumentList.tsx` | Search input, filter chips, result rows |
| `DocumentDetail.tsx` | Read-only metadata + action bar |
| `VersionTimeline.tsx` | Ordered version cards, status, effective date |
| `AuditTrail.tsx` | Paginated audit entries per document |
| `StatusBadge.tsx` | Consistent status rendering |
| `ClassificationBadge.tsx` | Consistent classification rendering |
| `UploadVersionDialog.tsx` | Triggers direct-storage-upload then creates version |
| `ArchiveDocumentDialog.tsx` | Confirm + archive/restore action |

## API Integration

The backend is a Hono router, not tRPC. Add a thin fetch helper in
`src/lib/lihok-api.ts`:

- `getCategories()` → `GET /api/lihok-corporate/categories`
- `searchDocuments(params)` → `GET /api/lihok-corporate/documents`
- `getDocument(id)` → `GET /api/lihok-corporate/documents/:id`
- `createDocument(data)` → `POST /api/lihok-corporate/documents`
- `updateDocument(id, data)` → `PATCH /api/lihok-corporate/documents/:id`
- `archiveDocument(id)` → `POST /api/lihok-corporate/documents/:id/archive`
- `restoreDocument(id)` → `POST /api/lihok-corporate/documents/:id/restore`
- `getVersions(documentId)` → `GET /api/lihok-corporate/documents/:id/versions`
- `getVersion(id)` → `GET /api/lihok-corporate/versions/:id`
- `createVersion(data)` → `POST /api/lihok-corporate/versions`
- `transitionVersion(data)` → `POST /api/lihok-corporate/versions/transition`
- `getAudit(documentId, options)` → `GET /api/lihok-corporate/documents/:id/audit`

Use React Query (`@tanstack/react-query`) for caching and invalidation, matching
the existing tRPC-powered pages where possible.

## File Upload Flow

Reuse `uploadFileDirect` from `src/lib/direct-storage-upload.ts`:

```ts
await uploadFileDirect({
  module: "lihok-corporate",
  file,
  metadata: { documentId, versionId },
});
```

After a successful finalize, call `PATCH /versions/:id` or
`POST /versions/transition` to move the version to `for_review` or keep it as
`draft` depending on UX choice.

FR-004 only needs **upload new version** for draft versions. Approval UI can be
added in a follow-up if scope allows.

## Phased PRs Within FR-004

### PR 4a — Design tokens and route shell
- Add `src/lib/lihok-theme.ts`
- Add route and home-card navigation
- Create empty page shell with three-column layout
- Add route tests

### PR 4b — Categories and document list
- Add `CategorySidebar` and `DocumentList`
- Wire search and filters
- Add React Query hooks
- Add tests for list rendering and filter behavior

### PR 4c — Document detail and version timeline
- Add `DocumentDetail` and `VersionTimeline`
- Read-only metadata display
- Download button (uses FR-002 signed URL flow)
- Add tests

### PR 4d — Upload and archive actions
- Add `UploadVersionDialog`
- Add `ArchiveDocumentDialog`
- Reuse direct-storage-upload
- Add tests for happy path and validation errors

### PR 4e — Audit trail and polish
- Add `AuditTrail`
- Status and classification badges
- Responsive behavior
- Final regression run

## Acceptance Criteria

- Any authenticated user can open `/lihok-corporate-library`.
- Category navigation shows the 16 seeded categories.
- Search returns matching documents by title or document number.
- Selecting a document shows its metadata and version timeline.
- Users can upload a new version of an existing document.
- Users can archive and restore documents.
- The page does not expose ODM, Manila Water, facility, or SMP-specific styling.
- `npm run check` and `npm run build` pass.
- New and existing tests pass.

## Risks

| Risk | Mitigation |
|---|---|
| Reusing ODM visual patterns | Enforce the Lihok theme token file; review for hardcoded ODM colors. |
| Direct-storage-upload coupling | Only call it through the existing helper; do not duplicate upload logic. |
| Scope creep into approvals | Defer approval UI to a follow-up release; keep FR-004 to read, upload, archive. |
| React Query vs tRPC inconsistency | Document that Lihok uses REST-like Hono endpoints with React Query. |

## Next Release After FR-004

FR-005 — Security & RLS: add Row-Level Security policies and classification-based
visibility controls for the Corporate Library module.
