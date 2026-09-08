# Monthly KPI — Executive Commentary / Management Assessment Enhancement — Validation

Branch: `feat/monthly-kpi-executive-readout` · Base main `564ebc10c00838186daf8dd23ea639e0c3db5121`

## What changed
The visible Monthly KPI readout now shows derived management-quality sections
instead of the raw stored headings:

- **EXECUTIVE COMMENTARY** — "what happened and what the BU says explains it"
  (material red → amber KPI exceptions + concise reference to the BU's own
  submitted Notes).
- **MANAGEMENT ASSESSMENT** — "what management should understand/do"
  (evidence-bound actions, required validation, follow-up).

100% deterministic rules (no external LLM): statuses come from the SAME
threshold config as the scorecard colours; identical inputs ⇒ identical
output. Stored `monthly_kpi_records.notes/situation` are authoritative and
were never modified.

Shared builder: `src/modules/monthly-kpi/executiveReadout.ts`
(`buildExecutiveReadoutLines`), used by BOTH the single-BU generator
(`monthlyKpiGenerator.ts`) and the All-BU generator
(`allBusinessUnitsDeck.ts`) with each BU's own YTD values + Notes at the
server-effective month (Aug 2026). Reader/writer geometry (PR #420 wrap
protection + `<a:normAutofit/>`) unchanged.

## Effective month / source values (Aug 2026, read-only)
Requested Sep 2026 → effective Aug 2026. Values per BU are the YTD values used
by the scorecard (same aggregation authority); Notes come from
`monthly_kpi_records` at (BU, 2026-08). Example sources:
- CWC note: `Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44`
- LARC note: `Budget Spend: Replacement of filters; Facility Uptime: Genset breakdown (Facility Primary Power Supply)`
- AMD-EZ notes/situation: NULL

## Resulting readouts (word counts: EC / MA, each ≤ 45; bullets ≤ 2 each)
| BU | EC words | MA words | bottom EMU (slide 6,858,000) | normAutofit |
|---|---|---|---|---|
| AMD-EZ | 21 | 27 | 6,577,275 | yes |
| CWC | 35 | 16 | 6,577,275 | yes |
| EWG | 37 | 20 | 6,577,275 | yes |
| LARC | 37 | 19 | 6,577,275 | yes |
| LAWC | 25 | 16 | 6,387,275 | yes |
| TWCI | 43 | 26 | 6,718,000 | yes |
| WAWA/JVC | 33 | 21 | 6,577,275 | yes |

Single-BU CWC slide 1 readout is byte-identical in content to the All-BU CWC
summary slide (parity proven). QuickLook render of the single-BU slide shows
**6 visible dark text bands** in the readout region (2 headings + 4 bullets),
mean luminance 239.6 (dark on white). TWCI (the long-source stress case,
1,147-char note) produces a 43-word EC + 26-word MA — summarized, on-slide,
with the normAutofit safety net, never clipped.

## Package integrity
All-BU (217 parts, 76 rels, 15 slides) and single-BU decks (67 parts): audit
`audit_ok=True` (XML parses, rels resolve, no duplicates, no nested runs,
valid buNone/buChar order, content types OK).

## Tests
- `src/modules/monthly-kpi/executiveReadout.test.ts` (11) — bullet limits,
  word budgets, long-note compression (TWCI), evidence safety (AMD-EZ: no
  invented cause; "Confirm whether…"), red-over-amber prioritisation, green
  omission, determinism, heading set, classifier/formatter.
- Updated deck suites (`templateGenerator.test.ts`, `allBusinessUnitsDeck.test.ts`)
  assert every BU summary readout equals the deterministic builder output,
  formatting (172B47 headings / 111111 bullets / Aptos), per-section word and
  bullet caps, and value-token no-leakage between sections.
- Full suite: failure set identical to `origin/main` (zero regressions).

## Scope guard
No KPI formula/threshold/monthly-YTD/effective-month/BU-mapping/chart/table
logic changed; no DB/schema/storage changes; PR #421 untouched; no production
writes (read-only records used; decks generated locally).
