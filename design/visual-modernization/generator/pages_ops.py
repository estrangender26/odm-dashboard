"""Projects without PPP + Operator-Driven Maintenance mockup pages (mockup only)."""
from odm_icons import svg
from pages_gantt import module_header


# ── PROJECTS WITHOUT PPP ───────────────────────────────────────────────────

P_KPIS = [
    ("Total Projects", "50", "authoritative population", "#0B1D44", "#16324F", 100),
    ("Submitted", "0", "projects with current masterdata", "#047857", "#059669", 0),
    ("Not Submitted", "50", "projects pending masterdata", "#B45309", "#D97706", 100),
    ("Submission Rate", "0%", "submitted / total &times; 100", "#005BAC", "#005BAC", 0),
    ("Total Files Submitted", "0", "current masterdata files", "#005BAC", "#005BAC", 0),
    ("Submitted Today", "0", "this week: 0", "#047857", "#059669", 0),
]

P_COLS = ["Tracking ID", "Masterdata Status", "Project Name", "Project Phase", "Project Manager",
          "Construction Manager", "AMD Grid Head", "Files", "Latest Submission", "Submitted By",
          "PS Code", "Major Project Tag", "Contractor", "Work Package", "LS/PS", "Action"]

P_ROWS = [
    ("PWP-0001", "Not Submitted", "Balara Filter 1 Rehabilitation", "Construction", "R. Delos Santos",
     "M. Aquino", "J. Ramos", 0, "—", "—", "PS-1042", "Major", "JV Builders Inc.", "WP-01", "With LS/PS"),
    ("PWP-0002", "Submitted", "Marikina North STP Upgrade", "Construction", "L. Fernandez",
     "A. Cruz", "J. Ramos", 2, "2026-08-14", "L. Fernandez", "PS-1043", "Major", "PrimeWater Contractors",
     "WP-02", "No LS/PS"),
    ("PWP-0003", "Not Submitted", "Pag-Asa LS Package 3", "Pre-Construction", "R. Delos Santos",
     "M. Aquino", "K. Villanueva", 0, "—", "—", "PS-1044", "Standard", "Northgate Builders", "WP-03", "With LS/PS"),
    ("PWP-0004", "Submitted", "Balara PS Pump Replacement", "Construction", "T. Ocampo",
     "A. Cruz", "J. Ramos", 1, "2026-07-30", "T. Ocampo", "PS-1045", "Major", "JV Builders Inc.",
     "WP-04", "No LS/PS"),
    ("PWP-0005", "Not Submitted", "Eastbay Transmission Main", "Planning", "L. Fernandez",
     "—", "K. Villanueva", 0, "—", "—", "PS-1046", "Standard", "Summit Engineering", "WP-05", "With LS/PS"),
]

P_STATUS = {"Submitted": "success", "Not Submitted": "warning"}


def projects_body():
    kpis = ""
    for label, value, caption, textc, barc, pct in P_KPIS:
        kpis += (
            '<div class="odm-kpi">'
            '<div class="odm-kpi-label">%s</div>'
            '<div class="odm-kpi-value" style="color:%s">%s</div>'
            '<div class="odm-progress odm-mt-2"><i style="width:%d%%;background:%s"></i></div>'
            '<div class="odm-kpi-foot">%s</div></div>' % (label, textc, value, pct, barc, caption)
        )

    head = "".join("<th%s>%s</th>" % (' class="num"' if h == "Files" else "", h) for h in P_COLS)
    rows = ""
    for (tid, status, name, phase, pm, cm, amd, files, latest, by, ps, tag, contractor, wp, lsps) in P_ROWS:
        badge = P_STATUS[status]
        phase_cls = "odm-badge--info" if phase == "Construction" else "odm-badge--success"
        rows += (
            '<tr><td class="strong">%s</td>'
            '<td><span class="odm-badge odm-badge--%s"><span class="odm-dot"></span>%s</span></td>'
            '<td>%s</td>'
            '<td><span class="odm-badge %s">%s</span></td>'
            '<td class="muted">%s</td><td class="muted">%s</td><td class="muted">%s</td>'
            '<td class="num">%d</td><td class="odm-num muted">%s</td><td class="muted">%s</td>'
            '<td class="odm-mono muted">%s</td><td class="muted">%s</td><td class="muted">%s</td>'
            '<td class="muted">%s</td><td class="muted">%s</td>'
            '<td><span class="odm-row" style="gap:6px">'
            '<button class="odm-btn odm-btn--sm odm-btn--primary">Upload</button>'
            '<button class="odm-btn odm-btn--sm">History</button>'
            '</span></td></tr>'
            % (tid, badge, status, name, phase_cls, phase, pm, cm, amd, files, latest, by, ps, tag,
               contractor, wp, lsps)
        )

    filters = "".join(
        '<span class="odm-field odm-field--stack"><label class="odm-label">%s</label>'
        '<select class="odm-select"><option>%s</option></select></span>' % (lbl, opt)
        for lbl, opt in [("STATUS", "All"), ("PROJECT MANAGER", "All"), ("CONSTRUCTION MANAGER", "All"),
                         ("AMD GRID HEAD", "All"), ("PROJECT PHASE", "All"), ("MAJOR PROJECT TAG", "All"),
                         ("CONTRACTOR", "All"), ("LS/PS", "All")]
    )

    return (
        module_header("Projects without PPP &mdash; Masterdata Submittal Monitoring", "Monitoring", back=True) +
        # Sub-bar: panel title + live counter, exactly as today
        '<div class="odm-subbar"><div class="odm-subbar-in">\n'
        '  <span class="odm-section-title">Projects without PPP &mdash; Masterdata Submittal</span>\n'
        '  <span class="odm-badge odm-badge--neutral">Showing 50 of 50 projects</span>\n'
        '  <div class="odm-toolbar-spacer"></div>\n'
        '  <span class="odm-sync">Updated 11 Sep 2026, 10:41 AM</span>\n'
        '</div></div>\n'

        '<main class="odm-main">\n'
        '  <section class="odm-section"><div class="odm-kpi-grid odm-kpi-grid--6">' + kpis + '</div></section>\n'

        '  <section class="odm-section">\n'
        '    <div class="odm-toolbar">\n'
        '      <span class="odm-search" style="min-width:280px">' + svg("search") +
        '<input class="odm-input odm-input--search" placeholder="Tracking ID, PS Code, project name, contractor&hellip;"></span>\n'
        + filters +
        '      <button class="odm-btn">' + svg("x") + 'Clear filters</button>\n'
        '    </div>\n'
        '  </section>\n'

        '  <section class="odm-section">\n'
        '    <div class="odm-card"><div class="odm-table-wrap">'
        '<table class="odm-table odm-table--compact"><thead><tr>' + head + '</tr></thead>'
        '<tbody>' + rows + '</tbody></table></div>\n'
        '      <div class="odm-table-foot"><span>Showing 5 of 50 projects</span>'
        '<span class="odm-faint">Ordered by Tracking ID</span></div>\n'
        '    </div>\n'
        '  </section>\n'
        '</main>\n'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>\n'
    )


# ── OPERATOR-DRIVEN MAINTENANCE ────────────────────────────────────────────

ODM_KPIS = [
    ("Total Inspections", "16,543", "inspection records", "#005BAC", "#005BAC", 100),
    ("Unique Assets", "1,284", "equipment units tracked", "#1F9D55", "#1F9D55", 82),
    ("Health Score", "87%", "overall equipment health", "#005BAC", "#005BAC", 87),
    ("Data Quality", "94%", "completion rate", "#D97706", "#D97706", 94),
    ("Predictive Risk", "Elevated", "maintenance risk level", "#DC2626", "#DC2626", 62),
]

ODM_DQ_COLS = ["Submission ID", "Date", "Inspector", "Asset", "Category", "Task", "Missing Fields"]

ODM_DQ_ROWS = [
    ("SUB-10241", "2026-08-14", "J. Ramos", "End suction pumps", "Rotating", "Check bearing temperature", ["Capture1Response", "EscalationTrigger"]),
    ("SUB-10238", "2026-08-14", "M. Aquino", "Blower Room, MBBR Area - Monorail", "Rotating", "Inspect rail condition", ["AssetName"]),
    ("SUB-10230", "2026-08-13", "K. Villanueva", "APFC PANEL", "Electrical", "Thermal scan", ["Capture1Label", "Capture1Response"]),
    ("SUB-10225", "2026-08-12", "J. Ramos", "FDAS", "Safety", "Alarm panel test", ["EscalationTrigger"]),
]


def _chart_bars():
    import math
    w, h = 560, 170
    n = 26
    bw = w / n
    bars = ""
    for i in range(n):
        v = 0.25 + 0.7 * abs(math.sin((i + 3) / 3.4)) * (1 if i < 18 else 0.45)
        bh = v * (h - 34)
        bars += ('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="3" fill="#DC2626" opacity=".6"/>'
                 % (i * bw + 4, h - 22 - bh, bw - 8, bh))
    grid = ""
    for f in (0, .25, .5, .75, 1):
        yy = 12 + (h - 34) * (1 - f)
        grid += ('<line x1="0" y1="%.1f" x2="%d" y2="%.1f" stroke="rgba(0,91,172,0.08)"/>'
                 '<text x="4" y="%.1f" font-size="9" fill="#8BA3B8">%d</text>' % (yy, w, yy, yy - 3, f * 40))
    return ('<svg viewBox="0 0 %d %d" class="odm-chart">%s'
            '<line x1="0" y1="%d" x2="%d" y2="%d" stroke="#CBD5E1"/>%s</svg>' % (w, h, grid, h - 22, w, h - 22, bars))


def _pareto():
    import math
    w, h = 560, 190
    n = 10
    bw = w / n
    bars = ""
    cum = 0
    pts = []
    for i in range(n):
        v = (1 - i / (n + 1.6))
        bh = v * (h - 46)
        bars += ('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="3" fill="#DC2626" opacity=".55"/>'
                 % (i * bw + 8, h - 26 - bh, bw - 16, bh))
        cum += v / 5.6
        pts.append("%.1f,%.1f" % (i * bw + bw / 2, 14 + (h - 46) * (1 - min(cum, 1))))
    thr = 14 + (h - 46) * 0.2
    return ('<svg viewBox="0 0 %d %d" class="odm-chart">'
            '<line x1="0" y1="%.1f" x2="%d" y2="%.1f" stroke="#F59E0B" stroke-width="2" stroke-dasharray="6 4"/>'
            '<text x="%d" y="%.1f" font-size="9" fill="#D97706" text-anchor="end">80%% threshold</text>'
            '%s<polyline points="%s" fill="none" stroke="#005BAC" stroke-width="2.4"/>'
            '<line x1="0" y1="%d" x2="%d" y2="%d" stroke="#CBD5E1"/></svg>'
            % (w, h, thr, w, thr, w - 6, thr - 5, bars, " ".join(pts), h - 26, w, h - 26))


def odm_body():
    kpis = ""
    for label, value, caption, textc, barc, pct in ODM_KPIS:
        kpis += ('<div class="odm-kpi">'
                 '<div class="odm-kpi-label">%s</div>'
                 '<div class="odm-kpi-value" style="color:%s">%s</div>'
                 '<div class="odm-progress odm-mt-2"><i style="width:%d%%;background:%s"></i></div>'
                 '<div class="odm-kpi-foot">%s</div></div>' % (label, textc, value, pct, barc, caption))

    ins = "".join(
        '<div class="odm-insight odm-insight--%s">'
        '<span class="odm-insight-sev">%s</span>'
        '<div class="odm-grow"><div class="odm-insight-title">%s</div>'
        '<div class="odm-insight-body">%s</div>'
        '<div class="odm-insight-foot">View drill-down</div></div></div>' % (sev, sev.upper(), title, body)
        for sev, title, body in [
            ("critical", "Repetitive negative findings on End suction pumps",
             "14 distinct negative findings across 6 inspections at Balara PS in the last 30 days."),
            ("high", "Data quality below target for Marikina North STP",
             "9 records missing Capture1Response for the current filter set."),
            ("medium", "Escalation triggers recorded without follow-up",
             "5 entries flagged <em>Escalation Trigger</em> remain open."),
            ("info", "Inspector coverage is balanced across facilities",
             "No single inspector accounts for more than 22% of inspections."),
        ])

    dq_head = "".join("<th>%s</th>" % c for c in ODM_DQ_COLS)
    dq_rows = ""
    for sid, date, insp, asset, cat, task, missing in ODM_DQ_ROWS:
        chips = "".join('<span class="odm-badge odm-badge--danger">%s</span>' % m for m in missing)
        dq_rows += ('<tr><td class="strong odm-mono">%s</td><td class="odm-num">%s</td><td>%s</td>'
                    '<td>%s</td><td class="muted">%s</td><td>%s</td>'
                    '<td><span class="odm-row odm-row--wrap" style="gap:4px">%s</span></td></tr>'
                    % (sid, date, insp, asset, cat, task, chips))

    return (
        module_header("ODM Dashboard", "Programs") +
        '<div class="odm-subbar"><div class="odm-subbar-in">\n'
        '  <span class="odm-badge odm-badge--neutral">16,543 records from database</span>\n'
        '  <div class="odm-toolbar-spacer"></div>\n'
        '  <button class="odm-btn">' + svg("refresh-cw") + 'Refresh</button>\n'
        '  <button class="odm-btn odm-btn--primary">' + svg("upload") + 'Import Excel</button>\n'
        '  <button class="odm-btn odm-btn--navy">' + svg("sparkles") + 'Ask AI</button>\n'
        '  <button class="odm-btn">Clear</button>\n'
        '</div></div>\n'

        '<main class="odm-main">\n'
        '  <div class="odm-alert odm-alert--danger odm-mb-3">' + svg("triangle-alert") +
        '<div><div class="odm-alert-title">Automated alert: Data quality score is low for current filters.</div>'
        '<div class="odm-alert-body">Missing required data: Capture1Response. Review the Data Quality tab before relying on these figures.</div></div></div>\n'

        '  <section class="odm-section"><div class="odm-card odm-card--pad">'
        '<div class="odm-filters-grid">'
        '<span class="odm-field odm-field--stack"><label class="odm-label">DATE FROM</label>'
        '<input class="odm-input" value="2026-01-01"></span>'
        '<span class="odm-field odm-field--stack"><label class="odm-label">DATE TO</label>'
        '<input class="odm-input" value="2026-08-31"></span>'
        '<span class="odm-field odm-field--stack"><label class="odm-label">PLANT / FACILITY</label>'
        '<select class="odm-select"><option>All Plants</option><option>Balara Filter 1</option>'
        '<option>Balara PS</option><option>Marikina North STP</option><option>Pag-Asa LS</option></select></span>'
        '<span class="odm-field odm-field--stack"><label class="odm-label">EQUIPMENT TYPE</label>'
        '<select class="odm-select"><option>All Types</option></select></span>'
        '<span class="odm-field odm-field--stack"><label class="odm-label">CATEGORY</label>'
        '<select class="odm-select"><option>All Categories</option></select></span>'
        '<span class="odm-field odm-field--stack"><label class="odm-label">INSPECTOR</label>'
        '<select class="odm-select"><option>All Inspectors</option></select></span>'
        '<span class="odm-field odm-field--stack"><label class="odm-label">&nbsp;</label>'
        '<button class="odm-btn">Reset</button></span>'
        '</div></div></section>\n'

        '  <section class="odm-section"><div class="odm-kpi-grid odm-kpi-grid--5">' + kpis + '</div></section>\n'

        '  <section class="odm-section">\n'
        '    <div class="odm-section-head"><h3 class="odm-section-title">AI Operational Insights</h3>'
        '<span class="odm-row"><span class="odm-badge odm-badge--danger">4 alerts</span>'
        '<span class="odm-badge odm-badge--info">4 insights</span></span></div>\n'
        '    <div class="odm-grid-2">' + ins + '</div>\n'
        '  </section>\n'

        '  <section class="odm-section"><div class="odm-grid-2">\n'
        '    <div class="odm-card"><div class="odm-card-head">'
        '      <span class="odm-card-title">Daily Distinct Negative Findings Trend</span>'
        '      <span class="odm-badge odm-badge--info">Operational Analytics</span></div>'
        '      <div class="odm-card-body">' + _chart_bars() +
        '      <div class="odm-chart-note"><span class="odm-badge odm-badge--danger">CUMULATIVE DISTINCT NEGATIVE FINDINGS</span></div>'
        '      <div class="odm-chart-legend"><span class="odm-legend-item">'
        '<i style="background:rgba(220,38,38,.6);border:1px solid #DC2626"></i>Distinct Affected Assets</span></div>'
        '</div></div>\n'
        '    <div class="odm-card"><div class="odm-card-head">'
        '      <span class="odm-card-title">Pareto Analysis of Repetitive Equipment Issues</span>'
        '      <span class="odm-badge odm-badge--info">Distinct Asset-Based Negative Findings</span></div>'
        '      <div class="odm-card-body">' + _pareto() +
        '      <div class="odm-chart-note"><span class="odm-badge odm-badge--warning">Equipment Types at 80%</span></div>'
        '      <div class="odm-chart-legend">'
        '<span class="odm-legend-item"><i style="background:rgba(220,38,38,.55);border:1px solid #DC2626"></i>Distinct Equipment</span>'
        '<span class="odm-legend-item"><i style="background:#005BAC;height:2px;border-radius:2px"></i>Cumulative %</span>'
        '<span class="odm-legend-item"><i style="background:#F59E0B;height:2px;border-radius:2px"></i>80% Threshold</span>'
        '</div></div></div>\n'
        '  </div></section>\n'

        '  <section class="odm-section">\n'
        '    <div class="odm-section-head">'
        '      <div class="odm-tabs">'
        '        <button class="odm-tab odm-tab--active">Data Quality</button>'
        '        <button class="odm-tab">Negative Findings</button>'
        '        <button class="odm-tab">Inspection Notes</button>'
        '        <button class="odm-tab">Inspector Performance</button>'
        '      </div>\n'
        '      <span class="odm-badge odm-badge--warning">14 records with issues</span>\n'
        '    </div>\n'
        '    <div class="odm-card"><div class="odm-card-head">'
        '      <span class="odm-card-title">Data Quality Issues &mdash; Missing Required Fields</span>'
        '      <span class="odm-filter-chip"><span class="odm-filter-chip-label">Filtered by:</span>'
        '<span class="odm-filter-chip-pill">End suction pumps '
        '<span class="odm-filter-chip-x" title="Clear filter">&times;</span></span></span></div>'
        '      <div class="odm-table-wrap"><table class="odm-table odm-table--compact">'
        '<thead><tr>' + dq_head + '</tr></thead><tbody>' + dq_rows + '</tbody></table></div>\n'
        '      <div class="odm-table-foot"><span>Showing 4 of 14 records with issues</span>'
        '<span class="odm-faint">Sorted by Date, newest first</span></div>\n'
        '    </div>\n'
        '  </section>\n'

        '  <section class="odm-section"><div class="odm-card odm-card--pad">'
        '    <div class="odm-section-head"><h3 class="odm-section-title">Ask AI about this Dashboard</h3></div>'
        '    <div class="odm-row odm-row--wrap" style="gap:6px">'
        '<button class="odm-btn odm-btn--sm">Which equipment types drive most negative findings?</button>'
        '<button class="odm-btn odm-btn--sm">Where is data quality weakest?</button>'
        '<button class="odm-btn odm-btn--sm">Which inspectors need coaching?</button></div>'
        '    <div class="odm-row odm-mt-3"><input class="odm-input odm-grow" placeholder="Ask anything about inspection data, trends, or equipment...">'
        '<button class="odm-btn odm-btn--primary">Ask</button>'
        '<button class="odm-btn">Clear</button></div>'
        '  </div></section>\n'
        '</main>\n'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>\n'
    )
