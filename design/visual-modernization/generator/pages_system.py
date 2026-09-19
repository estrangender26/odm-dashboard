"""Visual-system specification page for the mockup artifact (mockup only)."""
from odm_icons import svg


def swatch(name, token, hexv, usage, on_dark=False):
    cls = " odm-sw-card--dark" if on_dark else ""
    return (
        '<div class="odm-sw-card%s">'
        '<span class="odm-sw-chip" style="background:%s"></span>'
        '<div class="odm-sw-meta"><b>%s</b><code>%s</code><em>%s</em></div>'
        '</div>' % (cls, hexv, name, hexv, usage)
    )


def spec_row(label, note, demo):
    return (
        '<div class="odm-spec-row">'
        '<div class="odm-spec-label"><b>%s</b><em>%s</em></div>'
        '<div class="odm-spec-demo">%s</div>'
        '</div>' % (label, note, demo)
    )


def system_body():
    palette = "".join([
        swatch("Canvas", "--odm-canvas", "#F8FAFC", "page background"),
        swatch("Surface", "--odm-surface", "#FFFFFF", "cards, panels, tables"),
        swatch("Surface sunken", "--odm-surface-sunk", "#F1F5F9", "toolbars, table headers"),
        swatch("Border", "--odm-border", "#E2E8F0", "default structure"),
        swatch("Border strong", "--odm-border-strong", "#CBD5E1", "inputs, hover, dividers"),
        swatch("Text", "--odm-text", "#0F172A", "body copy"),
        swatch("Text muted", "--odm-text-muted", "#64748B", "labels, secondary"),
        swatch("Text faint", "--odm-text-faint", "#94A3B8", "micro labels, placeholders"),
        swatch("Corporate navy", "--odm-navy", "#16324F", "header, brand"),
        swatch("Deep navy", "--odm-navy-ink", "#0B1D44", "headings, reserved"),
        swatch("Manila Water blue", "--odm-blue", "#005BAC", "primary action / interaction"),
        swatch("Blue soft", "--odm-blue-soft", "#EFF6FF", "selection, focus surface"),
        swatch("Success", "--odm-success", "#059669", "healthy / completed"),
        swatch("Warning", "--odm-warning", "#D97706", "attention required"),
        swatch("Danger", "--odm-danger", "#DC2626", "failure / critical"),
    ])

    type_scale = "".join([
        '<div class="odm-type-row"><span class="odm-type-demo" style="font-size:26px;font-weight:700;letter-spacing:-.6px">1,376</span>'
        '<span class="odm-type-meta"><b>KPI / metric value</b><em>26px · 700 · tabular-nums</em></span></div>',
        '<div class="odm-type-row"><span class="odm-type-demo" style="font-size:18px;font-weight:700;letter-spacing:-.3px">Dashboard Suite</span>'
        '<span class="odm-type-meta"><b>Page title</b><em>18px · 700 · −0.3px</em></span></div>',
        '<div class="odm-type-row"><span class="odm-type-demo" style="font-size:15px;font-weight:700">O&amp;M Manual Governance</span>'
        '<span class="odm-type-meta"><b>Module / card title</b><em>15px · 700</em></span></div>',
        '<div class="odm-type-row"><span class="odm-type-demo" style="font-size:13.5px;font-weight:650">Document Control</span>'
        '<span class="odm-type-meta"><b>Section title</b><em>13.5px · 650</em></span></div>',
        '<div class="odm-type-row"><span class="odm-type-demo" style="font-size:13px">Track 8 KPIs across 5 business units…</span>'
        '<span class="odm-type-meta"><b>Body</b><em>13px · 400 · 1.5</em></span></div>',
        '<div class="odm-type-row"><span class="odm-type-demo" style="font-size:12.5px;font-weight:550">Open Scorecard</span>'
        '<span class="odm-type-meta"><b>Control / CTA</b><em>12.5px · 550–600</em></span></div>',
        '<div class="odm-type-row"><span class="odm-type-demo odm-eyebrow">Business Unit</span>'
        '<span class="odm-type-meta"><b>Label / table header</b><em>10.5px · 700 · .07em uppercase</em></span></div>',
    ])

    buttons = "".join([
        '<button class="odm-btn odm-btn--primary">%s Primary</button>' % svg("play"),
        '<button class="odm-btn">%s Secondary</button>' % svg("filter"),
        '<button class="odm-btn odm-btn--navy">%s Navy</button>' % svg("download"),
        '<button class="odm-btn odm-btn--ghost">%s Ghost</button>' % svg("refresh-cw"),
        '<button class="odm-btn odm-btn--danger">%s Delete</button>' % svg("trash-2"),
        '<button class="odm-btn odm-btn--sm">%s Small</button>' % svg("plus"),
        '<button class="odm-btn odm-btn--icon">%s</button>' % svg("settings"),
        '<button class="odm-btn odm-btn--icon odm-btn--sm">%s</button>' % svg("copy"),
    ])

    badges = "".join([
        '<span class="odm-badge odm-badge--neutral">Neutral / count</span>',
        '<span class="odm-badge odm-badge--info">%s Informational</span>' % svg("info"),
        '<span class="odm-badge odm-badge--success">%s Passed</span>' % svg("circle-check"),
        '<span class="odm-badge odm-badge--warning">%s Below benchmark</span>' % svg("triangle-alert"),
        '<span class="odm-badge odm-badge--danger">%s Missing</span>' % svg("circle-x"),
        '<span class="odm-badge odm-badge--new">New</span>',
        '<span class="odm-badge odm-badge--neutral"><span class="odm-dot"></span>In progress</span>',
    ])

    alerts = "".join([
        '<div class="odm-alert odm-alert--info">%s<div><div class="odm-alert-title">Information</div>'
        '<div class="odm-alert-body" style="color:inherit;opacity:.8">Reference data is loaded from the facility list.</div></div></div>' % svg("info"),
        '<div class="odm-alert odm-alert--success">%s<div><div class="odm-alert-title">Import complete</div>'
        '<div class="odm-alert-body" style="color:inherit;opacity:.8">1,376 maintenance records validated.</div></div></div>' % svg("circle-check"),
        '<div class="odm-alert odm-alert--warning">%s<div><div class="odm-alert-title">Coverage gap</div>'
        '<div class="odm-alert-body" style="color:inherit;opacity:.8">9 equipment types have no approved SMP.</div></div></div>' % svg("triangle-alert"),
        '<div class="odm-alert odm-alert--danger">%s<div><div class="odm-alert-title">Upload failed</div>'
        '<div class="odm-alert-body" style="color:inherit;opacity:.8">Storage rejected the object. Retry the upload.</div></div></div>' % svg("circle-alert"),
    ])

    inputs = (
        '<div class="odm-spec-grid">'
        '<div class="odm-field"><label class="odm-label">FACILITY</label>'
        '<select class="odm-select"><option>All Facilities</option></select></div>'
        '<div class="odm-field"><label class="odm-label">REPORTING MONTH</label>'
        '<input class="odm-input" value="2026-08"></div>'
        '<div class="odm-field"><label class="odm-label">SEARCH</label>'
        '<span class="odm-search">' + svg("search") + '<input class="odm-input odm-input--search" placeholder="Search equipment, SMP ID, reference no."></span></div>'
        '<div class="odm-field"><label class="odm-label">STATUS</label>'
        '<select class="odm-select"><option>All Status</option></select></div>'
        '<div class="odm-field" style="justify-content:flex-end"><label class="odm-label">INCLUDE SUPERSEDED</label>'
        '<span class="odm-row"><span class="odm-switch odm-switch--on"></span>'
        '<span style="font-size:12.5px;color:#64748B">On</span></span></div>'
        '<div class="odm-field" style="justify-content:flex-end"><label class="odm-label">FILTER APPLIED</label>'
        '<span class="odm-row"><input type="checkbox" class="odm-checkbox" checked>'
        '<span style="font-size:12.5px;color:#64748B">Only current revisions</span></span></div>'
        '</div>'
    )

    table = (
        '<div class="odm-card"><div class="odm-table-wrap"><table class="odm-table">'
        '<thead><tr><th>Reference No.</th><th>Title</th><th>Equipment Type</th><th>Revision</th>'
        '<th>Effectivity</th><th>Status</th><th class="num">Docs</th></tr></thead><tbody>'
        '<tr class="is-selected"><td class="strong">SMP-AGT-014</td><td>Agitator general inspection</td>'
        '<td>Agitators General</td><td>Rev. 3</td><td class="muted">2026-04-01</td>'
        '<td><span class="odm-badge odm-badge--success">Current</span></td><td class="num">2</td></tr>'
        '<tr><td class="strong">SMP-BLR-007</td><td>Blower room monorail checks</td>'
        '<td>Blower Room, MBBR Area</td><td>Rev. 2</td><td class="muted">2026-02-15</td>'
        '<td><span class="odm-badge odm-badge--warning">Under Review</span></td><td class="num">1</td></tr>'
        '<tr><td class="strong">SMP-DGP-021</td><td>DG set weekly run procedure</td>'
        '<td>DG SET</td><td>Rev. 1</td><td class="muted">2025-11-30</td>'
        '<td><span class="odm-badge odm-badge--neutral">Superseded</span></td><td class="num">3</td></tr>'
        '<tr><td class="strong">SMP-FDS-004</td><td>FDAS alarm response</td>'
        '<td>FDAS</td><td>Rev. 4</td><td class="muted">2026-08-02</td>'
        '<td><span class="odm-badge odm-badge--danger">Expired</span></td><td class="num">1</td></tr>'
        '</tbody></table></div>'
        '<div class="odm-table-foot"><span>Showing 4 of 17 controlled documents</span>'
        '<span class="odm-row">' + svg("chevron-right") + '<span>Next</span></span></div></div>'
    )

    icons = "".join(
        '<span class="odm-icon-cell">%s<em>%s</em></span>' % (svg(n), n)
        for n in ["shield-check", "activity", "factory", "calendar-days", "book-open-check",
                  "library", "clipboard-list", "presentation", "folder", "file-text",
                  "upload", "download", "search", "filter", "pencil", "trash-2",
                  "circle-check", "triangle-alert", "circle-x", "clock", "trending-up", "target"]
    )

    decisions = "".join([
        '<tr><td class="strong">Emoji used as UI icons</td><td class="muted">198 occurrences across 11 files (🗑 📤 ✏ 📁 📄 ✅ ⚠ …)</td><td>Lucide, 14–19px, inherits text colour</td></tr>',
        '<tr><td class="strong">Three navy shades</td><td class="muted">#0B1D44 (64×), #16324F (25×), #0D2137 (11×)</td><td>#16324F header · #0B1D44 headings · #0D2137 gradient terminus</td></tr>',
        '<tr><td class="strong">Two border colours mixed</td><td class="muted">#D6DFE8 (77×) and #E2E8F0 (44×)</td><td>#E2E8F0 default · #CBD5E1 strong · #F1F5F9 inner</td></tr>',
        '<tr><td class="strong">Four muted-text greys</td><td class="muted">#5A6B7D, #8BA3B8, #64748B, #94A3B8</td><td>#64748B secondary · #94A3B8 micro</td></tr>',
        '<tr><td class="strong">13 ad-hoc radii</td><td class="muted">3,4,5,6,7,8,10,11,12,14,16,20,999 px</td><td>4 / 6 / 8 / 10 / pill</td></tr>',
        '<tr><td class="strong">Heavy / coloured shadows</td><td class="muted">e.g. <code>0 20px 60px rgba(0,0,0,.3)</code>, purple <code>rgba(124,58,237,.42)</code></td><td>xs / sm / md / lg, all slate-tinted</td></tr>',
        '<tr><td class="strong">Inter declared, never loaded</td><td class="muted">No <code>@font-face</code>, no font link, no font package</td><td>Inter loaded explicitly (implementation note)</td></tr>',
        '<tr><td class="strong">Decorative violet / orange / cyan</td><td class="muted">Purple AI affordance, purple Gantt badges, gradient icon tiles</td><td>Blue = interaction, semantic colours = meaning only</td></tr>',
    ])

    return (
        '<div class="odm-mockbar odm-mockbar--sub">'
        '<div class="odm-mockbar-in"><strong>Proposed ODM visual system</strong>'
        '<span class="odm-mockbar-note">Applied to every screen in this mockup</span></div></div>'
        '<main class="odm-main">'
        '<div class="odm-page-head"><div>'
        '<span class="odm-eyebrow">Design system</span>'
        '<h2 class="odm-page-title">ODM Visual System — Proposal</h2>'
        '<p class="odm-page-sub">A single token set reconciling the existing Manila Water / Programs identity with a shadcn-admin-grade surface discipline. '
        'Colour is used to communicate; structure is carried by borders and spacing.</p>'
        '</div></div>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">1 · Palette</h3>'
        '<span class="odm-faint" style="font-size:11.5px">Existing corporate values retained; duplicates collapsed</span>'
        '</div><div class="odm-sw-grid">' + palette + '</div></section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">2 · Typography — Inter</h3>'
        '<span class="odm-faint" style="font-size:11.5px">Base stays 13px: ODM is an engineering tool, not a marketing page</span>'
        '</div><div class="odm-card odm-card--pad">' + type_scale + '</div></section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">3 · Buttons</h3>'
        '<span class="odm-faint" style="font-size:11.5px">One primary per view; blue reserved for interaction</span>'
        '</div><div class="odm-card odm-card--pad"><div class="odm-spec-demo odm-spec-demo--wrap">' + buttons + '</div></div></section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">4 · Badges &amp; status</h3>'
        '<span class="odm-faint" style="font-size:11.5px">Neutral by default; colour only when the value carries meaning</span>'
        '</div><div class="odm-card odm-card--pad"><div class="odm-spec-demo odm-spec-demo--wrap">' + badges + '</div></div></section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">5 · Form controls</h3>'
        '</div><div class="odm-card odm-card--pad">' + inputs + '</div></section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">6 · Tables</h3>'
        '<span class="odm-faint" style="font-size:11.5px">Dense, strong header hierarchy, tabular numerals, one selection treatment</span>'
        '</div>' + table + '</section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">7 · Alerts</h3>'
        '<span class="odm-faint" style="font-size:11.5px">Replaces emoji banner rows (⚠ ✅ ℹ) with a consistent inline alert</span>'
        '</div><div class="odm-grid-2">' + alerts + '</div></section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">8 · Icon treatment</h3>'
        '<span class="odm-faint" style="font-size:11.5px">Lucide, 1.75–2px stroke, currentColor — 36–40px tinted square only on launcher cards</span>'
        '</div><div class="odm-card odm-card--pad"><div class="odm-icon-grid">' + icons + '</div></div></section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">9 · Radius, spacing, elevation</h3>'
        '</div><div class="odm-card odm-card--pad">'
        '<div class="odm-scale-row"><span>Radius</span>'
        '<span class="odm-scale-demo" style="border-radius:4px">4</span>'
        '<span class="odm-scale-demo" style="border-radius:6px">6</span>'
        '<span class="odm-scale-demo" style="border-radius:8px">8</span>'
        '<span class="odm-scale-demo" style="border-radius:10px">10</span>'
        '<span class="odm-scale-demo" style="border-radius:999px">pill</span></div>'
        '<div class="odm-scale-row"><span>Shadow</span>'
        '<span class="odm-scale-demo odm-scale-demo--wide" style="box-shadow:none">none</span>'
        '<span class="odm-scale-demo odm-scale-demo--wide" style="box-shadow:var(--odm-sh-xs)">xs</span>'
        '<span class="odm-scale-demo odm-scale-demo--wide" style="box-shadow:var(--odm-sh-sm)">sm</span>'
        '<span class="odm-scale-demo odm-scale-demo--wide" style="box-shadow:var(--odm-sh-md)">md</span>'
        '<span class="odm-scale-demo odm-scale-demo--wide" style="box-shadow:var(--odm-sh-lg)">lg · dialogs only</span></div>'
        '<div class="odm-scale-row"><span>Spacing</span>'
        '<span class="odm-faint" style="font-size:12px">4 · 8 · 12 · 16 · 20 · 24 · 32 &nbsp;—&nbsp; card padding 16px, section rhythm 16px, field gap 8px</span></div>'
        '</div></section>'

        '<section class="odm-section"><div class="odm-section-head">'
        '<section class="odm-section"><div class="odm-section-head">'
        '<h3 class="odm-section-title">11 \u00b7 Alignment with the external reference</h3>'
        '<span class="odm-faint" style="font-size:11.5px">satnaing/shadcn-admin @ main \u00b7 theme.css and index.css read directly</span>'
        '</div><div class="odm-card"><div class="odm-table-wrap"><table class="odm-table">'
        '<thead><tr><th>Reference token</th><th>Reference value</th><th>ODM decision</th><th>Why</th></tr></thead><tbody>'
        '<tr><td class="strong">--radius</td><td class="odm-mono">0.625rem (10px)</td>'
        '<td class="odm-mono">10px</td><td class="muted">Identical \u2014 ODM already ships this radius value, it is simply never applied consistently</td></tr>'
        '<tr><td class="strong">--border</td><td class="odm-mono">oklch(0.929 0.013 255.508) \u2248 #E2E8F0</td>'
        '<td class="odm-mono">#E2E8F0</td><td class="muted">Adopted exactly; replaces the competing bespoke #D6DFE8</td></tr>'
        '<tr><td class="strong">--muted</td><td class="odm-mono">oklch(0.968 0.007 247.896) \u2248 #F1F5F9</td>'
        '<td class="odm-mono">#F1F5F9</td><td class="muted">Adopted as the sunken surface for toolbars and table headers</td></tr>'
        '<tr><td class="strong">--muted-foreground</td><td class="odm-mono">oklch(0.554 0.046 257.417) \u2248 #64748B</td>'
        '<td class="odm-mono">#64748B</td><td class="muted">Adopted; collapses four ad-hoc greys into one secondary tone</td></tr>'
        '<tr><td class="strong">--primary</td><td class="odm-mono">oklch(0.208 0.042 265.755) \u2248 slate-900</td>'
        '<td class="odm-mono">#005BAC</td><td class="muted"><b>Deliberate divergence.</b> The reference uses near-black for primary; ODM is a Manila Water product and blue is its interaction colour</td></tr>'
        '<tr><td class="strong">--background</td><td class="odm-mono">oklch(1 0 0) = white</td>'
        '<td class="odm-mono">#F8FAFC</td><td class="muted">ODM has far more bordered surfaces per screen; a slate canvas is what makes white cards read as cards</td></tr>'
        '<tr><td class="strong">scrollbar</td><td class="odm-mono">thin + border-coloured thumb</td>'
        '<td class="odm-mono">adopted</td><td class="muted">ODM has many horizontally scrollable engineering tables (18 columns in Activities)</td></tr>'
        '<tr><td class="strong">mobile input size</td><td class="odm-mono">16px below 768px</td>'
        '<td class="odm-mono">already present</td><td class="muted">ODM already does this in index.html to prevent iOS focus zoom</td></tr>'
        '</tbody></table></div>'
        '<div class="odm-sc-caption"><b>Mechanism note for implementation:</b> the reference is on Tailwind v4 with OKLCH tokens in <code>@theme</code>; '
        'ODM is on Tailwind 3.4 with HSL custom properties in <code>src/index.css</code> plus <code>tailwind.config.js</code>. '
        'The values above port directly; the plumbing does not, and a v3\u2192v4 migration is explicitly not part of this proposal.</div>'
        '</div></section>\n'

        '<h3 class="odm-section-title">10 · What changes, and why</h3>'
        '<span class="odm-faint" style="font-size:11.5px">Every row is a measured finding, not a preference</span>'
        '</div><div class="odm-card"><div class="odm-table-wrap"><table class="odm-table">'
        '<thead><tr><th>Finding</th><th>Measured in the current codebase</th><th>Proposed</th></tr></thead>'
        '<tbody>' + decisions + '</tbody></table></div></div></section>'

        '</main>'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>'
    )
