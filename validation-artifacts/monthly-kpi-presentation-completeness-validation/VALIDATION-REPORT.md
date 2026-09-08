# Monthly KPI Presentation — Data Completeness — Validation Report

Review correction ccb72f3→head: readout writer now captures a pristine bullet
paragraph BEFORE any mutation and clones it fresh for every output line, so
headings get `buNone` while content/neutral lines always keep the donor
bullet (`buChar •`); donor slide XML for later BU clones is also cached
pristine so earlier-BU fills can never leak into later BU slides. XML-level
regression tests verify heading/bullet markers, neutral bullets, multiple note
lines, and no nested `a:r` elements.

Branch: `fix/monthly-kpi-presentation-data-completeness`
Baseline: `9781399` (main incl. PR #417)

## Root causes

1. **Missing/blank Notes-Situation area (Defect 1)**
   - The slides rendered only an inline bullet line and a single combined neutral
     sentence when fields were blank; there were **no visible section headings**
     ("Notes / Commentary", "Situation") and no **per-field neutral lines**, so
     records with only Notes (or only Situation) or neither appeared blank in the
     lower commentary area.
   - Fix: the Executive Readout now always renders two headed sections with the
     stored wording as bullets, plus per-field neutral lines when blank
     ("No commentary submitted." / "No situation submitted."). Only the exact
     effective-month stored record is used (never earlier months, never derived
     threshold/missing-data narrative, no cross-BU leakage).

2. **Monthly actuals in trend charts (Defect 2)**
   - Group B monthly-actual columns existed only when data was available; the
     chart package writes both the `Monthly Actual` (bar) series and the `YTD
     Average` (line) series from per-month standalone values. Any gap was a data
     availability artifact, not a series omission. This work adds explicit
     regression coverage proving the monthly-actual bar series and YTD average
     line are populated into the PPTX chart caches for every submitted month,
     Group A charts contain no fabricated monthly series, lagging BUs stop at
     their last actual month, and values never leak between BUs.

## Validation artifact

`validation-artifacts/monthly-kpi-presentation-completeness-validation/`
- `Monthly KPI Scorecard - All Business Units - August 2026 (completeness).pptx`
  — generated from **real production records** (read-only API, August 2026,
  effective month = August), 1 cover + 2×7 BU slides.
- `render/page-002-AMD-scorecard.png` — neutral headings (AMD Aug: no stored
  notes/situation).
- `render/page-008-LARC-scorecard.png` — LARC Notes section with real stored
  note and Situation section with its neutral line (LARC Aug has no stored
  situation).
- `render/page-009-LARC-trends.png` — LARC Trends: PM Compliance & Facility
  Uptime charts with Monthly Actual columns + YTD Average line.

LARC slide 8 readout XML (real data):
```
Notes / Commentary
  • Budget Spend: Replacement of filters; Facility Uptime: Genset breakdown (Facility Primary Power Supply)
Situation
  • No situation submitted.
```
LARC chart caches (slide 9): PM Compliance Monthly Actual bars Jan–Aug
`[100,100,100,100,100,100,100,100]`; Facility Uptime Monthly Actual bars
`[99.87,99.86,99.96,99.89,99.88,99.96,99.88,99.96]`; categories Jan–Aug; YTD
Average line ends equal to the scorecard YTD card value.

## Checks
- `npm run check` PASS · `npm run build` PASS.
- Deck suite 32/32, template-generator suite 35/35, monthly-kpi suite green
  except pre-existing `visualRecovery.test.ts` (2 tests, same on clean main).
- Full `npm test` failure set compared against clean `origin/main`.
