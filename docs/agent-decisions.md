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