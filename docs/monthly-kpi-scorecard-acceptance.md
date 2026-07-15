# Monthly KPI Scorecard POTX acceptance report

Date: 2026-07-15

Branch: `agent/apply-scorecard-potx-template`

Draft PR: <https://github.com/estrangender26/odm-dashboard/pull/260>

Overall status: **Pending functional acceptance**

PR #260 must remain draft. Native PowerPoint, generated samples, stress cases,
package integrity, and rendered visual comparison pass. The Presentation Center
UI end-to-end flow is still blocked by the local environment and browser-control
runtime described below.

## Native Microsoft PowerPoint result

All eight decks under `docs/samples/` were opened in Microsoft PowerPoint for
macOS. PowerPoint reported the expected slide counts and exposed every KPI grid
as `shape type table`; no repair sheet or corrupted-content prompt appeared.

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
- title box position, margins, Calibri family, 28 pt size, blue color, and weight
- individual and portfolio table positions and dimensions
- row heights, column widths, cell margins, borders, and alignment
- Aptos Display table typography inherited from the template
- green, amber, red, gray, and white status fills
- source slide master, slide layout, theme, and media bytes

### Acceptable dynamic differences

- Titles contain the selected BU/reporting period instead of the sample title.
  Individual titles use the concise `BU KPI – Month Year` form so they remain on
  one line while retaining the source title style and geometry.
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
does not invent values: the Notifications column is retained and renders
`No Data`. No database schema or KPI formula was changed.

## Presentation Center UI end-to-end blocker

The Vite application serves locally at `http://localhost:3000/`, but the actual
UI generation flow could not be completed in this environment:

1. The required in-app browser runtime fails during import with
   `Cannot redefine property: process`, before a browser can be selected.
2. The local API returns `500 Invalid URL` while importing the auth module
   because the required local authentication configuration is absent. No local
   persisted database configuration is present either.

No secrets were added or guessed. Direct generator calls and unit tests were not
treated as a substitute for the required UI-driven download. This remains the
sole blocking acceptance gate; the PR must stay draft until the app is run with
valid local configuration and both All Business Units and an individual BU are
generated and downloaded through Presentation Center.
