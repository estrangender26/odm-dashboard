# Monthly KPI — All Business Units deck (Manila Water master clone) — Visual Validation Report

Generated: 2026-09-07
Branch: `fix/monthly-kpi-allbu-mw-scorecard-visual`
Baseline commit: `dcc2edb` (origin/main, PR #413 merged)

## Master visual reference

| File | Slide | Role |
|------|-------|------|
| `Monthly KPI Executive Scorecard - August 2026-15.pptx` (uploaded master) | 1 | Authoritative "Monthly Reliability KPI Scorecard, AMD-EZ" Manila Water slide |
| `src/modules/executive-presentations/templates/MonthlyKpiAllBuExecutive.pptx` (new, committed) | 2 | Scorecard DONOR — byte-copy of the same master slide used by the single-BU deck (`MonthlyKpiExecutive.pptx` slide 1) |

Investigation finding: the uploaded master deck's AMD-EZ slide is produced from the *same* committed master slide that the single-BU generator already clones/updates
(`MonthlyKpiExecutive.pptx` slide 1 — identical shapes, table frame name `AMD-EZ Monthly KPI Scorecard`, `Slide Title`, `RAG Legend`, `Executive Readout`, `TextBox 1`, layout `slideLayout12`, master background `image1.jpeg` carrying the lower-right Manila Water mark). The new All-BU generator therefore clones that committed master slide XML once per BU and replaces only dynamic content.

## Files in this folder

| File | Description |
|------|-------------|
| `Monthly KPI Scorecard - All Business Units - August 2026 (MW clone).pptx` | Validation deck (fixture data, 3 BUs, effective August 2026) |
| `render/page-001.png … page-007.png` | PowerPoint-rendered slides (cover, AMD-EZ, AMD-EZ Trends, Clark Water, Clark Water Trends, Tagum Water, Tagum Water Trends) |

Regenerate the deck with `node --import tsx scripts/monthly-kpi-allbu/generate-validation-fixture-deck.mts`.

## Geometry comparison — generated AMD-EZ Scorecard vs uploaded master AMD-EZ slide

Measured from the OOXML (EMU → inches). `-15.pptx` slide 1 vs validation deck slide 2:

| Element | Master (-15) | Generated (AMD-EZ) | Match |
|---|---|---|---|
| Slide Title off/ext (x,y,w,h) | 0.333, 0.188, 12.667, 0.396 | identical | ✅ |
| Scorecard table off/ext | 0.333, 0.812, 12.667, 4.510 | identical | ✅ |
| Table column widths (in) | 1.542, 1.771, 1.875, 2.24, 2.188, 1.562, 1.49 | identical | ✅ |
| Table row heights (in) | 0.625, 8×0.385, 0.438 (YTD), 0.365 (TARGET) | identical | ✅ |
| Table row count | 11 (Month + Jan..Aug + YTD + TARGET) | 11 | ✅ |
| RAG Legend | 9.730, 5.651, 3.278, 0.984 | identical | ✅ |
| Executive Readout | 0.358, 5.651, 9.363, 0.766 | identical | ✅ |
| TextBox 1 (MTTR note, off-slide) | y = 7.708 (hidden) | identical | ✅ |
| Lower-right Manila Water logo band (rendered y) | 7.09–7.23 | 7.09–7.23 | ✅ |

Header, YTD, TARGET row text (incl. `≥98%`, `95%–105%`, `≥86% (6:1)`, `≥80% (4:1)`, `DOWNWARD`, `=100%`), RAG legend text, fonts, borders and fills are inherited byte-for-byte from the cloned master (only KPI values/fills, BU name, and commentary are written).

## Rendered slide bands (PowerPoint → PDF → PNG, 1600 px wide)

Content bands (y in inches, slide height 7.5 in):

| Slide | Bands |
|---|---|
| Master -15 slide 1 | 0.24–0.57 (title) · 0.81–5.32 (table) · 5.65–6.82 (readout+legend) · 7.09–7.23 (logo) |
| Generated AMD-EZ Scorecard (page 2) | 0.24–0.57 · 0.81–5.32 · 5.65–6.62 · 7.09–7.23 |
| Generated Clark Water Scorecard (page 4) | 0.24–0.57 · 0.81–5.43 · 5.65–6.62 · 7.09–7.23 |
| Generated Tagum Water Scorecard (page 6) | 0.24–0.58 · 0.81–5.35 · 5.65–6.62 · 7.09–7.23 |
| AMD-EZ Trends (page 3) | 0.24–0.57 (title) · 0.69–0.80 (period) · 3 chart rows 1.20–2.04 / 2.38–3.73 / 4.56–5.69 · 7.09–7.23 (logo) |
| Tagum Water Trends (page 7) | identical grid — charts stop at June (no Jul/Aug) |

The trends pages show the same title band, blue title style, 2×3 chart grid, gridlines `#E5E7EB`, blue title `#2F6EBA`, gray benchmark lines `#9DA3AE`, and the identical lower-right logo band `7.09–7.23`.

## Regression coverage in `src/modules/monthly-kpi/allBusinessUnitsDeck.test.ts`

1. Total slides = 1 cover + 2 × BUs ✅ (22 tests pass, 5 files: `npm test` equivalent)
2. Order Scorecard→Trends per BU ✅
3. Scorecard uses the Manila Water structure (Slide Title / AMD-EZ Monthly KPI Scorecard table / RAG Legend / Executive Readout / master layout) ✅
4. Header Month + six KPI columns + YTD + TARGET rows ✅
5. Logo lower-right inherited via master layout + media (no `<p:bg>` override) ✅
6. Commentary bullets = Notes/Situation only (label prefixes Notes:/Situation:) ✅
7. No "Key exceptions" threshold text anywhere ✅
8. No commentary leakage between BUs ✅
9. Group A monthly rows cumulative Jan→M (recomputed from `aggregateMonthlyKpiRecords`) ✅
10. Group B monthly rows standalone ✅
11. YTD row equals live Monthly KPI aggregate ✅
12. Six charts per Trends slide + six chart parts ✅
13. Trends slides share master layout/logo ✅
14. Group A trend final points ≈ Slide 1 YTD values ✅
15. Group B YTD-average final points ≈ Slide 1 YTD values ✅
16. No future/unsubmitted months plotted (chart windows stop at BU last data month; Tagum = 6) ✅
17. Common effective month August 2026 on cover and every Trends "Reporting period" line; no relabel ✅
18. Lagging-BU charts stop at their real last month ✅
19. Benchmark reference series where applicable; none invented for MTTR ✅

## Notes

- Values and RAG fills reuse the authoritative Monthly KPI aggregation/threshold modules — the deck implements no presentation-specific KPI formulas.
- Slides are rendered from a fixture (no DB): AMD-EZ and Clark Water submit through August, Tagum Water lags at June — exactly the lagging-BU behavior required.
- The hidden template `TextBox 1` MTTR methodology note is preserved off-slide (y ≈ 7.71 in) exactly as in the uploaded master deck.
- Pre-existing unrelated failure on clean main: `monthly-kpi/visualRecovery.test.ts` (2 tests, display-precision expectations vs current data); identical failures occur on a clean `origin/main` worktree.
