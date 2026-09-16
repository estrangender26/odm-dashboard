# Agent Decisions — ODM Dashboard

This file records intentional product/design decisions so coding agents do not repeatedly treat them as bugs.

## Monthly KPI Summary Matrix

Decision:
Schedule Compliance (%) and MTBF (Days) are intentionally excluded from the Monthly KPI Summary Matrix.

Context:
These KPIs may exist in import, aggregation, gauges, trends, or backend records, but they should not be added to the Summary Matrix unless Gerald explicitly requests it later.

Agent rule:
If a KPI exists in data/import logic but is hidden from a specific UI section, ask whether the exclusion is intentional before recommending a UI fix.

## General Product Intent Rule

Before changing visible UI behavior, table columns, KPI visibility, dashboard layout, or export structure, inspect the current implementation and ask whether the behavior is intentional when there is ambiguity.

## Projects without PPP — Masterdata Submittal Monitoring

Decision:
This is a monitoring dashboard, not a project CRUD portal. The 50-project population is OWNER-controlled authoritative data (bootstrap-only, no normal-user create/edit/delete). Masterdata submission status ("Submitted"/"Not Submitted") is always DERIVED from actual current submission files (`project_without_ppp_files` with `superseded_at IS NULL`); there is no manually editable status column and no manual completion percentage.

Context:
PR #389 implemented the wrong product (full project CRUD with demo data) and was reverted via PR #390. The inert production tables from PR #389 remain and are reused additively by migration 0031.

Agent rule:
- Do not add project create/edit/delete controls, masterdata-category configuration, or manual status/completion editing to this module.
- KPI counts projects (not files): two files on one project still count as one Submitted project.
- Reference-data updates through the bootstrap must never delete submission/file history.
- Public file deletion for this module is forbidden; removal of current evidence is the admin-only `supersede` flow (history preserved).

## Operator-Driven Maintenance — destructive operations are OWNER-only and audited

Decision:
The ODM (`mw.*`) inspection procedures have an explicit authorization boundary: reads (`listInspections`, `getInspection`) are anonymous; `importExcel` is deliberately anonymous because it is the module's only data-entry path and is upsert-only; `updateInspection` is `authedQuery`; `deleteInspection` and `resetAll` are OWNER-only (`adminQuery`), and `resetAll` additionally requires the exact typed phrase `DELETE ALL ODM INSPECTIONS`. The dashboard's **Clear control has been removed entirely** — the page has no Clear button, no click handler and no local-clear plumbing, leaving Refresh (read-only) as its only control that acts on data. Every ODM write records an `mw_inspection_audit` row in the same transaction as the mutation.

Context:
On 2026-09-16 production `mw_inspections` dropped from 16,543 rows (measured 2026-09-11) to 2,372 rows. Read-only Render logs attributed it to a single anonymous `POST /api/trpc/mw.resetAll` at 2026-09-16T03:38:38.741Z — `mw.resetAll` was then an unauthenticated `DELETE FROM mw_inspections` wired to the dashboard's Clear button, `deleteInspection`/`updateInspection` were public too, and no audit record of any operation existed. Full analysis: `docs/odm-inspection-authorization.md`.

Agent rule:
- Never regress a destructive ODM procedure to `publicQuery`; `api/mw-router-authorization.test.ts` fails if you do.
- Never add a data-clearing control (Clear / Delete / Reset) to `public/mw-dashboard.html`; the containment test fails if `clearDataBtn`, `clearStorage`, `clearLocalCopy`, `clearStorageUI`, `LS_FILENAME` or `btn-ghost-warn` reappear.
- Never add whole-table DELETE/TRUNCATE to an ordinary operational workflow. Whole-dataset deletion, if ever needed again, is an OWNER-only, typed-confirmation, audited operation.
- Never test destructive containment against production; use `api/mw-router-fake-db.ts` or an isolated database.
- `importExcel` must stay upsert-only. Making it authenticated is an OWNER decision (it requires a login affordance on the dashboard first).
- The canonical inspection identity is `(asset_tag, task, date, submitted_at)`; the router's conflict target must match the schema constraint.
