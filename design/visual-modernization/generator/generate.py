#!/usr/bin/env python3
"""Generator for the ODM visual modernization mockup artifact.

MOCKUP ONLY. This script writes static HTML into
design/visual-modernization/ and touches nothing else. It is committed as
documentation of how the artifact was produced and to make iteration cheap
(one place to change the shared chrome).

Run:  python3 design/visual-modernization/generator/generate.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # design/visual-modernization
sys.path.insert(0, HERE)

from odm_icons import svg  # noqa: E402
from pages_system import system_body  # noqa: E402
from pages_kpi import kpi_body  # noqa: E402
from pages_gov import gov_body  # noqa: E402
from pages_gantt import gantt_body  # noqa: E402
from pages_ops import projects_body, odm_body  # noqa: E402
from pages_docs import smp_body, manuals_body  # noqa: E402
from pages_compare import compare_body, pc_body  # noqa: E402

from odm_shared import mockbar, app_header, ai_fab, page_head, launch_card, HOME_CARDS  # noqa: E402

PAGE_TMPL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s — ODM Visual Modernization Mockup</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/odm-design.css">
<link rel="stylesheet" href="assets/odm-mockup.css">
</head>
<body class="odm-mockpage">
%(mockbar)s
<div class="odm-app">
%(body)s
</div>
%(fab)s
</body>
</html>
"""


def write_page(filename, title, body, fab=True):
    html = PAGE_TMPL % {
        "title": title,
        "mockbar": mockbar(filename),
        "body": body,
        "fab": ai_fab() if fab else "",
    }
    path = os.path.join(ROOT, filename)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("wrote %s (%d bytes)" % (filename, len(html)))


# ── Shared fragments ────────────────────────────────────────────────────────

# ── HOME / Program Oversight Center ─────────────────────────────────────────
# Card order, titles, descriptions, badges and destinations are copied verbatim
# from src/pages/Home.tsx at b52cbae. Only the surface treatment changes.

def home_body():
    cards = "".join(
        launch_card(c["icon"], c["tint"], c["title"], c.get("tagline"), c["desc"],
                    c["badges"], c["cta"], c["href"], c.get("tag"))
        for c in HOME_CARDS
    )
    return (
        app_header() +
        '<main class="odm-main odm-main--narrow">\n'
        '  ' + page_head("Dashboard Suite", "Select a dashboard to access your O&amp;M management tools") +
        '  <div class="odm-launch-grid">\n' + cards + '  </div>\n'
        '</main>\n'
        '<footer class="odm-footer">\n'
        '  <div class="odm-footer-in">Program Oversight Center &copy; 2026</div>\n'
        '</footer>\n'
    )



def index_body():
    """Landing / review page for the mockup artifact."""
    cards = "".join(
        '<a class="odm-landing-card" href="%s"><h3>%s</h3><p>%s</p>'
        '<span class="odm-launch-cta">Open%s</span></a>'
        % (f, label, desc, svg("arrow-right"))
        for f, label, desc in [
            ("compare-home.html", "Home &mdash; current vs proposed",
             "The same 8 cards, side by side with identical content. Start here to judge the direction."),
            ("system.html", "Visual system specification",
             "Palette, type scale, buttons, badges, tables, alerts, icons, radius and elevation."),
            ("home.html", "Home / Program Oversight Center",
             "The primary mockup: an enterprise application launcher."),
            ("monthly-kpi.html", "Monthly KPI Scorecard",
             "Restrained chrome so KPI numbers and performance status carry the page."),
            ("governance.html", "O&amp;M Manual Governance",
             "S-curve, milestone tracker and the governance status lexicon."),
            ("smp.html", "Standard Maintenance Procedures",
             "Document control, applicability and revision history for a controlled library."),
            ("om-manuals.html", "O&amp;M Manuals Library",
             "Folder hierarchy, file list and PDF viewer as a document-management surface."),
            ("gantt.html", "ODM Primavera Lite",
             "Schedule semantics preserved verbatim: critical path, milestones, data date, today."),
            ("projects-without-ppp.html", "Projects without PPP",
             "Six submission KPI tiles and the 16-column monitoring table."),
            ("odm.html", "Operator-Driven Maintenance",
             "Dense operational tables, tab set, insights and the two existing charts."),
            ("presentation-center.html", "Presentation Center",
             "Deck library and the existing generator registry."),
        ]
    )
    return (
        '<main class="odm-main">\n'
        '  <div class="odm-page-head"><div>'
        '    <span class="odm-eyebrow">Phase 0 &middot; design mockup only</span>'
        '    <h2 class="odm-page-title">ODM Dashboard &mdash; Visual Modernization Proposal</h2>'
        '    <p class="odm-page-sub">High-fidelity mockups of the retained ODM modules after a coherent visual '
        'normalization. Structure, workflows, information hierarchy and business terminology are unchanged; '
        'only the surface language is modernized.</p>'
        '  </div></div>\n'

        '  <div class="odm-gate">' + svg("triangle-alert") +
        '<div><b>Nothing here is implemented.</b>'
        '<p>This artifact is standalone design evidence. No production application code, route, workflow, API, '
        'database object or deployment was modified. The two decommissioned modules are not referenced or restored. '
        'Review the mockups and approve or redirect the visual direction; implementation is a separate, separately '
        'authorized mission.</p></div></div>\n'

        '  <section class="odm-section odm-mt-4">'
        '    <div class="odm-section-head"><h3 class="odm-section-title">What was measured in the current application</h3>'
        '    <span class="odm-faint" style="font-size:11.5px">origin/main b52cbae &middot; production build</span></div>'
        '    <div class="odm-facts">'
        '      <div class="odm-fact"><b>198</b><span>emoji / glyph characters used as UI icons across 11 files</span></div>'
        '      <div class="odm-fact"><b>3</b><span>navy shades in use: #0B1D44, #16324F, #0D2137</span></div>'
        '      <div class="odm-fact"><b>13</b><span>distinct border-radius values: 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 16, 20, 999</span></div>'
        '      <div class="odm-fact"><b>2</b><span>competing "default" border colours: #D6DFE8 (77&times;) and #E2E8F0 (44&times;)</span></div>'
        '      <div class="odm-fact"><b>4</b><span>muted-text greys: #5A6B7D, #8BA3B8, #64748B, #94A3B8</span></div>'
        '      <div class="odm-fact"><b>0</b><span>font files loaded — Inter is declared everywhere but never served</span></div>'
        '      <div class="odm-fact"><b>3</b><span>different header behaviours: static, sticky, fixed + shimmer</span></div>'
        '      <div class="odm-fact"><b>0</b><span>lucide-react or shadcn imports in SMP or O&amp;M Manuals Library</span></div>'
        '    </div>'
        '  </section>\n'

        '  <section class="odm-section">'
        '    <div class="odm-section-head"><h3 class="odm-section-title">Mockup screens</h3></div>'
        '    <div class="odm-landing">' + cards + '</div>'
        '  </section>\n'

        '  <section class="odm-section"><div class="odm-card odm-card--pad">'
        '    <h3 class="odm-section-title">How to review</h3>'
        '    <ul class="odm-review">'
        '      <li><b>1.</b> Open <a class="odm-link" href="compare-home.html">Home &mdash; current vs proposed</a> first. '
        'If the direction is wrong there, nothing else matters.</li>'
        '      <li><b>2.</b> Check <a class="odm-link" href="system.html">the visual system</a> for the token set, then spot-check '
        'two or three module screens against the live production app in another tab.</li>'
        '      <li><b>3.</b> Confirm the semantic colours are still doing their job on '
        '<a class="odm-link" href="monthly-kpi.html">Monthly KPI</a> and '
        '<a class="odm-link" href="gantt.html">Primavera Lite</a>.</li>'
        '      <li><b>4.</b> Reply with what to keep, what to change, and what to drop. Nothing will be implemented '
        'until you explicitly approve the direction.</li>'
        '    </ul>'
        '  </div></section>\n'

        '  <section class="odm-section"><div class="odm-card"><div class="odm-table-wrap"><table class="odm-table">'
        '    <thead><tr><th>Self-review question</th><th>Answer</th><th>Evidence</th></tr></thead><tbody>'
        '    <tr><td class="strong">1. Current ODM layout preserved?</td><td><span class="odm-badge odm-badge--success">Yes</span></td>'
        '<td class="muted">Same header, same card grid, same page order, same destinations</td></tr>'
        '    <tr><td class="strong">2. Workflows preserved?</td><td><span class="odm-badge odm-badge--success">Yes</span></td>'
        '<td class="muted">Every control on every screen exists on the corresponding current screen</td></tr>'
        '    <tr><td class="strong">3. Information hierarchy preserved?</td><td><span class="odm-badge odm-badge--success">Yes</span></td>'
        '<td class="muted">Section order, table columns and KPI order are transcribed verbatim</td></tr>'
        '    <tr><td class="strong">4. New functionality introduced?</td><td><span class="odm-badge odm-badge--success">No</span></td>'
        '<td class="muted">No sidebar, no search system, no invented widgets, no new charts</td></tr>'
        '    <tr><td class="strong">5. Either deleted module restored?</td><td><span class="odm-badge odm-badge--success">No</span></td>'
        '<td class="muted">8 cards only; Post-Planning and Maintenance Planning do not appear anywhere</td></tr>'
        '    <tr><td class="strong">6. Engineering density preserved?</td><td><span class="odm-badge odm-badge--success">Yes</span></td>'
        '<td class="muted">13px base retained; tables stay compact (5&ndash;8px cell padding)</td></tr>'
        '    <tr><td class="strong">7. Semantic KPI / Gantt colours preserved?</td><td><span class="odm-badge odm-badge--success">Yes</span></td>'
        '<td class="muted">Gantt keeps #2563EB / #DC2626 / #059669 / #7C3AED / #EF4444 exactly; KPI keeps the 4-state lexicon</td></tr>'
        '    <tr><td class="strong">8. Visually unified across modules?</td><td><span class="odm-badge odm-badge--success">Yes</span></td>'
        '<td class="muted">One border, one radius scale, one shadow scale, one control set</td></tr>'
        '    <tr><td class="strong">9. Still recognisably Manila Water / ODM?</td><td><span class="odm-badge odm-badge--success">Yes</span></td>'
        '<td class="muted">Navy header, MW blue #005BAC, existing facility and milestone terminology untouched</td></tr>'
        '    <tr><td class="strong">10. Implementable on the existing stack?</td><td><span class="odm-badge odm-badge--success">Yes</span></td>'
        '<td class="muted">Plain CSS custom properties + Tailwind 3.4 + shadcn New York + lucide-react, all already installed</td></tr>'
        '    </tbody></table></div></div></section>\n'
        '</main>\n'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>\n'
    )


if __name__ == "__main__":
    write_page("home.html", "Home / Program Oversight Center", home_body())
    write_page("system.html", "Visual System", system_body(), fab=False)
    write_page("monthly-kpi.html", "Monthly KPI Scorecard", kpi_body())
    write_page("governance.html", "O&M Manual Governance", gov_body())
    write_page("smp.html", "Standard Maintenance Procedures", smp_body())
    write_page("om-manuals.html", "O&M Manuals Library", manuals_body())
    write_page("gantt.html", "ODM Primavera Lite", gantt_body())
    write_page("projects-without-ppp.html", "Projects without PPP", projects_body())
    write_page("odm.html", "Operator-Driven Maintenance", odm_body())
    write_page("presentation-center.html", "Presentation Center", pc_body())
    write_page("compare-home.html", "Home — current vs proposed", compare_body(), fab=False)
    write_page("index.html", "Start here", index_body(), fab=False)
