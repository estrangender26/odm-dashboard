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

## Primavera Lite — Progress Updating, Data Date and Schedule Statusing

Decision:
Statusing is a **recorded-fact** workflow, not a P6 clone. Execution truth lives in `gantt_activities.actual_start` / `actual_finish`; the project status boundary lives in `gantt_projects.data_date`; forecast effort lives in `remaining_duration_days`; `percent_complete` is the single progress percentage. Activity lifecycle (not-started / in-progress / completed) is **derived** from those facts by `progressModel.deriveProgressState` and is never hand-maintained — the stored `status` column only ever receives the derived value.

Rules frozen for the statusing feature:
- `data_date` is explicit and project-controlled. It is never auto-advanced, and a missing Data Date is surfaced as a notice instead of being silently replaced by today's date (Run Schedule still falls back to the current date for backward compatibility, and the workspace says so).
- Actual Start / Actual Finish are execution facts: schedule recalculation never moves them, and the engine returns new objects rather than mutating inputs.
- A stored `remaining_duration_days` of **0 is not a forecast**. The column is `NOT NULL DEFAULT 0`, so 0 is what every row carries until someone records a real value. Reading it as "no work left" silently collapsed in-progress activities to zero duration (`ES === EF`, false critical path); the engine and `deriveRemainingDuration` now treat an in-progress activity's remaining work as at least 1 working day unless an explicit positive value is stored, and `resolveProgress` rejects an explicitly supplied 0 for in-progress work (V10) while leaving legacy rows with a stored 0 fully editable.
- Lifecycle, remaining forecast and the statusing roll-up are computed by `src/modules/gantt/primavera-lite/statusingModel.ts`, which delegates duration to the scheduling engine's own `getWorkingDuration` so the panel and Run Schedule can never disagree.
- The statusing roll-up is read-only for every role; changing the Data Date stays admin-only; progress edits stay editor-or-admin and continue to go through the existing `updateActivity` mutation, optimistic-concurrency check and audit event.

Context:
An architecture review found that the persistence layer, the API (`updateActivity` → `resolveProgress`) and the engine already modelled progress, but there was no way to enter or see Remaining Duration in the UI, no derived status or statusing roll-up anywhere, and the stored-zero defect above meant recorded progress produced a collapsed, falsely critical schedule.

Agent rule:
- Do not add a second progress percentage system, a second status vocabulary, or a parallel mutation path for progress.
- Do not make recalculation rewrite actual dates, and do not let a missing Data Date be silently replaced by wall-clock today.
- If the UI needs another statusing field, extend the focused progress panel rather than appending permanent ActivityGrid columns.

## Primavera Lite — Baseline Management and Schedule Variance

Decision:
A baseline is an **immutable approved reference schedule**, stored as a snapshot pair (`gantt_baselines` + `gantt_baseline_activities`, migration 0030) that is deliberately detached from live activities and WBS nodes. Variance is always **derived** — frozen baseline versus current schedule output — by `src/modules/gantt/primavera-lite/baselineVariance.ts`, which is shared by the server and the UI so there is exactly one implementation and one sign convention. Establishing a baseline never changes scheduling, progress or execution truth, and the baseline comparison is presented as **Baseline** versus **Current / Forecast**; forecast dates are never called actuals.

Rules frozen for baseline management:
- One **active** baseline per project: the most recently captured one (`gantt_baselines.id`, a serial, is the deterministic tiebreaker). Capture is append-only, so replacing a baseline ("re-baseline") preserves the previous one as history — nothing is overwritten, and every capture is audited (`gantt_project_events`, `entityType = "baseline"`, `action = "capture"`).
- Establishing a baseline is a controlled action: admin-only (`requireAdmin`), behind an explicit confirmation in the UI, never automatic on project creation, Run Schedule, Data Date change, progress update or page load, and concurrency-protected by the existing `expectedRevision` check under `lockProject` (`SELECT … FOR UPDATE`). The whole snapshot is written in one transaction, so a half-written baseline cannot exist.
- A baseline requires a **fresh, successfully calculated schedule** (F-08), and the freshness check is read inside the same transaction as the comparison, so variance can never be presented against a stale schedule.
- **Date variance is measured in CALENDAR days** (`current − baseline`, positive = later) because that is the shipped `compareBaseline` contract; **duration variance is measured in WORKING days**, because Primavera Lite durations are working-day quantities. Each metric uses the application calendar semantics, never a raw timestamp subtraction.
- Variance is never fabricated: an activity added after the baseline has **no** baseline dates and `null` variance (never 0), and a baseline activity removed since the baseline keeps its approved history and reports `null` current values.
- Activity identity is the stable internal `activityId`. Names and activity codes are carried for readability only and are never a join key, so a rename, recode or WBS move is not variance.
- An **archived** activity is not part of the current schedule (Run Schedule excludes archived rows), so it is reported as removed/archived since the baseline with `null` variance rather than being compared against its stale leftover dates.
- The baseline comparison lives in the focused `BaselinePanel` surface; permanent ActivityGrid columns were deliberately not added.
- Baseline capability introduced **no schema change**: the project-level approved start/finish are derived (min/max over the frozen snapshots) and the current project finish reuses `statusingModel.summarizeStatusing().projectFinish`, so the application keeps exactly one definition of "project finish".

Context:
An audit for this workstream found that capture/list/compare already existed on `main` (`captureBaseline`, `listBaselines`, `compareBaseline`, `BaselinePanel`) with start and finish variance, but there was no duration variance, no project-level comparison, no explicit representation of work added after the baseline, and no documented sign or calendar semantics. Rather than build a second baseline concept, the existing Option-B snapshot architecture was kept and extended with a shared derived variance layer; per-activity `startVariance`/`finishVariance` behaviour, field names and the freshness gates are unchanged.

Agent rule:
- Do not introduce a second baseline store, a second variance implementation, or a second sign convention; both server and UI must use `baselineVariance.ts`.
- Do not let baseline state reach the scheduling engine: variance is derived from frozen baseline + current schedule output, never an input to CPM.
- Do not mutate, overwrite or delete a captured baseline; replacing one means capturing a new one.
- Do not fabricate baseline dates or a zero variance for an activity that has no baseline.
- Do not label a forecast date as an actual, and do not compare actuals against a baseline and call it schedule variance.
