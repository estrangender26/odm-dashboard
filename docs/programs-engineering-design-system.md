# Programs Engineering Design System

Visual identity layer for the whole ODM Dashboard suite, derived from the
OWNER-supplied **Programs Engineering** banner.

This document is the reference for anyone touching suite chrome. The brand is
centralised: module work should consume tokens and shared components, never
introduce its own accent.

---

## 1. Source of truth

The banner is white-dominant with engineering blue and teal. Its composition:

| Banner element | Value |
| --- | --- |
| `PROGRAMS` | engineering blue, uppercase, wide tracking |
| `ENGINEERING` | teal, uppercase, wide tracking, stacked beneath |
| `Engineering Solutions. Powering Progress.` | dark charcoal, small |
| Icon row (`INNOVATE / ENGINEER / DELIVER / EMPOWER`) | filled circular discs, alternating blue and teal, white line icons |
| Gradient band | blue → teal, left to right |
| Geometry | large gear/ring forms, sweeping arcs, restrained halftone dots |
| Backgrounds | white and very light neutral, generous whitespace |

---

## 2. Palette

Defined once as `--pe-*` custom properties in **`src/index.css`** (React
surface) and **`public/programs-engineering.css`** (standalone HTML surface).

### Brand

| Token | Value | Use |
| --- | --- | --- |
| `--pe-blue` | `#258AC1` | Primary engineering blue |
| `--pe-blue-deep` | `#1878B3` | Hover / pressed, action gradient start |
| `--pe-blue-light` | `#4AA2D3` | Secondary strokes, tints |
| `--pe-teal` | `#2FB19F` | Secondary brand voice |
| `--pe-teal-deep` | `#209C8C` | Teal hover |
| `--pe-teal-light` | `#55C0AE` | Light teal |
| `--pe-bg` | `#F5F9FA` | Page canvas |
| `--pe-white` | `#FFFFFF` | Cards, mastheads |
| `--pe-border` | `#DCE6EA` | Borders / dividers |
| `--pe-border-strong` | `#C2D4DB` | Emphasised borders |
| `--pe-text` | `#26343D` | Body text |
| `--pe-text-strong` | `#1B2830` | Headings |
| `--pe-text-muted` | `#56636B` | Secondary text |
| `--pe-text-faint` | `#7C8A93` | Meta text |

### Gradients

| Token | Value | Use |
| --- | --- | --- |
| `--pe-gradient` | `#258AC1 → #2FB19F` | **Decorative only** — masthead rules, hero accents, footer bars |
| `--pe-gradient-action` | `#1878B3 → #178073` | Primary buttons and any surface carrying white text |

> **Why two gradients.** The bright banner sweep reaches only **3.83:1** (blue
> end) and **2.65:1** (teal end) against white — below the WCAG AA 4.5:1 floor.
> It therefore never carries text. The action gradient preserves the same
> blue → teal identity at **4.80:1** across the whole sweep. Use
> `--pe-gradient` for decoration, `--pe-gradient-action` (or `.pe-btn--primary`)
> for anything with a label on it.

### Semantic

`--pe-success #0F9D6B`, `--pe-warning #C2740A`, `--pe-danger #D0342F`, plus
`-bg` / `-border` variants. These carry operational meaning and are **never**
restyled to brand blue or teal. Destructive actions keep red.

### Surfaces

`--pe-surface`, `--pe-surface-sunk`, `--pe-table-header #EEF5F8`,
`--pe-row-hover #F2F8FB`, `--pe-row-selected #E7F6F3`.

---

## 3. Three consumption surfaces, one brand

The suite is served by three different architectures, so the brand is published
twice but never duplicated in spirit:

| Surface | Routes | Consumes |
| --- | --- | --- |
| React SPA | `/`, `/login`, `/help`, `/gantt*`, `/smp-dashboard`, `/om-manuals-library`, `/scorecard-kpi`, `/presentation-center`, `/projects-without-ppp`, 404 | `src/index.css` + `tailwind.config.js` + `src/components/programs/*` |
| Static HTML | `/governance`, `/mw-dashboard` | inline `<style>` + `public/programs-engineering.css` |
| Static HTML in iframe | `/scorecard-kpi` iframe (`public/scorecard-kpi.html`) | inline `<style>` + `public/programs-engineering.css` |

Each standalone page keeps its own variable block (`--mw-*`, and the `:root`
blocks in `mw-dashboard.html` / `scorecard-kpi.html`), but those now **alias**
`--pe-*` instead of hard-coding their own brand blues. Retuning the brand is a
one-file change per surface.

### Tailwind

`tailwind.config.js` additionally:

- adds a `pe` colour scale and `pe-gradient*` background images;
- **remaps the raw `blue-*` scale** onto the engineering blue ramp, so the
  several hundred existing `bg-blue-600` / `text-blue-600` / `bg-blue-50`
  utilities across the React pages re-voice coherently without per-file edits;
- remaps `teal-*` onto the PE teal ramp;
- cools `gray-*` toward the PE charcoals so neutral chrome matches the banner.

Semantic scales (`red`, `amber`, `emerald`, `green`) are deliberately left
alone.

---

## 4. Components

`src/components/programs/` — import from `@/components/programs`.

| Component | Purpose |
| --- | --- |
| `SuiteMasthead` | Compact suite identity bar. Suite level of the hierarchy. |
| `ModuleMasthead` | Per-module identity row: orb + title + subtitle + actions. Deliberately shallow. |
| `PeIconOrb` | The banner's circular icon container. `tone` alternates `blue` / `teal`. |
| `PeWordmark` | The `PROGRAMS` / `ENGINEERING` lockup + tagline. |
| `PeHeroGeometry` | The Home hero's gear / ring / arc / dot composition. |
| `PeModuleCard` | Landing-page module card. |
| `MODULE_IDENTITY` | Registry mapping each module to icon + tone + title + subtitle. |

### Hierarchy

```
PROGRAMS ENGINEERING        ← SuiteMasthead (every page)
        ↓
ODM Dashboard Suite         ← suite context
        ↓
Individual Modules          ← ModuleMasthead (per module)
```

### Module differentiation

Modules are recognised by **icon, title and subtitle** — never by a private
colour scheme. Only two brand voices exist (blue, teal) and they alternate, the
same rhythm as the banner's four circular icons. `MODULE_IDENTITY` is the single
place that decides this.

### Masthead weight

The Home landing page gets the expressive hero (`PeHeroGeometry`, large
wordmark, verb row). **Internal operational modules get the compact masthead
only** — a suite row plus a shallow module row — so engineering tables, plans,
KPIs, schedules and forms keep their vertical workspace.

---

## 5. Rules

1. **No new hex values in modules.** Use `--pe-*`, `.pe-*` classes, or the
   remapped Tailwind scales.
2. **Tables stay dense.** Header tint, row separators, hover and selected states
   may change; row height and column density may not. Never turn a table row
   into a card.
3. **Status colour is meaning, not decoration.** Success / warning / error /
   critical keep their semantic colours, and critical state is never communicated
   by colour alone.
4. **Destructive actions stay red.** Never use brand teal for destructive.
5. **Photography is not invented.** The banner's industrial imagery is carried
   by CSS/SVG geometry instead; no stock imagery is introduced.
6. **Focus is always visible.** `.pe-focusable` / `.pe-btn` / interactive cards
   expose a 2px brand-tinted ring.
7. **Reduced motion is respected.** Decorative brand motion is disabled under
   `prefers-reduced-motion: reduce`.

---

## 6. Standalone HTML surfaces

Standalone pages load `public/programs-engineering.css` **last**, after their own
stylesheet, so it can win without `!important` — except where a page hard-codes
an inline `style` attribute on its own markup, which the shared header rules
override deliberately.

That stylesheet converts each standalone dashboard's dark navy header to the
light Programs Engineering masthead and re-voices every control inside it
(selects, date inputs, primary / secondary / destructive buttons, header meta)
for a light background, so contrast is preserved rather than lost in the flip.
