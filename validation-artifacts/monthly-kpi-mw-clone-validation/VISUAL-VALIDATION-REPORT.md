# Monthly KPI — All Business Units deck (Manila Water master clone) — Visual Validation Report

Updated: 2026-09-07 (P1 visual correction — Trends grid + combo charts)
Branch: `fix/monthly-kpi-allbu-mw-scorecard-visual`
PR: https://github.com/estrangender26/odm-dashboard/pull/414

## Master visual reference

| File | Slide | Role |
|------|-------|------|
| `Monthly KPI Executive Scorecard - August 2026-15.pptx` (uploaded master) | 1 | Authoritative "Monthly Reliability KPI Scorecard, AMD-EZ" Manila Water slide |
| `src/modules/executive-presentations/templates/MonthlyKpiAllBuExecutive.pptx` (committed) | 2 | Scorecard DONOR — byte-copy of the master slide used by the single-BU deck |
| same template | 3 | Trends DONOR — six native charts in a 3×2 dashboard-style grid |

Investigation finding: the uploaded AMD-EZ slide is produced from the *same* committed master slide the single-BU generator clones/updates (`MonthlyKpiExecutive.pptx` slide 1 — shapes `Slide Title`, `AMD-EZ Monthly KPI Scorecard`, `RAG Legend`, `Executive Readout`, `TextBox 1`; layout `slideLayout12`; master background `image1.jpeg` with the lower-right Manila Water mark). The All-BU generator clones that master slide XML per BU and replaces only dynamic content.

## Files in this folder

| File | Description |
|------|-------------|
| `Monthly KPI Scorecard - All Business Units - August 2026 (MW clone).pptx` | Validation deck (fixture, 3 BUs, effective August 2026) — git-ignored, regenerate with `node --import tsx scripts/monthly-kpi-allbu/generate-validation-fixture-deck.mts` |
| `render/page-001.png … page-007.png` | PowerPoint-rendered slides (cover · AMD-EZ Scorecard · AMD-EZ Trends · Clark Scorecard · Clark Trends · Tagum Scorecard · Tagum Trends) |

## Slide 2 — KPI Trends (P1-corrected layout)

The Trends donor now lays the six panels out as **3 equal columns × 2 equal rows** (dashboard layout), measured from the donor slide XML (inches):

```
┌──────────────┬──────────────┬──────────────┐
│ PM Compliance│ Budget Spend │ PM:CM WO     │   row y = 1.16
├──────────────┼──────────────┼──────────────┤
│ PM:CM Cost   │ MTTR         │ Facility     │   row y = 4.04
│              │              │ Uptime       │
└──────────────┴──────────────┴──────────────┘
```

- Chart frames: 6 frames, x = {0.42, 4.68, 8.95}, y = {1.16, 4.04}, each w = 3.96 × h = 2.42 in.
- Panel captions row 1 (y 0.89): PM Compliance (%) · Budget Spend (%) · PM:CM WO (%); row 2 (y 3.77): PM:CM Cost (%) · MTTR (Days) · Facility Uptime (%).

### Chart type / series mapping (mirrors the dashboard Trends view)

| Panel | Monthly Actual | YTD / Trend | Benchmark |
|---|---|---|---|
| PM Compliance (%) | **columns/bar** (cyan) | **line** YTD Average (blue, markers) | dashed ≥98 % |
| Budget Spend (%) | — (no authoritative per-BU monthly series; not invented) | **line** YTD/Cumulative (blue, markers) | dashed 95 % + 105 % |
| PM:CM WO (%) | — (same) | **line** YTD/Cumulative | dashed ≥86 % |
| PM:CM Cost (%) | — (same) | **line** YTD/Cumulative | dashed ≥80 % |
| MTTR (Days) | — (same) | **line** YTD/Cumulative | none (no invented benchmark) |
| Facility Uptime (%) | **columns/bar** (cyan) | **line** YTD Average (blue, markers) | dashed =100 % |

Group A investigation: the authoritative trend model (`BusinessUnitTrendPoint`) exposes only **cumulative** YTD series for Budget/PM:CM/MTTR per BU — no per-BU standalone monthly series. Only portfolio-wide `portfolioMonthlyActuals` exist (not BU-specific) and stored monthly submission values are not recomputed monthly actuals, so per the PR guidance **no presentation-only monthly series is invented**; Group A panels stay YTD-line + benchmark. Monthly actual bars are included exactly where an authoritative monthly series exists (PM Compliance, Facility Uptime).

Implementation: each panel chart part is finalized offline (committed template) from a pptxgenjs line chart into PowerPoint combo form — a clustered `<c:barChart>` group (monthly columns) plus a `<c:lineChart>` group (YTD line + dashed benchmark lines) sharing the same axes; MTTR and other pure-line panels keep a single line group. Runtime only rewrites cached categories/series values.

## Geometry comparison — generated AMD-EZ Scorecard vs uploaded master AMD-EZ slide (no Slide-1 regression)

Measured from OOXML (`-15.pptx` slide 1 vs validation deck slide 2):

| Element | Master (-15) | Generated | Match |
|---|---|---|---|
| Slide Title | 0.333, 0.188, 12.667, 0.396 | identical | ✅ |
| Scorecard table | 0.333, 0.812, 12.667, 4.510 | identical | ✅ |
| Table column widths | 1.542 · 1.771 · 1.875 · 2.24 · 2.188 · 1.562 · 1.49 | identical | ✅ |
| Table row heights | 0.625, 8×0.385, 0.438, 0.365 | identical | ✅ |
| RAG Legend / Executive Readout | 9.730,5.651 · 0.358,5.651 | identical | ✅ |
| Lower-right MW logo band (render) | y 7.09–7.23 | y 7.09–7.23 | ✅ |

## Rendered slide bands (PowerPoint → PDF → PNG)

| Slide | Content bands (y in) |
|---|---|
| Generated AMD-EZ Scorecard (page 2) | 0.24–0.57 title · 0.81–5.32 table · 5.65–6.62 readout/legend · 7.09–7.23 logo |
| AMD-EZ Trends (page 3) | title 0.24–0.57 · period 0.69–0.80 · row-1 captions 0.95–1.08 · **row-1 charts 1.27–3.02** · row-2 captions 3.83–3.96 · **row-2 charts 4.15–6.18** (+axis labels 6.22–6.35) · logo 7.09–7.23 |
| Tagum Trends (page 7) | same grid; charts stop at June (no Jul/Aug) |

Rendered pixel evidence on page 3: **cyan column clusters** present in chart column 1 (PM Compliance, x≈0.9–4.1 in) and chart column 3 (Facility Uptime, x≈9.5–12.6 in) — 8 columns each for Jan–Aug; blue line/title pixels `#2F6EBA`, gray benchmark/axis pixels `#9DA3AE`, grid `#E5E7EB`; logo band identical to Slide 1.

## Regression coverage in `src/modules/monthly-kpi/allBusinessUnitsDeck.test.ts` (23 tests)

1. Total slides = 1 cover + 2 × BUs ✅
2. Order Scorecard→Trends per BU ✅
3. Scorecard uses MW master structure ✅ · 4. six KPI columns + YTD + TARGET ✅ · 5. logo via master layout ✅
6. Commentary bullets = Notes/Situation only ✅ · 7. no "Key exceptions" ✅ · 8. no leakage ✅
9. Group A monthly rows cumulative Jan→M ✅ · 10. Group B standalone ✅ · 11. YTD row = live aggregate ✅
12. Six charts per Trends slide ✅ · 13. shared MW layout/logo ✅
14/15. Group A/B final trend points ≈ Slide-1 YTD ✅ · 16. no future months (Tagum stops June) ✅ · 17. common month August 2026, no relabel ✅
19. **Trends grid is exactly 3 equal columns × 2 equal rows** ✅ (frame-geometry assertion)
20. **Combo structure**: PM Compliance & Facility Uptime = `barChart col` (Monthly Actual) + `lineChart` (YTD Average) + dashed benchmark; Budget/WO/Cost line-only with benchmarks; MTTR has no bar chart, no benchmark, no dash ✅

## Notes

- Values/RAG reuse the authoritative Monthly KPI aggregation/threshold modules; no presentation-specific KPI formulas.
- The hidden template `TextBox 1` MTTR methodology note is preserved off-slide (y ≈ 7.71 in) as in the uploaded master deck.
- Pre-existing unrelated failure on clean main: `monthly-kpi/visualRecovery.test.ts` (2 tests, display-precision expectations) — identical on a clean `origin/main` worktree.
