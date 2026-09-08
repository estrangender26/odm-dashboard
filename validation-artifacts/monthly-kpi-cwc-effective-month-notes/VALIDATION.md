# Monthly KPI — CWC Notes/Situation rendering (urgent fix) — Validation

Branch: `fix/monthly-kpi-cwc-effective-month-notes`

Root cause: the single-BU presentation path keyed Notes/Situation (and the
aggregates) to the REQUESTED month. When September 2026 was requested while
the portfolio is submitted through August, the adapter looked up a September
record (missing) and produced blank commentary. The adapter now resolves the
authoritative effective reporting month (same server authority as the All-BU
deck) before building scorecards, YTD values, and commentary.

Second root cause (file corruption): `makeHeadingParagraph` appended
`<a:buNone>` AFTER `<a:defRPr>` inside `<a:pPr>`. DrawingML requires
`buNone`/`buChar` to precede `tabLst`/`defRPr`/`extLst`; PowerPoint refuses the
package (`-9074`) when that ordering is violated. The writer now inserts
`buNone` before the first `tabLst|defRPr|extLst` child. This explains why the
pre-fix artifact below is unreadable while the fixed artifacts audit clean.

Local reproduction with real production data (requested month 9 → effective 8):

CWC single-BU slide1 readout XML =
```
Notes / Commentary
  Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44
Situation
  No situation submitted.
```
Title: "Monthly Reliability KPI Scorecard, CWC". Render:
`CWC-scorecard-render.png` (generated from the artifact PPTX in this folder).

## Artifacts

| File | Status |
|---|---|
| `CWC - Monthly KPI Executive Scorecard - August 2026.pptx` | PRE-FIX original. Kept for forensics. Fails OPC/DrawingML audit: `buNone` after `defRPr` in slide1.xml — the schema violation PowerPoint rejects. |
| `CWC - Monthly KPI Executive Scorecard - August 2026 (fixed).pptx` | POST-FIX. Audit clean (below). |
| `All-BUs - Monthly KPI Scorecard - August 2026 (fixed).pptx` | POST-FIX All-BU deck. Audit clean (below). |

## Structural audit (Python + ElementTree, per artifact)

- every XML / `.rels` part parses
- every relationship `Target` resolves to an existing part (no dangling refs)
- no `<a:r>` nested inside another `<a:r>`
- in every `<a:pPr>`, `buNone` appears BEFORE `defRPr`
- CWC note text present in the deck

Fixed single-BU: audit_ok True, 67 parts, note_found True.
Fixed All-BU:   audit_ok True, 217 parts.
Corrupt original: audit_ok False — `buNone after defRPr` in `ppt/slides/slide1.xml`.

## Test/CI evidence

- `npm run check` (tsc -b): clean.
- `npm run build`: clean.
- Monthly-KPI + presentation suites (incl. new source-contract test
  `api/monthly-kpi-presentation-path.test.ts`): 117 passed; the only 2 failures
  (`visualRecovery.test.ts`) reproduce identically on clean `origin/main`
  (pre-existing, unrelated — verified in detached worktree at `3a728ee`).
- Full-suite failure diff branch vs `origin/main`: no new failures.

## PowerPoint openability note

Local Microsoft PowerPoint on this machine returns error `-9074` for EVERY
file, including the pristine unmodified template — a broken local PowerPoint
install, not a property of these files. Openability therefore relies on the
audit above plus the schema-correct writer change (the pre-fix artifact —
which PowerPoint reported as corrupt — is the one failing the audit with the
exact violation the fix removes).
