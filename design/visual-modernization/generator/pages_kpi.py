"""Monthly KPI Scorecard + O&M Manual Governance mockup pages (mockup only).

Every heading, control label, column header, status word and empty-state string
below is transcribed verbatim from the current application. Only the surface
treatment changes.
"""
from odm_icons import svg


# ── shared bits ────────────────────────────────────────────────────────────

def section(title, badge=None, right=None):
    right_html = right or (badge or "")
    return (
        '<div class="odm-section-head">'
        '<h3 class="odm-section-title">%s</h3>'
        '<div class="odm-row">%s</div>'
        '</div>' % (title, right_html)
    )


def legend_dot(color, label):
    return ('<span class="odm-legend-item"><i style="background:%s"></i>%s</span>' % (color, label))


def check_list(items):
    return "".join('<li>%s</li>' % i for i in items)


# ── MONTHLY KPI SCORECARD ──────────────────────────────────────────────────
# Structure: public/scorecard-kpi.html rendered inside the
# src/pages/ScorecardDashboard.tsx iframe shell. The shell contributes NO
# chrome, so this page owns its own header — reproduced here as-is.

KPI_TILES = [
    dict(name="PM Compliance", unit="%", bench="&ge;98%", value="97.2", status=("Near Target", "warning"), fill=52),
    dict(name="Budget Spend", unit="%", bench="95.00% - 105.00%", value="101.4", status=("On Target", "success"), fill=58),
    dict(name="PM:CM Ratio (WO)", unit="%", bench="&ge;86% (6:1)", value="88.0", sub="(9.0:1)", status=("Passed", "success"), fill=64),
    dict(name="PM:CM Ratio (Cost)", unit="%", bench="&ge;80% (4:1)", value="76.5", sub="(3.2:1)", status=("Below Target", "danger"), fill=44),
    dict(name="MTTR", unit="days", bench="Data exists", value="4.2", status=("Available", "success"), fill=38),
    dict(name="Facility Uptime", unit="%", bench="=100%", value="99.6", status=("Near Target", "warning"), fill=60),
]

TREND_CARDS = [
    ("PM Compliance (%)", "#0066A6"), ("Budget Spend (%)", "#00A8D2"),
    ("PM:CM WO (%)", "#7C3AED"), ("PM:CM Cost (%)", "#D97706"),
    ("MTTR (Days)", "#DC2626"), ("Facility Uptime (%)", "#0F766E"),
]

MATRIX_COLS = ["Business Unit", "PM Compliance (%)", "Budget Spend (%)", "PM:CM Ratio (Work Order)",
               "PM:CM Ratio (Cost)", "MTTR (Days)", "Facility Uptime (%)", "Notes"]

MATRIX_ROWS = [
    ("BENCHMARK", ["&ge;98%", "95.00% - 105.00%", "&ge;86% (6:1)", "&ge;80% (4:1)", "Data exists", "=100%", "—"], "bench"),
    ("All Business Units", ["97.2", "101.4", "88.0", "76.5", "4.2", "99.6", "2 facilities with commentary"], ""),
    ("AMD-EZ", ["97.2", "101.4", "88.0", "76.5", "4.2", "99.6", "—"], ""),
    ("Laguna Water", ["96.4", "103.1", "84.0", "74.0", "5.1", "99.1", "—"], ""),
    ("Clark Water", ["98.1", "99.2", "91.0", "82.4", "3.8", "99.9", "—"], ""),
    ("Tagum Water", ["95.0", "104.6", "80.0", "71.2", "6.4", "98.4", "—"], ""),
    ("Estate Water", ["97.8", "100.2", "89.0", "80.1", "4.0", "99.7", "—"], ""),
]

RECORD_COLS = ["Month", "PM Compliance (%)", "Budget Spend (%)", "PM vs CM WO (%)", "PM vs CM Cost (%)",
               "MTTR (Days)", "Facility Uptime (%)", "Notes", "Situation"]

RECORD_ROWS = [
    ("January", "96.1", "98.4", "85.0", "72.0", "5.6", "99.2"),
    ("February", "97.0", "100.1", "86.0", "74.5", "5.2", "99.4"),
    ("March", "95.4", "102.6", "82.0", "70.0", "6.1", "98.8"),
    ("April", "97.6", "99.8", "88.0", "77.0", "4.6", "99.5"),
    ("May", "97.2", "101.4", "88.0", "76.5", "4.2", "99.6"),
]


def sparkline(color, height=54, bars=12):
    """A tiny bar+line trend placeholder — the real module uses Chart.js."""
    import math
    w = 220
    bw = w / bars
    parts = []
    for i in range(bars):
        v = 0.45 + 0.35 * abs(math.sin(i / 2.6)) + (0.08 if i % 3 == 0 else 0)
        h = int(v * (height - 12))
        parts.append('<rect x="%.1f" y="%d" width="%.1f" height="%d" rx="1.5" fill="%s" opacity=".5"/>'
                     % (i * bw + 2, height - h - 6, bw - 4, h, color))
    pts = " ".join("%.1f,%d" % (i * bw + bw / 2, height - 8 - int((0.5 + 0.3 * math.sin(i / 2.2)) * (height - 14)))
                   for i in range(bars))
    return ('<svg viewBox="0 0 %d %d" preserveAspectRatio="none" class="odm-spark">'
            '<line x1="0" y1="%d" x2="%d" y2="%d" stroke="#0B1D44" stroke-width="1" stroke-dasharray="4 3" opacity=".45"/>'
            '%s<polyline points="%s" fill="none" stroke="%s" stroke-width="2.2" stroke-linejoin="round"/></svg>'
            % (w, height, height - 26, w, height - 26, "".join(parts), pts, color))


def kpi_body():
    tiles = ""
    for t in KPI_TILES:
        label, kind = t["status"]
        sub = ' <span class="odm-kpi-unit">%s</span>' % t["sub"] if t.get("sub") else ""
        tiles += (
            '<div class="odm-kpi odm-kpi--%s">'
            '<div class="odm-kpi-label">%s</div>'
            '<div class="odm-kpi-value">%s<span class="odm-kpi-unit">%s</span>%s</div>'
            '<div class="odm-progress odm-progress--%s odm-mt-2"><i style="width:%d%%"></i></div>'
            '<div class="odm-kpi-foot"><span class="odm-badge odm-badge--%s">%s</span>'
            '<span>Benchmark %s</span></div>'
            '</div>' % (kind, t["name"], t["value"], t["unit"], sub, kind, t["fill"], kind, label, t["bench"])
        )

    trends = "".join(
        '<div class="odm-card odm-trend"><div class="odm-card-head">'
        '<span class="odm-card-title">%s</span>'
        '<span class="odm-row" style="font-size:11px;color:var(--odm-text-faint)">'
        '<i class="odm-series-dot" style="background:%s"></i>Monthly Actual'
        '<i class="odm-series-dot" style="background:%s;border-radius:2px;height:2px;width:14px"></i>YTD / Trend'
        '</span></div><div class="odm-card-body">%s</div></div>'
        % (name, color, color, sparkline(color))
        for name, color in TREND_CARDS
    )

    matrix_head = "".join("<th%s>%s</th>" % (' class="num"' if i else "", h)
                          for i, h in enumerate(MATRIX_COLS))
    matrix_rows = ""
    for name, vals, kind in MATRIX_ROWS:
        cls = ' class="is-benchmark"' if kind == "bench" else ""
        cells = "".join('<td class="num">%s</td>' % v for v in vals)
        matrix_rows += '<tr%s><td class="strong">%s</td>%s</tr>' % (cls, name, cells)

    rec_head = "".join("<th%s>%s</th>" % (' class="num"' if 0 < i < 7 else "", h)
                       for i, h in enumerate(RECORD_COLS))
    rec_rows = ""
    for r in RECORD_ROWS:
        cells = "".join('<td class="num">%s</td>' % v for v in r[1:])
        rec_rows += ('<tr><td class="strong">%s</td>%s<td class="muted">—</td><td class="muted">—</td></tr>'
                     % (r[0], cells))

    return (
        # The scorecard owns its own header — the React shell adds none.
        '<header class="odm-hdr odm-hdr--module">\n'
        '  <div class="odm-hdr-in">\n'
        '    <div class="odm-brand">\n'
        '      <span class="odm-brand-mark">ODM</span>\n'
        '      <span><h1>Monthly Scorecard: Maintenance KPIs</h1><span>Programs</span></span>\n'
        '    </div>\n'
        '    <div class="odm-hdr-actions"></div>\n'
        '  </div>\n'
        '</header>\n'

        '<main class="odm-main">\n'
        # Toolbar — same control set and order as the current page
        '  <div class="odm-toolbar">\n'
        '    <span class="odm-field odm-field--inline"><label class="odm-label">BUSINESS UNIT</label>'
        '<select class="odm-select"><option>AMD-EZ</option><option>Laguna Water</option>'
        '<option>Clark Water</option><option>Tagum Water</option><option>Estate Water</option></select></span>\n'
        '    <span class="odm-field odm-field--inline"><label class="odm-label">YEAR</label>'
        '<select class="odm-select"><option>2026</option><option>2025</option></select></span>\n'
        '    <span class="odm-field odm-field--inline"><label class="odm-label">MONTH</label>'
        '<select class="odm-select"><option>January</option><option>February</option><option>March</option>'
        '<option>April</option><option selected>May</option><option>June</option><option>July</option>'
        '<option>August</option><option>September</option><option>October</option><option>November</option>'
        '<option>December</option></select></span>\n'
        '    <button class="odm-btn odm-btn--primary">' + svg("refresh-cw") + 'Load</button>\n'
        '    <span class="odm-toolbar-sep"></span>\n'
        '    <button class="odm-btn">' + svg("square-pen") + 'Input Data Manually</button>\n'
        '    <button class="odm-btn">' + svg("upload") + 'Import Excel</button>\n'
        '    <button class="odm-btn">' + svg("download") + 'Export Data' + svg("chevron-down") + '</button>\n'
        '    <button class="odm-btn">' + svg("sliders-horizontal") + 'Thresholds</button>\n'
        '    <button class="odm-btn odm-btn--danger">' + svg("trash-2") + 'Clear</button>\n'
        '    <div class="odm-toolbar-spacer"></div>\n'
        '    <div class="odm-tabs">'
        '<button class="odm-tab odm-tab--active">Summary Matrix</button>'
        '<button class="odm-tab">Definitions / FAQ</button>'
        '<button class="odm-tab">Scope / Inclusions</button></div>\n'
        '  </div>\n'

        # Legend — four states, dots only, no decoration
        '  <div class="odm-legend odm-mt-3">' +
        legend_dot("#0A9B6E", "KPI Passed / Meets or Exceeds Benchmark") +
        legend_dot("#D97706", "Warning / Marginal Performance") +
        legend_dot("#DC2626", "KPI Below Benchmark") +
        legend_dot("#E2E8F0", "No Data") +
        '  </div>\n'

        '  <section class="odm-section odm-mt-4">' + section("2026 - EZ &amp; Non-EZ Monthly KPI/Scorecard") + '</section>\n'

        '  <section class="odm-section">' +
        section("Portfolio Average KPI Cards") +
        '    <div class="odm-kpi-grid">' + tiles + '</div>\n'
        '  </section>\n'

        '  <section class="odm-section">' + section("KPI Trends") +
        '    <div class="odm-grid-3">' + trends + '</div>\n'
        '  </section>\n'

        '  <section class="odm-section">' +
        section("Summary Matrix") +
        '    <div class="odm-card"><div class="odm-table-wrap"><table class="odm-table">'
        '<thead><tr>' + matrix_head + '</tr></thead><tbody>' + matrix_rows + '</tbody></table></div></div>\n'
        '  </section>\n'

        '  <section class="odm-section">' +
        section("2026 Imported Monthly KPI Records",
                right='<span class="odm-faint" style="font-size:11.5px">Business Unit: AMD-EZ</span>'
                      '<span class="odm-badge odm-badge--neutral">5 months imported</span>') +
        '    <div class="odm-card"><div class="odm-table-wrap"><table class="odm-table">'
        '<thead><tr>' + rec_head + '</tr></thead><tbody>' + rec_rows + '</tbody></table></div>'
        '<div class="odm-table-foot"><span>Showing 5 of 12 months imported</span>'
        '<span class="odm-faint">Month order: January &rarr; December</span></div></div>\n'
        '  </section>\n'
        '</main>\n'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>\n'
    )
