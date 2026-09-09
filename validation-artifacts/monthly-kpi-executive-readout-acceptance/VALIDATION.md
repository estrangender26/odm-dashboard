# Monthly KPI — Exception Commentary + Monthly-Actual Trend Charts — Validation

Branch: `fix/monthly-kpi-readout-charts` · Base main `c0e6de9c4eb8fc44817974ea024e4b8b1d586a09`

## Part A — readout is a source-bound exception explanation only
- Heading stays EXECUTIVE COMMENTARY; MANAGEMENT ASSESSMENT is REMOVED.
- Only KPIs whose authoritative threshold status is red or amber may appear,
  and only when the BU's own monthly_kpi_records.notes/situation (exact BU +
  effective month) contains a relevant explanation. Bullets = "<KPI> —
  <compressed BU explanation>". Max 3 bullets.
- No invented causes, no management recommendations, no MTTR/validation
  commentary, no KPI-value narration.
- AMD-EZ (blank notes): "No explanation was provided by the BU for the
  below-target KPIs." — nothing invented.

Per-BU readouts (Aug 2026, verified in generated deck):
- CWC: `Budget Spend — Exceed budget due to media replacement for PS1 9MLD
  WTP 6MLD GAC DW44`
- LARC: `Budget Spend — Replacement of filters` + `Facility Uptime — Genset
  breakdown (Facility Primary Power Supply)`
- EWG: PM Compliance — Greenways DW Rehabilitaion; Budget Spend — Assuming
  pump and motor for replacement
- TWCI: 3 bullets (PM Compliance deferred/materials; Budget Spend low-value
  procurement; PM:CM cost no expenses on repairs) — 1,147-char note summarized
- AMD-EZ: neutral no-explanation line only
- LAWC / WAWA-JVC: their own source-bound bullets

## Part B — trend charts: Monthly Actual + YTD, calendar-aligned
- Every trend chart now carries a MONTHLY ACTUAL series (line) in addition to
  YTD / Cumulative (or YTD Average for PM/Facility Uptime) where authoritative
  monthly data exists; YTD stays the existing cumulative series; benchmarks
  unchanged; no numeric MTTR benchmark.
- Categories are CALENDAR months 1..effective (Jan..Aug for August 2026) for
  every BU. Values stay at their real month position; missing months are gaps
  (never compacted toward January, never future months).
- Monthly actual values come from the authoritative monthly conversion of each
  BU/month record (computeMonthlyKpiValuesFromRaw + stored fallback) and are a
  separate series from YTD.

Verified chart data (generated deck):
- EWG budget: YTD [–,–,–, Apr 50.01, May 50.01, Jun 169.5, Jul 99.75,
  Aug 85.20] at indices 3..7 (no shift to Jan-May); Monthly Actual series
  present separately.
- LARC budget YTD final = Aug 22.48 at index 7 (unit-tested).
- TWCI MTTR: YTD Aug 42.25 at index 7; monthly actual at Aug 42 (unit-tested).

## Package / visuals
All-BU (217 parts/76 rels/15 slides) and single-BU decks audit clean; no
overlap/clipping (readout box below table, on-slide, normAutofit safety net);
QuickLook render of single-BU CWC shows visible readout lines.

## Tests
executiveReadout.test.ts (source-bound semantics), trendChartRewrite.test.ts
(EWG/LARC/TWCI alignment + monthly vs YTD separation for Budget/WO/Cost/MTTR),
updated deck suites. Full suite failure set identical to origin/main (the two
governance-v3 failures only appear under full-suite load and pass 47/47 in
isolation).
