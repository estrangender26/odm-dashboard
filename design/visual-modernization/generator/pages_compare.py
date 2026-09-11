"""Comparison page (current vs proposed Home), Presentation Center mockup and
the artifact landing page. Mockup only."""
from odm_icons import svg
from odm_shared import launch_card, HOME_CARDS

# ── Faithful replica of the CURRENT Home visual language ───────────────────
# Values below are copied from src/pages/Home.tsx at b52cbae: header gradient
# 135deg #16324F -> #0D2137 -> #16324F, card border #D6DFE8, card shadow
# "0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)", emoji icons in
# rgba-tinted 40px squares, 12px-radius pills, #0066A6 CTA. Nothing here is
# re-styled — it exists so the OWNER can compare like for like.

CURRENT_CARDS = [
    ("📊", "rgba(0,168,210,0.08)", "O&amp;M Manual Governance", None,
     "Track 4 facilities (AGLIPAY, HTT, EASTBAY, KAYSAKAT) through 9 milestones with S-Curve progress and deliverables.",
     [("4 Facilities", "#FEF3C7", "#D97706"), ("9 Milestones", "#FEF3C7", "#D97706"),
      ("14 TOC Items", "#FEF2F2", "#DC2626")], "Open Dashboard", "#0066A6"),
    ("📈", "rgba(0,168,210,0.08)", "Monthly KPI Scorecard", None,
     "Track 8 KPIs across 5 business units with color-coded performance, Excel import, and budget analytics.",
     [("5 BUs", "#E6F5EF", "#0A9B6E"), ("8 KPIs", "#F0F9FF", "#0066A6"), ("Excel Import", "#FEF3C7", "#D97706")],
     "Open Scorecard", "#0066A6"),
    ("🏭", "rgba(42,170,138,0.08)", "Operator-Driven Maintenance", None,
     "Corporate analytics, predictive insights, inspector tracking, data quality, and escalation monitoring.",
     [("Analytics", "#E6F5EF", "#0A9B6E"), ("Predictive", "#E6F5EF", "#0A9B6E"), ("Insights", "#E6F5EF", "#0A9B6E")],
     "Open Dashboard", "#0066A6"),
    ("📅", "rgba(124,58,237,0.08)", "ODM Primavera Lite", None,
     "ODM Primavera Lite Online — link-based project scheduling. Create WBS, activities, dependencies, and schedules without an account.",
     [("Gantt", "#EDE9FE", "#7C3AED"), ("CRUD", "#EDE9FE", "#7C3AED"), ("Excel", "#FEF3C7", "#D97706")],
     "Open Primavera Lite", "#0066A6"),
    ("📘", "linear-gradient(135deg, #0B1D44 0%, #005BAC 100%)", "Standard Maintenance Procedures", "New",
     "Browse maintenance procedure documents organized by equipment type and system. PDF viewer with upload/download support. Searchable and filterable document library.",
     [("Documents", "#DBEAFE", "#005BAC"), ("PDF", "#DBEAFE", "#005BAC"),
      ("Upload", "#FEF3C7", "#D97706"), ("Download", "#D1FAE5", "#059669")],
     "Open SMP Library", "#005BAC"),
    ("📖", "linear-gradient(135deg, #1E3A5F 0%, #0B1D44 100%)", "O&amp;M Manuals Library", None,
     "Browse full Operation and Maintenance Manuals for each facility. Search by plant, equipment type, or system. View and download PDF manuals.",
     [("Manuals", "#DBEAFE", "#005BAC"), ("PDF", "#DBEAFE", "#005BAC"),
      ("Search", "#FEF3C7", "#D97706"), ("Download", "#D1FAE5", "#059669")],
     "Open O&amp;M Library", "#005BAC"),
    ("📋", "linear-gradient(135deg, #0F766E 0%, #0B1D44 100%)", "Projects without PPP", "New",
     "Monitoring-first dashboard: submission KPIs, filtering, and per-project masterdata upload for the Projects without PPP population.",
     [("50 Projects", "#DBEAFE", "#005BAC"), ("Submitted", "#D1FAE5", "#059669"), ("Upload", "#FEF3C7", "#D97706")],
     "Open Monitoring", "#005BAC"),
    ("📊", "linear-gradient(135deg, #005BAC 0%, #00A8D2 100%)", "Presentation Center", None,
     "Upload PowerPoint decks, maintain a presentation library, generate Monthly KPI Scorecard decks, and prepare for future AI-assisted deck generation.",
     [("PPTX", "#DBEAFE", "#005BAC"), ("Generate", "#FEF3C7", "#D97706"), ("Library", "#D1FAE5", "#059669")],
     "Open Presentation Center", "#005BAC"),
]


def current_card(emoji, tint, title, tag, desc, badges, cta, cta_color):
    tag_html = ('<span class="c-tag">%s</span>' % tag) if tag else ""
    badge_html = "".join('<span class="c-badge" style="background:%s;color:%s">%s</span>' % (bg, fg, t)
                         for t, bg, fg in badges)
    return (
        '<a class="c-card" href="#">'
        '<div class="c-card-top"><span class="c-icon" style="background:%s">%s</span>'
        '<h3>%s%s</h3></div>'
        '<p class="c-desc">%s</p>'
        '<div class="c-badges">%s</div>'
        '<span class="c-cta" style="color:%s">%s &rarr;</span>'
        '</a>' % (tint, emoji, title, tag_html, desc, badge_html, cta_color, cta)
    )


def current_home():
    cards = "".join(current_card(*c) for c in CURRENT_CARDS)
    return (
        '<div class="c-app">'
        '<header class="c-hdr"><div class="c-hdr-in">'
        '<span class="c-brand"><span class="c-logo">PROGRAMS</span>'
        '<span><b>Program Oversight Center</b><em>Programs</em></span></span>'
        '<span class="c-hdr-actions"><span class="c-help">Help</span></span>'
        '</div></header>'
        '<main class="c-main">'
        '<div class="c-pagehead"><h2>Dashboard Suite</h2>'
        '<p>Select a dashboard to access your O&amp;M management tools</p></div>'
        '<div class="c-grid">' + cards + '</div>'
        '</main>'
        '<footer class="c-foot">Program Oversight Center &copy; 2026</footer>'
        '</div>'
    )


def proposed_home():
    cards = "".join(
        launch_card(c["icon"], c["tint"], c["title"], c.get("tagline"), c["desc"],
                    c["badges"], c["cta"], "#", c.get("tag"))
        for c in HOME_CARDS
    )
    return (
        '<div class="odm-app odm-app--embed">'
        '<header class="odm-hdr"><div class="odm-hdr-in">'
        '<span class="odm-brand"><span class="odm-brand-mark">ODM</span>'
        '<span><h1>Program Oversight Center</h1><span>Programs</span></span></span>'
        '<span class="odm-hdr-actions"><span class="odm-hdr-btn">' + svg("info") + 'Help</span>'
        '<span class="odm-hdr-user"><span class="odm-avatar">GB</span></span></span>'
        '</div></header>'
        '<main class="odm-main odm-main--narrow">'
        '<div class="odm-page-head"><div><h2 class="odm-page-title">Dashboard Suite</h2>'
        '<p class="odm-page-sub">Select a dashboard to access your O&amp;M management tools</p></div></div>'
        '<div class="odm-launch-grid">' + cards + '</div>'
        '</main>'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>'
        '</div>'
    )


def compare_body():
    return (
        '<main class="odm-main">\n'
        '  <div class="cmp-head">'
        '    <span class="odm-eyebrow">Comparison</span>'
        '    <h2 class="odm-page-title">Home / Program Oversight Center — current vs proposed</h2>'
        '    <p class="odm-page-sub">Identical content, order, badges, wording and destinations. '
        'Only the surface language changes: emoji &rarr; Lucide, one border colour instead of two, '
        'near-zero shadow at rest, quieter badges, real Inter.</p>'
        '  </div>\n'
        '  <div class="cmp-block">'
        '    <div class="cmp-label"><span class="cmp-pill cmp-pill--current">CURRENT &mdash; production b52cbae</span>'
        '<span class="cmp-note">measured from src/pages/Home.tsx: 8 cards, white page, #D6DFE8 borders, '
        'two-layer card shadow, emoji icons in rgba-tinted squares, 12px status pills</span></div>'
        + current_home() +
        '  </div>\n'
        '  <div class="cmp-block">'
        '    <div class="cmp-label"><span class="cmp-pill cmp-pill--proposed">PROPOSED</span>'
        '<span class="cmp-note">same 8 cards, slate-50 canvas, #E2E8F0 border, no shadow at rest, '
        'Lucide icons in a 40px tinted square, one restrained badge style</span></div>'
        + proposed_home() +
        '  </div>\n'
        '  <div class="odm-card odm-card--pad cmp-summary">'
        '    <h3 class="odm-section-title">What changed, precisely</h3>'
        '    <div class="odm-table-wrap"><table class="odm-table"><thead><tr>'
        '<th>Element</th><th>Current</th><th>Proposed</th></tr></thead><tbody>'
        '<tr><td class="strong">Page canvas</td><td class="muted">#FFFFFF</td><td>#F8FAFC — cards read as surfaces</td></tr>'
        '<tr><td class="strong">Header</td><td class="muted">135&deg; three-stop gradient, 12px coloured blur</td>'
        '<td>Near-solid navy, 1px inner border, sm shadow</td></tr>'
        '<tr><td class="strong">Card border</td><td class="muted">#D6DFE8 (bespoke)</td><td>#E2E8F0 (slate-200)</td></tr>'
        '<tr><td class="strong">Card radius</td><td class="muted">14px (rounded-xl remap)</td><td>10px</td></tr>'
        '<tr><td class="strong">Card shadow at rest</td><td class="muted">0 1px 3px + 0 4px 12px</td><td>none — border only</td></tr>'
        '<tr><td class="strong">Hover</td><td class="muted">&minus;2px lift, md shadow</td><td>&minus;1px lift, sm shadow, border darkens</td></tr>'
        '<tr><td class="strong">Module icons</td><td class="muted">8 emoji, 5 different tint colours</td>'
        '<td>Lucide, 40px square, 4 tints (blue / navy / green / amber)</td></tr>'
        '<tr><td class="strong">Badges</td><td class="muted">12px pills, 8 fills incl. violet &amp; red for non-risk values</td>'
        '<td>6px radius, neutral by default, colour only for status</td></tr>'
        '<tr><td class="strong">Emoji in metadata</td><td class="muted">📈 📊 🔧 etc. inside every card</td>'
        '<td>none — icon carries identity, text carries meaning</td></tr>'
        '<tr><td class="strong">Font</td><td class="muted">Inter declared but never loaded &rarr; system fallback</td>'
        '<td>Inter loaded explicitly</td></tr>'
        '</tbody></table></div>'
        '  </div>\n'
        '</main>\n'
    )


# ── PRESENTATION CENTER ────────────────────────────────────────────────────

PC_DECKS = [
    ("Monthly KPI Scorecard — August 2026", "Monthly KPI Scorecard", "Generated", "2026-08-31", "2.4 MB"),
    ("O&M Manual Governance Onboarding Progress", "O&M Manual Governance", "Generated", "2026-08-28", "25.6 MB"),
    ("Standard Maintenance Procedures Deck", "Standard Maintenance Procedures", "Coming soon", "—", "—"),
    ("Gantt Planner Deck", "Gantt Planner", "Coming soon", "—", "—"),
    ("Operator Driven Maintenance Summary", "Operator Driven Maintenance", "Coming soon", "—", "—"),
]


def pc_body():
    rows = ""
    for name, cat, status, date, size in PC_DECKS:
        tone = "success" if status == "Generated" else "neutral"
        actions = ('<span class="odm-row" style="gap:6px">'
                   '<button class="odm-btn odm-btn--sm">Download</button>'
                   '<button class="odm-btn odm-btn--sm">View</button>'
                   '<button class="odm-btn odm-btn--icon odm-btn--sm odm-btn--danger">'
                   + svg("trash-2") + '</button></span>')
        rows += ('<tr><td class="strong">%s</td><td><span class="odm-badge odm-badge--neutral">%s</span></td>'
                 '<td><span class="odm-badge odm-badge--%s">%s</span></td>'
                 '<td class="odm-num muted">%s</td><td class="odm-num muted">%s</td>'
                 '<td>%s</td></tr>' % (name, cat, tone, status, date, size, actions))

    gens = "".join(
        '<div class="odm-card odm-card--pad odm-gen">'
        '<div class="odm-row odm-row--between"><span class="odm-card-title">%s</span>'
        '<span class="odm-badge odm-badge--%s">%s</span></div>'
        '<p class="odm-launch-desc odm-mt-2">%s</p>'
        '<button class="odm-btn odm-btn--sm odm-mt-3" %s>%s Generate</button>'
        '</div>' % (title, tone, status, desc, "disabled" if status == "Coming soon" else "", svg("sparkles"))
        for title, desc, status, tone in [
            ("Monthly KPI Scorecard Deck", "Generate a Monthly KPI Scorecard presentation from live scorecard data.", "Ready", "success"),
            ("O&M Manual Governance Onboarding Progress Deck",
             "Generate a three-slide executive presentation with live governance data. Uses proxy metrics (milestone-count).", "Ready", "success"),
            ("Standard Maintenance Procedures Deck",
             "Reserved generator for SMP coverage, procedure maturity, safety-critical steps, and standardization priorities.", "Coming soon", "neutral"),
            ("Gantt Planner Deck",
             "Reserved generator for schedule baselines, milestone status, critical path movement, and upcoming planning decisions.", "Coming soon", "neutral"),
        ])

    return (
        '<header class="odm-hdr"><div class="odm-hdr-in">'
        '<a class="odm-brand" href="home.html"><span class="odm-brand-mark">ODM</span>'
        '<span><h1>Presentation Center</h1><span>Programs</span></span></a>'
        '<div class="odm-hdr-actions">'
        '<a class="odm-hdr-btn" href="home.html">' + svg("panel-left") + 'Dashboard Suite</a>'
        '<button class="odm-hdr-btn">' + svg("upload") + 'Upload Deck</button>'
        '</div></div></header>\n'
        '<main class="odm-main">\n'
        '  <div class="odm-tabs odm-mb-3">'
        '<button class="odm-tab odm-tab--active">Library</button>'
        '<button class="odm-tab">Generators</button>'
        '</div>\n'
        '  <section class="odm-section">\n'
        '    <div class="odm-toolbar">'
        '<span class="odm-search" style="min-width:260px">' + svg("search") +
        '<input class="odm-input odm-input--search" placeholder="Search decks..."></span>'
        '<select class="odm-select" style="width:auto"><option>All Categories</option>'
        '<option>Monthly KPI Scorecard</option><option>O&amp;M Manual Governance</option>'
        '<option>O&amp;M Manual Library</option><option>Standard Maintenance Procedures</option>'
        '<option>Gantt Planner</option><option>Operator Driven Maintenance</option>'
        '<option>Executive Dashboard</option><option>Uploaded Deck</option><option>Other</option></select>'
        '<select class="odm-select" style="width:auto"><option>Newest first</option><option>Oldest first</option>'
        '<option>Name</option><option>Size</option><option>Category</option></select>'
        '<div class="odm-toolbar-spacer"></div>'
        '<span class="odm-badge odm-badge--neutral">28 files</span>'
        '</div>\n'
        '  </section>\n'
        '  <section class="odm-section"><div class="odm-card"><div class="odm-table-wrap">'
        '<table class="odm-table"><thead><tr><th>Deck</th><th>Category</th><th>Status</th>'
        '<th>Generated</th><th>Size</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        '<div class="odm-table-foot"><span>Showing 5 of 28 decks</span>'
        '<span class="odm-row">' + svg("chevron-right") + 'Next</span></div></div></section>\n'
        '  <section class="odm-section">'
        '    <div class="odm-section-head"><h3 class="odm-section-title">Deck Generators</h3>'
        '<span class="odm-faint" style="font-size:11.5px">Existing generator registry — 2 ready, 2 reserved</span></div>'
        '    <div class="odm-grid-2">' + gens + '</div>\n'
        '  </section>\n'
        '</main>\n'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>\n'
    )
