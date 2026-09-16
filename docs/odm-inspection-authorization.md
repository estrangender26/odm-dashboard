# Operator-Driven Maintenance — authorization boundary and destructive-operation guard

**Status:** containment for the 2026-09-16 production data-loss incident
**Surface:** `public/mw-dashboard.html` (served at `/mw-dashboard`) and the `mw.*` tRPC procedures
**Last updated:** 2026-09-16

---

## 1. Why this document exists

On **2026-09-16** production `public.mw_inspections` contained **2,372** rows. On
**2026-09-11** the same table, measured through the Render service's own
`DATABASE_URL`, contained **16,543** rows. Approximately **14,171 historical
inspection rows** were destroyed and **nothing recorded the operation, the
actor, the time or the affected count**.

What the forensic investigation established:

- the surviving 2,372 rows were written by **one anonymous browser import** in
  `2026-09-16 03:38:45–03:38:59 UTC` (12 chunks × 200 rows, contiguous serial ids
  `238513–240884`, `updated_by = 'system'`);
- immediately before that import the table was **empty**, so the historical rows
  had already been removed by a whole-table deletion;
- every mutating ODM procedure was a `publicQuery` — **callable without any
  authentication**;
- `mw.resetAll` is a `DELETE FROM mw_inspections` **with no `WHERE` clause**, and
  the dashboard's **Clear** button called it.

Attribution of the deletion (the Clear control vs. manual SQL) could not be
concluded from the evidence available, which is itself the defect this document
and the accompanying code change address.

## 2. Declared authorization boundary

Every `mw.*` procedure now declares its boundary explicitly. The middleware is
the repository's existing one (`api/middleware.ts`); no parallel auth system was
introduced.

| Procedure | Boundary | Rationale |
| --- | --- | --- |
| `listInspections` | **publicQuery** | The ODM dashboard is a shared field dashboard and must open without login. |
| `getInspection` | **publicQuery** | Same. |
| `importExcel` | **publicQuery** — deliberate, see §3 | The module's only data-entry path; upsert-only, cannot delete. |
| `updateInspection` | **authedQuery** | Authenticated write, matching the intent recorded in `docs/rls-deployment-plan.md` (`mw_inspections_write_authenticated`, `TO authenticated`). No public workflow uses it. |
| `deleteInspection` | **adminQuery** | Deletes inspection evidence. No public workflow uses it; OWNER-only. |
| `resetAll` | **adminQuery + typed confirmation** | Whole-dataset destruction. OWNER-only and never part of the browser workflow. |

`adminQuery` = `authedQuery.use(requireRole("admin"))`, i.e. an authenticated
session whose `users.role` is `admin`. Anonymous callers receive
`UNAUTHORIZED`; authenticated non-admins receive `FORBIDDEN`. Both are rejected
**before input validation**, so an anonymous caller cannot probe the endpoint by
observing validation errors.

### 2.1 `resetAll` guard

`mw.resetAll` additionally requires the exact typed confirmation phrase:

```
DELETE ALL ODM INSPECTIONS
```

(`MW_RESET_ALL_CONFIRMATION` in `api/mw-router.ts`). A missing or wrong phrase is
rejected with `BAD_REQUEST`. **No frontend surface sends it** — the ODM dashboard
cannot perform whole-dataset deletion at all.

## 3. `importExcel` — the deliberate anonymous decision

`importExcel` is **not** made OWNER-only. This is an explicit, recorded decision,
not an oversight:

- `public/mw-dashboard.html` is served anonymously and contains **no login
  affordance** (no sign-in link, no session handling). Requiring authentication
  would silently break the module's only data-entry path for every operator.
- Production evidence shows anonymous importing is the historical reality: every
  current inspection row was written with `updated_by = 'system'`, i.e. with no
  authenticated actor.
- The procedure is **additive**: `INSERT ... ON CONFLICT DO UPDATE` on the
  canonical key. It can create rows and update field values of existing rows; it
  **cannot delete a row**, which was the destructive event in this incident.

Risk is reduced rather than the workflow broken: every import writes an
`mw_inspection_audit` row recording the operation, the affected row count, the
timestamp, a correlation id, and the actor (`actorId = users.id` when a session
cookie is present, otherwise `actorId = null` / `actorRole = 'anonymous'`). If
OWNER later decides the import path must also require an authenticated session,
the change is a one-line policy swap to `authedQuery` plus a login affordance on
the dashboard — deliberately **not** made now.

## 4. Frontend Clear behaviour

`Clear` previously: cleared `localStorage` **and** called `POST /api/trpc/mw.resetAll`.

`Clear` now (`clearLocalCopy()` in `public/mw-dashboard.html`):

1. asks for confirmation, stating that database records are **not** deleted;
2. removes only this browser's cached copy (`odm_mw_rows`, `odm_mw_filename`);
3. reloads the authoritative dataset from the database.

The server endpoint is protected independently, so hiding or disabling the
button is not relied upon as security: an anonymous `POST /api/trpc/mw.resetAll`
returns `401` and performs zero database mutations.

## 5. Auditability

Every ODM write path writes exactly one row to **`mw_inspection_audit`**
(migration `0040_mw_inspection_audit`, `api/mw-audit.ts`) **inside the same
transaction as the mutation**, so a mutation that cannot be attributed cannot
commit:

| Column | Meaning |
| --- | --- |
| `operation` | `reset_all` \| `delete_inspection` \| `update_inspection` \| `import_excel` |
| `actor_id` | `users.id` of the authenticated caller, or `NULL` |
| `actor_role` | `users.role`, or `anonymous` |
| `resource` | `mw_inspections` or `mw_inspections#<id>` |
| `affected_count` | rows inserted/updated/deleted by the operation |
| `correlation_id` | UUID, also returned to the caller |
| `detail` | small non-sensitive context (e.g. `{ filename }`, `{ fields }`) |
| `created_at` | timestamp with time zone |

No secrets or authentication material are stored: no cookies, tokens, session
ids, IP addresses or email addresses. A structured, secret-free mirror line is
also written to the application log (`tag: "mw_inspection_audit"`).

The table is backend-only, following the migration-0028 posture exactly: RLS
enabled, **no policy**, `anon`/`authenticated` privileges revoked, `FORCE ROW
LEVEL SECURITY` off.

## 6. Incident rules for agents

- Never make `resetAll` or `deleteInspection` reachable without an authenticated
  OWNER session. Tests in `api/mw-router-authorization.test.ts` fail if a
  destructive procedure regresses to `publicQuery`.
- Never add a whole-table `DELETE`/`TRUNCATE` to an ordinary operational
  workflow. If whole-dataset deletion is genuinely required again, it must be an
  OWNER-only, typed-confirmation, audited operation.
- Never perform a destructive ODM call against production to test containment;
  use `api/mw-router-fake-db.ts` or an isolated database.
- Do not weaken `importExcel` to a destructive shape; it must stay upsert-only.
- The canonical inspection identity is the schema constraint
  `mw_inspections_dedup (asset_tag, task, date, submitted_at)`; the router's
  `onConflictDoUpdate` target must match it (asserted by test).
