# Monthly KPI — Notes/Situation rendering for ANY business unit (urgent fix) — Validation

Branch: `fix/monthly-kpi-cwc-effective-month-notes`
CWC is the reproduced example; the fix and validation are generic across every
business unit selectable in the Monthly KPI Presentation Center.

## Generic rule (applies identically to every selected BU)

For ANY selected business unit:

- resolve the server-authoritative effective reporting month;
- use THAT BU's record for that effective month;
- render that record's stored Notes;
- render that record's stored Situation;
- if Notes is blank → "No commentary submitted.";
- if Situation is blank → "No situation submitted.".

No prior-month fallback. No requested-month blanking. No cross-BU leakage.
No CWC (or any BU-name) special case in runtime implementation.

## Root cause

The single-BU presentation path keyed Notes/Situation (and the aggregates) to
the REQUESTED month. When September 2026 was requested while the portfolio is
submitted through August, the adapter looked up a September record (missing)
and produced blank commentary. The adapter now resolves the authoritative
effective reporting month (same server authority as the All-BU deck) before
building scorecards, YTD values, and commentary — generically for the selected
business unit.

Second root cause (file corruption): `makeHeadingParagraph` appended
`<a:buNone>` AFTER `<a:defRPr>` inside `<a:pPr>`. DrawingML requires
`buNone`/`buChar` to precede `tabLst`/`defRPr`/`extLst`; PowerPoint refuses the
package (`-9074`) when that ordering is violated. The writer now inserts
`buNone` before the first `tabLst|defRPr|extLst` child. This explains why the
pre-fix artifact below is unreadable while the fixed artifacts audit clean.

## CWC reproduction with real production data (requested month 9 → effective 8)

CWC single-BU slide1 readout XML =
```
Notes / Commentary
  Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44
Situation
  No situation submitted.
```
Title: "Monthly Reliability KPI Scorecard, CWC". Render:
`CWC-scorecard-render.png` (generated from the artifact PPTX in this folder).

## Genericity evidence

- `resolveEffectiveReportingMonth(records, month)` is BU-agnostic: it resolves
  on whether ANY valid scorecard submission exists for a month. Multi-BU unit
  fixtures (e.g. "AMD-EZ" submitted Jan–May + "Clark Water" Jan–Aug) prove a
  September request resolves to August for every BU, never the lagging BU's
  month (`api/monthly-kpi-effective-month.test.ts`).
- Single-BU commentary lookup (`buildScorecard`) matches the record by the
  aggregate's OWN normalized BU identity + reporting year + effective month —
  no BU-name equality anywhere in the effective-month or commentary path
  (asserted in `api/monthly-kpi-presentation-path.test.ts`).
- New parameterized single-BU deck test selects arbitrary identities
  BU-A / BU-B / BU-C (each with its own August notes/situation, incl. null
  fields) and asserts each generated deck renders ONLY its own text and no
  other BU's note/situation anywhere (`templateGenerator.test.ts`).
- All-BU deck per-section notes/situation already proven generic with
  non-canonical BU identities ("Clark Water", "Tagum Water", "Partial BU",
  "Trim BU") with no-leakage assertions and the pristine-donor audit
  (`allBusinessUnitsDeck.test.ts`).
- Runtime audit: the only CWC references in the presentation runtime are
  pre-existing on `main` and outside the Notes/Situation/effective-month path:
  a Slide-3 issues-matrix classification keyed to CWC's anomalous 307:1 PM:CM
  work-order ratio (introduced by `efa5dec` on main) and static Slide-3
  action-card copy naming several BUs. Neither is a Notes/Situation code path;
  both predate this PR and are untouched here.


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
- New parameterized generic test: selected arbitrary BU (BU-A / BU-B / BU-C)
  renders only its own stored Notes/Situation at the effective month with no
  leakage from any other BU — passes (templateGenerator.test.ts).
- New source-contract assertions: adapter effective-month/commentary path
  contains no BU-name equality and reads the record matched by the BU's own
  identity at the effective month (api/monthly-kpi-presentation-path.test.ts).
- Monthly-KPI + presentation + api path suites: only the 2 pre-existing
  `visualRecovery.test.ts` failures remain — they reproduce identically on
  clean `origin/main` (verified in a detached worktree at `3a728ee`).
- Full-suite failure diff branch vs `origin/main`: identical failure sets,
  no new failures.

## PowerPoint openability note

Local Microsoft PowerPoint on this machine returns error `-9074` for EVERY
file, including the pristine unmodified template — a broken local PowerPoint
install, not a property of these files. Openability therefore relies on the
audit above plus the schema-correct writer change (the pre-fix artifact —
which PowerPoint reported as corrupt — is the one failing the audit with the
exact violation the fix removes).
