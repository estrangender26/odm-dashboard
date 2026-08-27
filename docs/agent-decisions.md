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
