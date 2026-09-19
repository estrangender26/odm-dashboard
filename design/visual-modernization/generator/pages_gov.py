"""O&M Manual Governance mockup page (mockup only).

Static HTML served today by api/boot.ts at /governance from public/governance.html.
Structure, tabs, milestone model, TOC labels and status lexicon are reproduced
verbatim. NOTE: the current file references undefined CSS variables (--t2, --bg,
--red, --green, --blue, --orange) in inline styles; those declarations are
silently dropped by the browser. This mockup does not reproduce that defect —
it uses the defined token set.
"""
import math
from odm_icons import svg


MILESTONES = [
    ("M1", "T&amp;C Check Sheets Complete", "-6mo", "PRE-PPP", "#00A8D2", "achieved", "Achieved"),
    ("M2", "Wet Commissioning Passed", "-4mo", "PRE-PPP", "#00A8D2", "achieved", "Achieved"),
    ("M3", "Defects/Punchlist Closed", "-1mo", "PRE-PPP", "#00A8D2", "in_progress", "In progress"),
    ("M4", "PM Task Lists in SAP-PM", "+2mo", "PPP", "#2AAA8A", "achieved", "Achieved"),
    ("M5", "PM/PdM Execution Started", "+6mo", "PPP", "#2AAA8A", "achieved", "Achieved"),
    ("M6", "Training Completed", "+11mo", "PPP", "#2AAA8A", "planned_open", "Planned by now — still open"),
    ("M7", "Plan Refined (PPP Learnings)", "+13mo", "POST-PPP", "#0066A6", "upcoming", "Upcoming"),
    ("M8", "Contracts/SLA Activated", "+16mo", "POST-PPP", "#0066A6", "upcoming", "Upcoming"),
    ("M9", "BAU Governance Established", "+19mo", "POST-PPP", "#0066A6", "upcoming", "Upcoming"),
]

READY_CHIP = {
    "achieved": ("#169873", "odm-chip--ok"),
    "in_progress": ("#b45309", "odm-chip--warn"),
    "planned_open": ("#d1383e", "odm-chip--bad"),
    "upcoming": ("#64748b", "odm-chip--muted"),
}


def scurve_svg():
    """Logistic S-curve: Planned (#00a8d2) vs Actual (#d1383e)."""
    w, h = 900, 260
    left, right, top, bottom = 46, 14, 14, 30
    plot_w, plot_h = w - left - right, h - top - bottom
    months = 28

    def x(i):
        return left + plot_w * i / (months - 1)

    def y(v):
        return top + plot_h * (1 - v)

    def logistic(i, k=0.30, mid=13.0):
        return 1 / (1 + math.exp(-k * (i - mid)))

    planned = [logistic(i) for i in range(months)]
    # The actual curve lags and flattens below plan, as the module's data showed.
    actual = [logistic(i, k=0.26, mid=15.2) * 0.94 for i in range(months)]

    grid = ""
    for frac in (0, .25, .5, .75, 1):
        yy = y(frac)
        grid += ('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#E2E8F0" stroke-width="1"/>'
                 '<text x="%d" y="%.1f" font-size="10" fill="#94A3B8" text-anchor="end">%d%%</text>'
                 % (left, yy, w - right, yy, left - 8, yy + 3.5, frac * 100))
    for i in range(0, months, 4):
        grid += ('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="#F1F5F9" stroke-width="1"/>'
                 '<text x="%.1f" y="%d" font-size="10" fill="#94A3B8" text-anchor="middle">M%d</text>'
                 % (x(i), top, x(i), h - bottom, x(i), h - bottom + 14, i + 1))
    # Phase bands: Pre-PPP (-8..0) / PPP (0..+12) / Post-PPP (+12..+20)
    bands = ""
    for start, end, color, label in ((0, 8, "#00A8D2", "Pre-PPP"), (8, 20, "#2AAA8A", "PPP"), (20, 27, "#0066A6", "Post-PPP")):
        bx, bw = x(start), x(end) - x(start)
        bands += ('<rect x="%.1f" y="%d" width="%.1f" height="4" rx="2" fill="%s" opacity=".55"/>'
                  '<text x="%.1f" y="%d" font-size="10" font-weight="700" fill="%s" text-anchor="middle" '
                  'letter-spacing=".5">%s</text>'
                  % (bx, top - 8, bw, color, bx + bw / 2, top - 12, color, label))

    p_pts = " ".join("%.1f,%.1f" % (x(i), y(v)) for i, v in enumerate(planned))
    a_pts = " ".join("%.1f,%.1f" % (x(i), y(v)) for i, v in enumerate(actual))

    return (
        '<svg viewBox="0 0 %d %d" class="odm-scurve" role="img" aria-label="S-Curve progress: planned versus actual cumulative earned value">'
        '%s%s'
        '<polyline points="%s" fill="none" stroke="#00a8d2" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
        '<polyline points="%s" fill="none" stroke="#d1383e" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
        '</svg>' % (w, h, bands, grid, p_pts, a_pts)
    )


def gov_body():
    rows = ""
    band_specs = [("PRE-PPP", "M1&ndash;M3", "#00A8D2"), ("PPP", "M4&ndash;M6", "#2AAA8A"),
                  ("POST-PPP", "M7&ndash;M9", "#0066A6")]
    current_phase = None
    for code, name, offset, phase, phase_color, status, label in MILESTONES:
        if phase != current_phase:
            current_phase = phase
            spec = next(b for b in band_specs if b[0] == phase)
            rows += ('<tr class="odm-phase-band"><td colspan="7">'
                     '<span class="odm-band-dot" style="background:%s"></span>%s'
                     '<span class="odm-band-range">%s</span></td></tr>' % (spec[2], spec[0], spec[1]))
        color, cls = READY_CHIP[status]
        done = "checked" if status in ("achieved",) else ""
        check = ('<span class="odm-check odm-check--on">%s</span>' % svg("check")) if done else '<span class="odm-check"></span>'
        uploads = {"achieved": (3, 3, True), "in_progress": (2, 3, False),
                   "planned_open": (0, 3, False), "upcoming": (0, 3, False)}[status]
        up_n, up_m, ready = uploads
        up_badge = ('<span class="odm-badge odm-badge--%s">%s</span>'
                    % ("success" if ready else "danger", "READY" if ready else "INCOMPLETE"))
        rows += (
            '<tr>'
            '<td class="strong">%s</td>'
            '<td>%s<div class="odm-ms-phase"><span class="odm-dot" style="background:%s"></span>%s</div>'
            '<div class="odm-ms-uploads"><span class="odm-faint">%d / %d uploads</span>%s</div></td>'
            '<td class="muted">%s</td>'
            '<td class="odm-num">2026-%s</td>'
            '<td class="odm-num">&mdash;</td>'
            '<td><span class="odm-chip %s">%s</span></td>'
            '<td>%s</td>'
            '</tr>' % (code, name, phase_color, phase, up_n, up_m, up_badge, offset,
                       ("0%d" % (int(code[1]) + 2)), cls, label, check)
        )

    return (
        '<header class="odm-hdr">\n'
        '  <div class="odm-hdr-in">\n'
        '    <a class="odm-brand" href="home.html" title="Return to Program Oversight Center">\n'
        '      <span class="odm-brand-mark">ODM</span>\n'
        '      <span><h1>O&amp;M Manual Governance</h1><span>Facility Onboarding Alignment Tracker</span></span>\n'
        '    </a>\n'
        '  </div>\n'
        '</header>\n'
        # Second toolbar row: the module's own controls, unchanged in set and order
        '<div class="odm-subbar">\n'
        '  <div class="odm-subbar-in">\n'
        '    <span class="odm-field odm-field--inline"><label class="odm-label">FACILITY</label>'
        '<select class="odm-select"><option>AGLIPAY STP</option><option>HTT STP</option>'
        '<option>EASTBAY PH-2 TP</option><option>KAYSAKAT TP</option></select></span>\n'
        '    <span class="odm-field odm-field--inline"><label class="odm-label">PPP START</label>'
        '<input class="odm-input" value="2026-04-01" disabled style="width:132px"></span>\n'
        '    <span class="odm-sync">Ready</span>\n'
        '    <div class="odm-toolbar-spacer"></div>\n'
        '    <button class="odm-btn">' + svg("refresh-cw") + 'Refresh</button>\n'
        '    <button class="odm-btn">Reset</button>\n'
        '    <button class="odm-btn">' + svg("pencil") + 'Edit</button>\n'
        '    <button class="odm-btn odm-btn--navy">' + svg("sparkles") + 'AI Insights</button>\n'
        '  </div>\n'
        '</div>\n'

        '<main class="odm-main">\n'
        '  <div class="odm-tabs odm-tabs--rail">'
        '<button class="odm-tab odm-tab--active">Progress</button>'
        '<button class="odm-tab">Deliverables</button>'
        '<button class="odm-tab">Acceptance</button>'
        '<button class="odm-tab">References</button>'
        '</div>\n'

        '  <section class="odm-section odm-mt-4">\n'
        '    <div class="odm-section-head">'
        '      <h3 class="odm-section-title">S-Curve Progress &mdash; Logistic Model</h3>'
        '      <span class="odm-badge odm-badge--neutral">28-Month Project | 30-Month Curve View</span>'
        '    </div>\n'
        '    <div class="odm-card">\n'
        '      <div class="odm-grid-4 odm-sc-tiles">'
        '        <div class="odm-sc-tile"><span class="odm-sc-label">Planned</span>'
        '<span class="odm-sc-value" style="color:#0066A6">72.0%</span></div>'
        '        <div class="odm-sc-tile"><span class="odm-sc-label">Actual</span>'
        '<span class="odm-sc-value" style="color:#DC2626">61.5%</span></div>'
        '        <div class="odm-sc-tile"><span class="odm-sc-label">Variance</span>'
        '<span class="odm-sc-value" style="color:#DC2626">&minus;10.5%</span></div>'
        '        <div class="odm-sc-tile"><span class="odm-sc-label">RAG</span>'
        '<span class="odm-chip odm-chip--bad">RED &mdash; Behind schedule (&gt;10%)</span></div>'
        '      </div>\n'
        '      <div class="odm-card-body">' + scurve_svg() + '</div>\n'
        '      <div class="odm-sc-caption">Planned = cumulative earned value at target dates (11.1% per milestone) '
        '&nbsp;|&nbsp; Actual = cumulative earned value at completion dates (11.1% per milestone) &nbsp;|&nbsp; '
        '30-Month View &nbsp;|&nbsp; Pre-PPP (&minus;8 to 0) &rarr; PPP (0 to +12) &rarr; Post-PPP (+12 to +20) '
        '&nbsp;|&nbsp; PPP Start drives all milestone calendar dates</div>\n'
        '      <div class="odm-legend odm-legend--sunk">'
        '<span class="odm-legend-item"><i style="background:#00a8d2"></i>Planned</span>'
        '<span class="odm-legend-item"><i style="background:#d1383e"></i>Actual</span>'
        '<span class="odm-legend-item"><i style="background:#059669"></i>GREEN &mdash; On track or ahead</span>'
        '<span class="odm-legend-item"><i style="background:#e8890c"></i>AMBER &mdash; Slight delay (&le;10%)</span>'
        '<span class="odm-legend-item"><i style="background:#d1383e"></i>RED &mdash; Behind schedule (&gt;10%)</span>'
        '</div>\n'
        '    </div>\n'
        '  </section>\n'

        '  <section class="odm-section">\n'
        '    <div class="odm-section-head">'
        '      <h3 class="odm-section-title">Milestone Tracker &amp; Timeline &mdash; AGLIPAY STP</h3>'
        '      <span class="odm-badge odm-badge--warning">6 / 9</span>'
        '    </div>\n'
        '    <div class="odm-card"><div class="odm-table-wrap"><table class="odm-table">\n'
        '      <thead><tr><th>M#</th><th>Milestone</th><th>Offset</th><th>Target Date</th>'
        '<th>Completed</th><th>Status</th><th>Done</th></tr></thead>\n'
        '      <tbody>' + rows + '</tbody>\n'
        '    </table></div>\n'
        '    <div class="odm-table-foot"><span>PRE-PPP M1&ndash;M3 &nbsp;&middot;&nbsp; PPP M4&ndash;M6 &nbsp;&middot;&nbsp; POST-PPP M7&ndash;M9</span>'
        '<span class="odm-row">' + svg("info") + '<span>Milestones completed out of 9 total &middot; TOC items with uploaded documents out of 14 total</span></span></div>\n'
        '    </div>\n'
        '  </section>\n'
        '</main>\n'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>\n'
    )
