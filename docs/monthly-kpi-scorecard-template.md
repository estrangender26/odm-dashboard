# Monthly KPI scorecard template mapping

The authoritative Monthly KPI design source is
`public/templates/monthly-kpi-scorecard-template.potx`. The generator copies
the Office Open XML package, converts its main content type from PowerPoint
template to PowerPoint presentation, and preserves the source slide master,
layout, themes, table geometry, fonts, borders, legend image, and slide size.

## Template inventory

- Slide size: 12,192,000 × 6,858,000 EMU (13.333 × 7.5 inches).
- Master: `ppt/slideMasters/slideMaster1.xml`.
- Layout used by both source slides: `ppt/slideLayouts/slideLayout12.xml`.
- Themes: `ppt/theme/theme1.xml` and the master-linked theme package parts.
- Embedded legend: `ppt/media/image1.png`.
- Individual-BU source slide: source slide 1.
  - Title: `TextBox 4`.
  - KPI table: `Table 2` (nine rows, eight columns).
  - Commentary: `TextBox 6` (five inherited bullet paragraphs).
- Portfolio source slide: source slide 2.
  - Title: `TextBox 4`.
  - KPI table: `Table 0` (seven rows, seven columns).

## Dynamic mapping

| Monthly KPI data | Template target |
| --- | --- |
| Business unit and reporting period | `TextBox 4` |
| PM Compliance | KPI table column 2 |
| Budget Spend | KPI table column 3 |
| PM:CM Ratio — Work Orders | KPI table column 4 |
| PM:CM Ratio — Cost | KPI table column 5 |
| MTTR | KPI table column 6 |
| Facility Uptime | KPI table column 7 |
| Individual-BU notes, wins, risks, and actions | Slide 1 `TextBox 6` |
| Portfolio business-unit comparison | Slide 2 `Table 0` body rows |

Individual-BU output retains the template's Notifications column because it is
fixed template structure. Monthly KPI records do not contain that measure, so
the generator writes `No Data` rather than inventing a value. Up to five months
fit in each inherited table; longer YTD periods duplicate source slide 1 in
five-month chunks. Portfolio output fits five business units per inherited
matrix and duplicates source slide 2 when more rows are required.

The KPI status result controls only the inherited data-cell fill:

- Passed: `00B050`.
- Warning: `FFC000`.
- Below benchmark: `C00000`.
- No data: `E7EAED`.

All other cell formatting is retained from the template. The final package
contains only the populated output slides; template comments and unused sample
slides are removed.
