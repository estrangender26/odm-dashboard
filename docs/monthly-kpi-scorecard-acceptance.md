# Monthly KPI Scorecard POTX acceptance report

Date: 2026-07-15

Branch: `agent/apply-scorecard-potx-template`

Draft PR: <https://github.com/estrangender26/odm-dashboard/pull/260>

Overall status: **Functional acceptance passed; PR remains draft for owner review**

Native PowerPoint, generated samples, stress cases, package integrity, rendered
visual comparison, and the Presentation Center UI end-to-end flow pass. PR #260
was intentionally left as a draft; no merge or deployment was performed.

## Native Microsoft PowerPoint result

All eight decks under `docs/samples/`, plus both decks under
`docs/samples/ui-acceptance/`, were opened in Microsoft PowerPoint for macOS.
PowerPoint reported the expected slide counts and exposed every KPI grid as
`shape type table`; no repair sheet or corrupted-content prompt appeared.

The AMD-EZ individual deck was copied to a temporary file and its title was
edited in PowerPoint, saved, closed, and reopened. The edited title persisted.
After reopening, PowerPoint reported:

- title font: Calibri, 28 pt
- table: native PowerPoint table shape
- slide master: 960 × 540 points
- repair/corruption sheets: 0

The generated packages retain the source slide master, layout, Office theme,
logo/media relationship, and editable DrawingML text/table objects. Calibri and
Aptos font assets are present in the installed Microsoft PowerPoint application.

The two exact UI-downloaded decks were also copied to temporary files. Their
titles were edited in PowerPoint, saved, closed, and reopened. Both edits
persisted. After reopening, PowerPoint reported Calibri 28 pt titles, native
editable table shapes, a 960-point-wide slide master, and zero repair sheets:

- Clark Water: 3 slides; table has 9 rows and 8 columns.
- All Business Units: 2 slides; table has 7 rows and 7 columns.

## Individual business-unit samples

The following deterministic acceptance decks were generated from
`scripts/generate-monthly-kpi-acceptance-samples.ts`:

- `monthly-kpi-scorecard-amd-ez-may-2026.pptx`
- `monthly-kpi-scorecard-laguna-water-may-2026.pptx`
- `monthly-kpi-scorecard-clark-water-may-2026.pptx`
- `monthly-kpi-scorecard-larc-may-2026.pptx`

For each deck, the title, selected BU, month/year, monthly/YTD KPI values,
benchmarks, PM:CM percentage and equivalent ratio, MTTR day units, Facility
Uptime `=100%` target, and BU-specific commentary match the checked-in fixture
source. No portfolio rows appear in the individual-BU decks. Null fixture values
render as `No Data`; non-null zero values remain zero.

## Stress and continuation results

- Long commentary: the AMD-EZ stress deck uses four slides. Long notes,
  paragraphs, multiple comments, and a long unbroken phrase are split into
  bounded bullet chunks. Every continuation chunk is explicitly marked
  `(continued)`; content is not silently removed. Empty bullet markers are
  suppressed.
- More than five months: the 12-month AMD-EZ deck uses three slides labeled
  `Jan–May`, `Jun–Oct`, and `Nov–Dec 2026`. Each month appears once in source
  order.
- More than five BUs: the 12-BU portfolio deck uses three slides. Each BU appears
  once in source order, including non-canonical fixture BUs.
- All continuation slides inherit the same POTX master, layout, footer legend,
  table geometry, borders, colors, and native table structure. Commentary-only
  continuation slides keep the template table but leave data rows blank so KPI
  rows are not duplicated.
- PowerPoint package validation parsed every XML and relationship part in all
  eight sample decks. Render-based overflow checks passed every sample slide.

## Side-by-side visual comparison

Compared against `/Users/gcb/Documents/scorecard/Scorecard template.potx`.

### Exact matches

- 13.333 × 7.5 inch (960 × 540 point) widescreen slide size
- white background and source master artwork
- logo/media asset and bottom status legend
- title box left/top position and margins, Calibri family, 28 pt size, blue
  color, and weight
- individual and portfolio table positions and dimensions
- row heights, column widths, cell margins, borders, and alignment
- Aptos Display table typography inherited from the template
- green, amber, red, gray, and white status fills
- source slide master, slide layout, theme, and media bytes

### Acceptable dynamic differences

- Titles contain the selected BU/reporting period instead of the sample title.
  The cloned title box retains the source left/top position, height, margins,
  and typography but extends to the existing right slide margin so dynamic
  continuation titles remain on one line.
- Table values, status fills, blank continuation rows, and commentary are data
  driven.
- Continuation page numbers and period ranges are added when the data exceeds a
  template page.
- Commentary-only continuation pages intentionally show a blank KPI grid rather
  than duplicating data rows.

### Remaining visual mismatches

No generated-only visual mismatch was observed after the title and continuation
fixes. The narrow template columns themselves wrap `Notifications` and
`DOWNWARD`; the generated slides inherit that existing template behavior.

## Notifications limitation

The Monthly KPI data model has no persisted Notifications field. The generator
does not invent values: the individual-BU template retains the Notifications
column and renders `No Data`. The source portfolio template has no Notifications
column, so the portfolio generator does not add one. No database schema or KPI
formula was changed.

## Presentation Center UI End-to-End Acceptance

Result: **Passed**

The application was started through its normal Vite development command with an
explicit, development-only fixture mode:

```bash
VITE_MONTHLY_KPI_UI_ACCEPTANCE_MODE=true npm run dev
```

The mode is disabled by default, requires `import.meta.env.DEV`, refuses to run
when `import.meta.env.PROD` is true, and does not read or write authentication,
database, uploaded-deck history, or generated-deck history APIs. A visible UI
banner identifies the mode. It supplies deterministic representative 2026
Monthly KPI records but still exercises the real Presentation Center form,
registered Monthly KPI generator, POTX processor, browser Blob download, and
generated-history UI path. No production credentials or data were used.

### Browser runtime root cause and fix

The `Cannot redefine property: process` exception did not originate in ODM
Dashboard, Vite, JSZip, or the POTX processor. The bundled Codex in-app browser
client unconditionally assigned its process shim to `globalThis.process` and
`globalThis.global.process`. The Node-backed browser-control host already
exposes a frozen, non-configurable `process` property, so that external client
failed during import before it could select a browser.

For this local acceptance run only, the cached external browser client was
patched to use module-scoped `process` and `global` shims and to assign global
properties only when they are absent. No application source, production bundle,
or PR artifact globally redefines `process`. Re-importing the browser client and
controlling the Presentation Center page verified the operational regression.
Because the defect is outside this repository and the previous ODM commit never
performed the offending assignment, a repository test that fails on the prior
ODM implementation would be misleading; the external tooling patch is not
included in PR #260.

### UI-generated results

- Portfolio: selected `2026`, `May`, `All Business Units`, and
  `Executive Scorecard` in the real modal, clicked its `Generate PPTX` control,
  received the browser download, and saw the generated item in Presentation
  Center history. The exact artifact is
  `docs/samples/ui-acceptance/monthly-kpi-ui-portfolio-may-2026.pptx`.
- Individual BU: selected `2026`, `May`, `Clark Water`, and
  `Executive Scorecard` in the real modal, clicked its `Generate PPTX` control,
  received the browser download, and saw the generated item in Presentation
  Center history. The exact artifact is
  `docs/samples/ui-acceptance/monthly-kpi-ui-clark-water-may-2026.pptx`.

Both artifacts came from the POTX path: the source master, theme, and legend
image hashes are identical to the checked-in POTX. The portfolio deck has two
slides with all six fixture BUs exactly once. The Clark Water deck has three
slides, the correct January-May/YTD values and ratios, Clark-specific
commentary, `No Data` Notifications, and no other BU rows. Benchmark labels,
MTTR day units, Facility Uptime `=100%`, slide ordering, and continuation labels
are correct. Every XML/relationship part parses, render-based overflow checks
pass, and full-size inspection of all five slides found no generated-only visual
mismatch. A title-box regression test covers the continuation-title wrap found
during this review.

Both exact downloads opened in native Microsoft PowerPoint without repair
prompts. Native edit/save/close/reopen checks passed, and PowerPoint exposed the
grids as editable table shapes with the expected row and column counts. Text,
master, theme, template media, and native table structure remain intact.

### Remaining limitations

- The safe acceptance mode validates the complete frontend generation/download
  path without production credentials; it does not validate a live authenticated
  database session.
- The portfolio source template has no Notifications column. Notifications stay
  `No Data` only where that column exists in the individual-BU template.
- The browser-host compatibility patch is local external tooling and is not part
  of PR #260. The ODM application and its production build contain no global
  `process` redefinition.
