# ODM Dashboard — Visual Modernization Mockup (Phase 0)

**Status: AWAITING OWNER VISUAL APPROVAL. Nothing here is implemented.**

This directory is standalone design evidence. It contains no application code and
is not part of the production build.

---

## What this is

High-fidelity static mockups of the eight retained ODM modules after a coherent
visual normalization, plus a specification page for the proposed design system
and a like-for-like comparison of the current and proposed Home screen.

The current production application was the authoritative source for:

- page structure and section order
- layout and information hierarchy
- workflows, controls and dialogs
- module ordering and navigation
- business terminology
- engineering information density
- data presentation and status semantics

**Only the visual language changes.** No sidebar, no new navigation model, no new
search system, no invented widgets, no new charts, no new information, and no
restored modules.

---

## How to open it

Open `index.html` in a browser. Every page links to the others through the dark
reviewer toolbar at the top.

```
design/visual-modernization/
  index.html                 start here: what was measured, and how to review
  system.html                proposed visual system (tokens, type, components)
  compare-home.html          Home — current vs proposed, side by side
  home.html                  Home / Program Oversight Center
  monthly-kpi.html           Monthly KPI Scorecard
  governance.html            O&M Manual Governance
  smp.html                   Standard Maintenance Procedures
  om-manuals.html            O&M Manuals Library
  gantt.html                 ODM Primavera Lite
  projects-without-ppp.html  Projects without PPP
  odm.html                   Operator-Driven Maintenance
  presentation-center.html   Presentation Center
  assets/odm-design.css      proposed design system (the deliverable)
  assets/odm-mockup.css      reviewer chrome + page-specific helpers
  generator/                 generator that produced the static HTML
```

The dark bar at the top of every page is mockup chrome, not part of the design.
The proposed application UI starts immediately beneath it.

To rebuild the static pages after editing the generator:

```bash
python3 design/visual-modernization/generator/generate.py
```

---

## The proposed system in one screen

| Token | Value | Role |
| --- | --- | --- |
| Canvas | `#F8FAFC` | page background (currently `#FFFFFF`) |
| Surface | `#FFFFFF` | cards, panels, tables |
| Surface sunken | `#F1F5F9` | toolbars, table headers, wells |
| Border | `#E2E8F0` | default structure (replaces `#D6DFE8`) |
| Border strong | `#CBD5E1` | inputs, hover, dividers |
| Text | `#0F172A` | body |
| Text muted | `#64748B` | labels, secondary (collapses 4 greys into 2) |
| Corporate navy | `#16324F` | header, brand |
| Deep navy | `#0B1D44` | headings (existing ODM value, retained) |
| Primary action | `#005BAC` | interaction, selection |
| Success / Warning / Danger | `#059669` / `#D97706` / `#DC2626` | meaning only |
| Radius | 4 / 6 / 8 / 10 / pill | one scale replaces 13 ad-hoc values |
| Shadow | xs / sm / md / lg | borders carry structure; elevation is restrained |
| Font | Inter | loaded explicitly — today it is declared but never served |

Colour communicates; it does not decorate. Blue means interaction, green means
healthy, amber means attention, red means problem, slate means structure.

---

## What the mockups preserve verbatim

- Home card order, titles, descriptions, badges and destinations
- Every control on every screen, with its current label
- Table column headers, in order (18 for Activities, 16 for Projects without PPP, 9 for the KPI monthly records, 8 for the KPI summary matrix, 7 for the milestone tracker, and so on)
- Tab names (e.g. `Data Quality` / `Negative Findings` / `Inspection Notes` / `Inspector Performance`)
- Status vocabularies: KPI `Passed` / `Near Target` / `Below Target` / `Missing`; Governance `achieved` / `in_progress` / `planned_open` / `upcoming`; SMP `Current` / `Superseded` / `Under Review` / `Expired` / `Draft`; PPP `Submitted` / `Not Submitted`
- Gantt semantic colours, unchanged: planned `#2563EB`, actual `#059669`, critical CPM `#DC2626`, data date `#7C3AED`, today `#EF4444`, neutral CPM `#64748B`, unresolved hatch `#FCD34D` / `#92400E`
- Empty-state strings (e.g. `No remembered projects. Create one above, or paste an admin link into the address bar.`)
- Business terminology: facilities, milestones, TOC items, business units, KPI names

---

## Known issues found in the current application that the mockups deliberately do **not** inherit

These are reported for a separate decision; none of them are visual, and none are
fixed by this mockup.

1. **The Home card advertises "8 KPIs" while the scorecard module renders and
   scores 6.** The card text is reproduced verbatim in the mockup; the number is
   a business-content question, not a visual one.
2. **`public/governance.html` references undefined CSS variables** (`var(--t2)`
   ×18, `var(--bg)` ×3, plus `--red`/`--green`/`--blue`/`--orange`) in inline
   styles. Only `--mw-*` is declared in `governance.css`, so those declarations
   are silently dropped by the browser. The mockup uses defined tokens instead.
3. **Inter is declared in six places but never loaded** — no `@font-face`, no
   font link, no font package. The application currently renders in the system
   fallback font, so the real typography does not match the intent.
4. **`/api/governance/cleanup-dates` returns 500** because it emits MySQL syntax
   (`REGEXP`) to PostgreSQL. Unrelated to design.

---

## Constraints honoured by this phase

| Constraint | Status |
| --- | --- |
| Production application code modified | No |
| Production database modified | No |
| Migrations created | No |
| APIs changed | No |
| Routes changed | No |
| Workflows changed | No |
| Business logic changed | No |
| Anything merged to `main` | No |
| Anything deployed | No |
| Render / Supabase altered | No |
| Deleted modules restored or referenced | No |

Verified mechanically: this branch is created from `origin/main` `b52cbae` and adds
only `design/`; `git status` shows no modified tracked source file, `npm run build`
succeeds, and no file from this directory appears in `dist/`.

---

## Next step

Review the mockups and reply with what to keep, what to change, and what to drop.
Implementation is a **separate, separately authorised mission** and will not begin
on the basis of a favourable reaction alone.
