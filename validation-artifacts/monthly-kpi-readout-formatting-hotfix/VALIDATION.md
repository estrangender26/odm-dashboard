# Monthly KPI — Readout run-formatting hotfix — Validation

Branch: `fix/monthly-kpi-readout-run-formatting`
Base: `main` @ `72bb4578b5350656ad24bb42c991ddb4c5406f8c`

## 1. Verified root cause (code level)

`setParagraphText()` in
`src/modules/executive-presentations/framework/readoutText.ts` kept the donor
paragraph's first `<a:r>` and rewrote only `<a:t>`; the supplied opts
(bold/size/color) were applied ONLY when the paragraph had no run. When a
donor paragraph carries a run (any template or slide whose placeholder
paragraph includes a run), the donor's inherited `<a:rPr>` survives verbatim —
including a conflicting/invisible color (e.g. a light `schemeClr`) — exactly
matching the reported "text exists in XML but renders blank" symptom.

Evidence: the current Executive Readout template donors happen to be run-less
(`<a:p>` with `pPr` + `endParaRPr`, no `<a:r>`), so on today's decks every line
goes through `createTextRun` and the produced XML already carries the canonical
formatting (verified by raw slide XML of the post-#419 production decks: runs
`lang="en-PH" sz="1200" b="1"` + `srgbClr 172B47` for headings, `b="0"` +
`srgbClr 111111` for bullets, Aptos) and renders as visible dark text (pixel
analysis below). The defect is therefore LATENT for the current donors but real
and dangerous: any donor with a run (edited template, other deck, future
layout) reproduces the invisible-text symptom because opts are ignored. This
hotfix makes the retained-run path deterministic.

## 2. Exact code correction

`readoutText.ts`:
- New `buildCanonicalRunProperties(doc, opts)` — canonical `<a:rPr>`:
  `lang="en-PH"`, `sz` from opts (1200), `b` from opts (1 headings / 0
  bullets), single `solidFill/srgbClr` from opts (172B47 headings / 111111
  bullets), `latin/ea/cs` typeface Aptos — schema-valid child order
  (solidFill before latin/ea/cs). Shared by `createTextRun`.
- New `applyRunFormatting(run, opts)`:
  - collapses duplicate `<a:rPr>` (keeps first, removes rest);
  - creates a missing `<a:rPr>` as the first child of `<a:r>` (before `<a:t>`);
  - updates an existing `<a:rPr>` in place: wipes every inherited child
    (fill/schemeClr/highlight/typeface/…), resets lang/sz/b, then rebuilds the
    canonical solidFill + Aptos children — no duplicate rPr, no duplicate
    solidFill, no leftover schemeClr, no nested `<a:r>`.
- `setParagraphText()` now calls `applyRunFormatting(keep, opts)` whenever it
  retains an existing run, BEFORE writing the text. The run-less branch is
  unchanged (`createTextRun`).

No change to the `buNone`-before-`defRPr` ordering fix from PR #419.

## 3. Tests added

- `src/modules/executive-presentations/framework/readoutText.test.ts` (NEW, 4
  unit tests) drives a DONOR THAT HAS A RUN with conflicting formatting
  (`sz=900`, `schemeClr accent1`, Calibri, yellow highlight) and asserts the
  retained run is normalized: headings `b="1" sz="1200"` + `srgbClr 172B47`,
  bullets `b="0" sz="1200"` + `srgbClr 111111`, Aptos ×3, no schemeClr /
  highlight / Calibri, one solidFill, one rPr per run, `rPr` before `a:t`, no
  nested `<a:r>`; multi-line notes + stored situation; missing-rPr creation;
  duplicate-rPr collapse.
- `templateGenerator.test.ts` (single-BU, CWC + LARC with production notes):
  Slide-1 readout runs carry the canonical visible formatting; headings are
  buNone navy bold, bullets keep `•` and are regular black; one rPr per run;
  no nested run.
- `allBusinessUnitsDeck.test.ts` (All-BU, production-shaped CWC/LARC/AMD-EZ):
  every section's readout runs are canonically formatted; stored notes AND
  neutral placeholders are formatted bullets; headings formatted; no
  schemeClr, no duplicate rPr, no nested run.

## 4. CWC rendered visual result (fresh artifact, fixed code)

`validation-artifacts/monthly-kpi-readout-formatting-hotfix/CWC - Monthly KPI
Executive Scorecard - August 2026 (hotfix).pptx` (generated locally from
production records, effective month August). Slide 1 readout XML runs are
canonical; QuickLook render (`render/CWC - …(hotfix).pptx.png`,
`render/CWC-readout-crop.png`) pixel analysis of the readout region
(x 42–1166, y 678–769 px @1600w): mean luminance 243.7 (white), 3987 dark
pixels, **4 text bands** → Notes/Commentary heading, note bullet, Situation
heading, neutral bullet all render dark-on-white.

## 5. Additional-BU result

`LARC - Monthly KPI Executive Scorecard - August 2026 (hotfix).pptx` — same
verification: mean luminance 241.9, 4629 dark pixels, **4 text bands** visible.

## 6. All-BU result

`All Business Units - Monthly KPI Scorecard - August 2026 (hotfix).pptx`
(15 slides, effective August). Per-section readout runs carry the canonical
formatting (deck test above covers CWC/LARC/AMD-EZ incl. neutral placeholders).
Renderer note: macOS QuickLook renders only the cover slide of the All-BU deck
(`render/All Business Units - …(hotfix).pptx.png`); summary-slide rendering is
not available in this toolchain, so All-BU visual proof relies on the XML-level
run assertions + package audit + shared writer evidence from the two single-BU
decks (identical code path).

## 7. PPTX integrity audit (fresh hotfix artifacts)

Comprehensive audit (zip CRC, no duplicate parts, every xml/rels part parses,
all relationship targets resolve incl. slide/chart/embedding rels, unique rel
ids, content-types coverage, no nested `<a:r>`, valid `buNone`/`buChar`
ordering, no duplicate rPr): all three hotfix decks `audit_ok=True`
(CWC 67 parts/22 rels, LARC 67/22, All-BU 217/76). Geometry: readout below the
table (table bottom 4,867,275 < readout top 5,167,275 EMU) and clear of the
legend (legend x 8,897,257 > readout right 8,889,092) — no overlap, on-slide.

## 8. Microsoft PowerPoint open test

NOT AVAILABLE. Local Microsoft PowerPoint is broken on this machine: it returns
`-9074` for every file including the pristine unmodified template, and open
attempts now hang. No PowerPoint-open claim is made; validity rests on the
package audit + renderer evidence above.

## 9. CI

- `npm run check` (tsc -b): clean.
- `npm run build`: clean.
- Full suite (hotfix branch): failure set identical to the origin/main
  baseline (verified file-by-file and test-by-test) — zero regressions; the
  26 pre-existing failures (primavera-lite routers/migrations, governance-v3
  adapter, SmpDashboard, 2× visualRecovery) reproduce identically on main. One
  governance-v3 templateGenerator test flaked under full-suite load once and
  passes 47/47 in isolation (66s file, unrelated to this change).
