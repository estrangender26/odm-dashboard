# Monthly KPI Presentation — Stored Notes / Situation data source — Visual Validation Report

Branch: `fix/monthly-kpi-commentary-situation` (PR pending)
Baseline: `de35fd4` (main after PR #414)

## Goal

Slide 1 ("Monthly Reliability KPI Scorecard, [BU]") commentary bullets must come
**only** from the authoritative stored `notes` and (new) `situation` fields of
the exact BU + reporting month record — never from threshold/missing-data
narrative ("Key exceptions", "not submitted", etc.).

## What changed (summary)

- **Schema/migration (committed only, not executed):**
  `db/migrations/0038_monthly_kpi_situation.sql` adds nullable `situation TEXT`
  to `monthly_kpi_records`; `db/schema.ts` gains `situation`; journal entry 0038
  added; startup `ensureMonthlyKpiSituationColumn()` mirrors the existing
  `notes` ensure for defense-in-depth.
- **Persistence:** `api/boot.ts` import upsert / PATCH / list / aggregate SQL now
  round-trip `situation`; the normalizer maps `Situation/situation` → `situation`
  and `Notes/notes/commentary` → `notes` (trim + line-end normalization only).
- **Dashboard input (scorecard-kpi.html):** Summary workbook header `Situation`
  maps to the stored field; the monthly records table shows stored Situation
  first (derived data explanations only as fallback); manual entry gained a
  Situation textarea that saves with the record.
- **Presentation builders:** All-BU (`allBusinessUnitsData.ts`) now reads
  `notes` + `situation` only from the effective-month record (earlier months
  never reused; blank ⇒ null). The derived helper was renamed
  `deriveMissingDataReasons()` and is **no longer** surfaced as Situation. The
  Single-BU generator (`monthlyKpiGenerator.ts`) uses the same stored fields via
  the shared `commentaryBulletsFromStored()` helper, replacing the old
  exception narrative.
- Blank + blank ⇒ single neutral bullet:
  `No commentary or situation recorded for the reporting period.`

## Production read-only verification (no writes)

`GET https://odm-dashboard.onrender.com/api/monthly-kpi/records?reporting_year=2026`
(HTTP 200, read-only):

- **AMD-EZ / August 2026:** `notes = null`, `raw_imported_values.values.notes = null`, no `situation` key (column not yet deployed) ⇒ generated Slide 1 today correctly shows the neutral placeholder (no fabricated commentary).
- No record anywhere carries a `situation` value (field is introduced by this PR and stays NULL for existing records).
- Real stored Notes exist for August 2026 at **CWC**, EWG, LARC, LAWC, TWCI, WAWA/JVC (multi-KPI wording preserved). CWC August:
  "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44"

## Rendered validation (PowerPoint → PDF → PNG)

Fixture deck: `validation-artifacts/monthly-kpi-mw-clone-validation/Monthly KPI Scorecard - All Business Units - August 2026 (MW clone).pptx`
(regenerate: `node --import tsx scripts/monthly-kpi-allbu/generate-validation-fixture-deck.mts`)

| Page | BU slide | Readout bullets (from PPTX XML) | Rendered band |
|---|---|---|---|
| page-002.png | AMD-EZ Scorecard | `No commentary or situation recorded for the reporting period.` (prod-like blank) | title 0.24–0.57 · table 0.81–5.32 · readout 5.65–6.62 · logo 7.09–7.23 |
| page-004.png | CWC Scorecard | `Notes: Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44` (real prod wording) + `Situation: Media replacement ... completed inside the August window. (fixture-only demo ...)` | identical geometry |
| page-006.png | Tagum Water Scorecard | neutral placeholder (no August record commentary; June text not relabeled) | identical geometry |

- Commentary/readout area renders; bullets do not overlap the RAG legend (legend x≥9.73) or the lower-right Manila Water logo (band 7.09–7.23 preserved); scorecard table geometry unchanged from the master clone.
- Blank state renders the neutral line; stored Notes/Situation render verbatim with Notes:/Situation: labels.
- Notes/Situation never come from thresholds/missing data: XML + render show no "Key exceptions"/"not submitted" bullet content on Slide 1.

## Tests

- Deck suite (`allBusinessUnitsDeck.test.ts`): stored Notes/Situation sourcing,
  exact effective month, no earlier-month reuse, no cross-BU leakage, no Notes
  invention, no derived Situation, neutral-only-when-both-blank, missing-data
  phrases never treated as Situation (reasons covered under the explicitly named
  `deriveMissingDataReasons`), stored text trimming/normalization.
- Single-BU (`templateGenerator.test.ts`): stored bullets render; neutral when
  blank; RAG colors never generate narrative.
- API (`monthly-kpi-records.test.ts`): Situation round-trips through the import
  upsert, PATCH, list and aggregate SQL; normalizer aliases locked.
- Dashboard acceptance (`monthly-kpi-presentation.test.ts`): Situation import
  mapping + manual textarea + stored-first column covered.
- `npm run check` PASS · `npm run build` PASS · full `npm test` failure set
  identical to clean `origin/main` (pre-existing 16 files / 25 tests).
