# Migration 0039 — Maintenance Planning (Post-PPP) Decommission Manifest

**Modules removed:** "Maintenance Planning (Post-PPP)" and
"Post-Planning Insights & Action Plan".
**Environment inspected:** production Supabase project `hpfcwqyoxbndfwzbhrbz`
(odm-dashboard), reached through the Render service's own `DATABASE_URL`.
**Inventory date:** 2026-09-11.
**Migration:** `db/migrations/0039_decommission_maintenance_planning.sql`.

## 1. Deletion manifest

| OBJECT | TYPE | MODULE OWNER | CURRENT ROW COUNT | FK DEPENDENCIES | INBOUND REFERENCES | OUTBOUND REFERENCES | RUNTIME CODE REFERENCES | OTHER MODULE REFERENCES | BACKUP METHOD | PROPOSED ACTION | REVERSIBILITY | DRY-RUN RESULT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `public.tasks` | table | Maintenance Planning (Post-PPP) + Post-Planning Insights & Action Plan | 1376 (975 `htt`, 401 `aglipay`) | none (no `tasks.equipment_id` FK ever declared) | none | none | `api/tasks-router.ts`, `api/tasks-import.ts`, `api/tasks-duplicate-cleanup.ts`, `api/seed-router.ts`, `db/seed.ts`, `db/seed-governance.ts`, `api/queries/connection.ts`, `api/boot.ts`, `src/pages/Dashboard.tsx`, `src/pages/PostPlanningInsights.tsx` — all deleted or edited in this change set | none | gzipped JSON row export (sha256 verified) + documented `pg_dump` equivalent | **DELETE** | Recreatable from backup; schema reproducible from this migration's recovery doc | PASS — `DROP TABLE public.tasks` executed inside `BEGIN … ROLLBACK`; 0 relations remained in-transaction, rows restored on rollback |
| `public.equipment` | table | Maintenance Planning (Post-PPP) + Post-Planning Insights & Action Plan | 127 | none | none | none | `api/tasks-router.ts`, `api/tasks-import.ts`, `api/tasks-duplicate-cleanup.ts`, `api/seed-router.ts`, `db/seed.ts`, `db/seed-governance.ts` — all deleted or edited in this change set | none | gzipped JSON row export (sha256 verified) + documented `pg_dump` equivalent | **DELETE** | Recreatable from backup; schema reproducible from this migration's recovery doc | PASS — same dry-run transaction |
| `public.tasks_id_seq` | sequence | same | n/a | owned by `tasks.id` | n/a | n/a | via `serial` default only | none | included in row export high-water mark (max id 1376) | **DELETE** (dropped with the table) | Recreated by `serial` on restore + `setval` | PASS — 0 sequences remained in-transaction |
| `public.equipment_id_seq` | sequence | same | n/a | owned by `equipment.id` | n/a | n/a | via `serial` default only | none | included in row export high-water mark (max id 127) | **DELETE** (dropped with the table) | Recreated by `serial` on restore + `setval` | PASS — same |
| `tasks_pkey`, `tasks_equipment_idx`, `tasks_dataset_idx`, `tasks_familiarity_idx` | indexes | same | n/a | belong to `tasks` | n/a | n/a | none | none | schema captured in recovery doc | **DELETE** (dropped with the table) | Recreated from recovery doc / `pg_dump` | PASS |
| `equipment_pkey`, `equipment_name_idx` | indexes | same | n/a | belong to `equipment` | n/a | n/a | none | none | schema captured in recovery doc | **DELETE** (dropped with the table) | Recreated from recovery doc / `pg_dump` | PASS |
| RLS enablement on `tasks` / `equipment` (migration 0028, 0 policies) | RLS state | same | n/a | n/a | n/a | n/a | none | none | documented in recovery doc | **DELETE** (falls away with the tables) | Re-appliable if tables are ever restored | PASS |
| `public.smp_task_applicability.task_id` → `public.smp_tasks(id)` | column + FK | Standard Maintenance Procedures | `smp_task_applicability` 0, `smp_tasks` 0 | FK to `smp_tasks` | n/a | n/a | SMP module only | **retained module** | n/a | **KEEP** | n/a | n/a — verified the FK targets `smp_tasks`, not `public.tasks` |
| `public.existing_facilities_maintenance` | table | Existing Facilities / ODM | 15608 | none | none | none | `db/schema.ts` only | **retained** | n/a | **KEEP** | n/a | n/a |
| `public.mw_inspections`, `mw_compliance`, `mw_escalations` | tables | Operator-Driven Maintenance | 16543 / — / — | none | none | none | `api/mw-router.ts`, `api/boot.ts` | **retained** | n/a | **KEEP** | n/a | n/a |

## 2. Objects searched for and confirmed absent

The following object classes were checked in **all** non-system schemas and none
reference `public.tasks` or `public.equipment`:

| Object class | Query basis | Result |
| --- | --- | --- |
| Foreign keys (inbound and outbound) | `pg_constraint` `contype='f'` | 0 rows |
| Views | `pg_class relkind='v'` via `pg_depend` | 0 rows |
| Materialized views | `pg_class relkind='m'` via `pg_depend` | 0 rows |
| Functions / procedures | `pg_proc.prosrc` match | 0 rows |
| Triggers | `pg_trigger` on the two tables | 0 rows |
| RLS policies | `pg_policy` | 0 policies (RLS enabled, no policy) |
| Check constraints / defaults on other tables mentioning them | `pg_constraint contype='c'` | 0 rows |
| Storage buckets | `storage.buckets` / `api/storage-router.ts` module flags | neither module uploads; storage modules are `om`, `governance`, `smp`, `projects_without_ppp` |
| Scheduled jobs | repo `cron/` and `api/boot.ts` schedulers | none owned by either module |

## 3. Production table inventory (context)

At inventory time `public` held 41 ordinary tables and 40 sequences (81
relations in total; no views, materialized views, or partitioned tables).

Two of those tables are the decommission targets. The dry-run confirmed the
arithmetic exactly: with both `DROP TABLE` statements applied inside the
transaction, `pg_tables` reported **39** remaining `public` tables (41 − 2), and
after `ROLLBACK` both tables were present again with their original row counts.

## 4. Backup record

| Field | Value |
| --- | --- |
| Timestamp (UTC) | recorded in the artifact manifest (`exportedAtUtc`) |
| Source environment | production Render service `srv-d7dokmgvqtc73ck8490` → Supabase Postgres 17.6 |
| Objects | `public.tasks` (1376 rows), `public.equipment` (127 rows) |
| Row counts verified against | live `count(*)` before and after export |
| Backup location | operator workspace only — **never committed to Git** |
| Checksum | `sha256` of the gzipped artifact, recorded in the manifest and verified after download |
| Recovery method | `helpers/0039_decommission_maintenance_planning_recovery.md` |

## 5. Dry-run evidence

Executed against production before deployment:

```sql
BEGIN;
DROP TABLE public.tasks;
DROP TABLE public.equipment;
-- in-transaction probes
ROLLBACK;
```

| Probe | Result |
| --- | --- |
| `tasks` rows before drop | 1376 |
| `equipment` rows before drop | 127 |
| relations named `tasks`/`equipment` remaining in-transaction | 0 |
| sequences `tasks_id_seq` / `equipment_id_seq` remaining in-transaction | 0 |
| `tasks` rows after `ROLLBACK` | 1376 (unchanged) |
| `equipment` rows after `ROLLBACK` | 127 (unchanged) |
| relations after `ROLLBACK` | 2 (both restored) |

No dependency error occurred, so no retained module blocks the drop.

## 6. Classification summary

- **DELETE:** `public.tasks`, `public.equipment` (and their indexes, primary
  keys, sequences, and RLS state).
- **KEEP (shared):** `public.smp_tasks` / `public.smp_task_applicability`
  (SMP owns its own task table — the shared name `task_id` is *not* a reference
  to `public.tasks`), `public.existing_facilities_maintenance`,
  `public.mw_*`, and every other retained table.
- **UNKNOWN:** none.
