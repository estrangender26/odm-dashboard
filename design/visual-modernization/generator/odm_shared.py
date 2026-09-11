"""Shared page fragments for the mockup generator (mockup only)."""
from odm_icons import svg

PAGES = [
    ("index.html",            "Start here"),
    ("system.html",           "Visual system"),
    ("compare-home.html",     "Home · compare"),
    ("home.html",             "Home"),
    ("monthly-kpi.html",      "Monthly KPI"),
    ("governance.html",       "Governance"),
    ("smp.html",              "SMP"),
    ("om-manuals.html",       "O&M Manuals"),
    ("gantt.html",            "Primavera Lite"),
    ("projects-without-ppp.html", "Projects w/o PPP"),
    ("odm.html",              "Operator-Driven Maint."),
    ("presentation-center.html", "Presentation Ctr."),
]


def mockbar(current_file):
    links = []
    for f, label in PAGES:
        cls = " class=\"is-current\"" if f == current_file else ""
        links.append('<a href="%s"%s>%s</a>' % (f, cls, label))
    return (
        '<div class="odm-mockbar">\n'
        '  <div class="odm-mockbar-in">\n'
        '    <span class="odm-mockbar-id"><i></i>Design mockup · not production</span>\n'
        '    <nav class="odm-mockbar-nav">%s</nav>\n'
        '  </div>\n'
        '</div>\n' % "".join(links)
    )


def app_header():
    """The proposed application header — same slots as the current one."""
    return (
        '<header class="odm-hdr">\n'
        '  <div class="odm-hdr-in">\n'
        '    <a class="odm-brand" href="home.html">\n'
        '      <span class="odm-brand-mark">ODM</span>\n'
        '      <span>\n'
        '        <h1>Program Oversight Center</h1>\n'
        '        <span>Programs</span>\n'
        '      </span>\n'
        '    </a>\n'
        '    <div class="odm-hdr-actions">\n'
        '      <button class="odm-hdr-btn" type="button">' + svg("info") + 'Help</button>\n'
        '      <button class="odm-hdr-user" type="button">\n'
        '        <span class="odm-avatar">GB</span>\n'
        '        <span class="odm-hdr-user-name">Gerald Balucan</span>\n'
        '        ' + svg("chevron-down") + '\n'
        '      </button>\n'
        '    </div>\n'
        '  </div>\n'
        '</header>\n'
    )


def ai_fab():
    """The existing floating AI affordance — same position, normalized colour."""
    return (
        '<button class="odm-ai-fab" type="button" title="ODM Dashboard AI">'
        + svg("sparkles") + '<span>Ask AI</span></button>\n'
    )


def page_head(title, subtitle, right=""):
    r = ('<div class="odm-row odm-row--wrap">%s</div>' % right) if right else ""
    return (
        '<div class="odm-page-head">\n'
        '  <div>\n'
        '    <h2 class="odm-page-title">%s</h2>\n'
        '    <p class="odm-page-sub">%s</p>\n'
        '  </div>\n'
        '  %s\n'
        '</div>\n' % (title, subtitle, r)
    )


def launch_card(icon, tint, title, tagline, desc, badges, cta, href, tag=None):
    tag_html = '<span class="odm-badge odm-badge--new">%s</span>' % tag if tag else ""
    badge_html = "".join(
        '<span class="odm-badge odm-badge--%s">%s</span>' % (kind, text)
        for text, kind in badges
    )
    tagline_html = '<p class="odm-launch-tagline">%s</p>' % tagline if tagline else ""
    return (
        '<a class="odm-launch" href="%s">\n'
        '  <div class="odm-launch-top">\n'
        '    <span class="odm-launch-icon odm-launch-icon--%s">%s</span>\n'
        '    <div class="odm-grow">\n'
        '      <div class="odm-launch-name"><h3>%s</h3>%s</div>\n'
        '      %s\n'
        '    </div>\n'
        '  </div>\n'
        '  <p class="odm-launch-desc">%s</p>\n'
        '  <div class="odm-launch-meta">%s</div>\n'
        '  <span class="odm-launch-cta">%s%s</span>\n'
        '</a>\n' % (href, tint, svg(icon), title, tag_html, tagline_html, desc, badge_html, cta, svg("arrow-right"))
    )


# ── HOME / Program Oversight Center ─────────────────────────────────────────
# Card order, titles, descriptions, badges and destinations are copied verbatim
# from src/pages/Home.tsx at b52cbae. Only the surface treatment changes.
HOME_CARDS = [
    dict(icon="shield-check", tint="blue", title="O&amp;M Manual Governance",
         tagline=None, href="governance.html",
         desc="Track 4 facilities (AGLIPAY, HTT, EASTBAY, KAYSAKAT) through 9 milestones with S-Curve progress and deliverables.",
         badges=[("4 Facilities", "neutral"), ("9 Milestones", "neutral"), ("14 TOC Items", "neutral")],
         cta="Open Dashboard"),
    dict(icon="activity", tint="blue", title="Monthly KPI Scorecard",
         tagline=None, href="monthly-kpi.html",
         desc="Track 8 KPIs across 5 business units with color-coded performance, Excel import, and budget analytics.",
         badges=[("5 BUs", "neutral"), ("8 KPIs", "neutral"), ("Excel Import", "neutral")],
         cta="Open Scorecard"),
    dict(icon="factory", tint="green", title="Operator-Driven Maintenance",
         tagline=None, href="odm.html",
         desc="Corporate analytics, predictive insights, inspector tracking, data quality, and escalation monitoring.",
         badges=[("Analytics", "neutral"), ("Predictive", "neutral"), ("Insights", "neutral")],
         cta="Open Dashboard"),
    dict(icon="calendar-days", tint="navy", title="ODM Primavera Lite",
         tagline=None, href="gantt.html",
         desc="ODM Primavera Lite Online — link-based project scheduling. Create WBS, activities, dependencies, and schedules without an account.",
         badges=[("Gantt", "neutral"), ("CRUD", "neutral"), ("Excel", "neutral")],
         cta="Open Primavera Lite"),
    dict(icon="book-open-check", tint="navy", title="Standard Maintenance Procedures", tag="New",
         tagline="Centralized repository for SOPs, SMPs, and preventive maintenance documentation.",
         href="smp.html",
         desc="Browse maintenance procedure documents organized by equipment type and system. PDF viewer with upload/download support. Searchable and filterable document library.",
         badges=[("Documents", "neutral"), ("PDF", "neutral"), ("Upload", "neutral"), ("Download", "neutral")],
         cta="Open SMP Library"),
    dict(icon="library", tint="navy", title="O&amp;M Manuals Library",
         tagline="Full O&amp;M Manuals for each facility — search, view, and download.",
         href="om-manuals.html",
         desc="Browse full Operation and Maintenance Manuals for each facility. Search by plant, equipment type, or system. View and download PDF manuals.",
         badges=[("Manuals", "neutral"), ("PDF", "neutral"), ("Search", "neutral"), ("Download", "neutral")],
         cta="Open O&amp;M Library"),
    dict(icon="clipboard-list", tint="blue", title="Projects without PPP", tag="New",
         tagline="Masterdata submittal monitoring for 50 projects — upload Excel/PDF, track submission status.",
         href="projects-without-ppp.html",
         desc="Monitoring-first dashboard: submission KPIs, filtering, and per-project masterdata upload for the Projects without PPP population.",
         badges=[("50 Projects", "neutral"), ("Submitted", "success"), ("Upload", "neutral")],
         cta="Open Monitoring"),
    dict(icon="presentation", tint="blue", title="Presentation Center",
         tagline="Create, manage, and generate PowerPoint presentations from dashboard data.",
         href="presentation-center.html",
         desc="Upload PowerPoint decks, maintain a presentation library, generate Monthly KPI Scorecard decks, and prepare for future AI-assisted deck generation.",
         badges=[("PPTX", "neutral"), ("Generate", "neutral"), ("Library", "neutral")],
         cta="Open Presentation Center"),
]
