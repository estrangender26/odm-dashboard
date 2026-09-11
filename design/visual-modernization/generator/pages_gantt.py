"""Gantt / Primavera Lite, Projects without PPP and Operator-Driven Maintenance
mockup pages (mockup only). All headings, column headers and control labels are
transcribed verbatim from the current application."""
from odm_icons import svg


def module_header(title, subtitle, back=True, extra=""):
    back_html = ('<a class="odm-hdr-btn" href="home.html">' + svg("panel-left") + 'Dashboard Suite</a>') if back else ""
    return (
        '<header class="odm-hdr">\n  <div class="odm-hdr-in">\n'
        '    <a class="odm-brand" href="home.html">\n'
        '      <span class="odm-brand-mark">ODM</span>\n'
        '      <span><h1>%s</h1><span>%s</span></span>\n'
        '    </a>\n'
        '    <div class="odm-hdr-actions">%s%s</div>\n'
        '  </div>\n</header>\n' % (title, subtitle, extra, back_html)
    )


# ── ODM PRIMAVERA LITE ─────────────────────────────────────────────────────

ACTIVITY_COLS = ["", "Activity ID", "Activity name", "Type", "WBS", "Planned start", "Planned finish",
                 "Actual start", "Actual finish", "Original duration", "Calendar", "% complete",
                 "Early start", "Early finish", "Late start", "Late finish", "Total float", "Archive"]

WBS = "PUMP STN 2 / CIVIL"

ACTIVITIES = [
    ("A1010", "Site mobilisation", "Task", "0", "2026-04-01", "2026-04-12", "2026-04-01", "2026-04-10", "12", "5-Day", "100", "0"),
    ("A1020", "Excavation & dewatering", "Task", "0", "2026-04-13", "2026-05-08", "2026-04-13", "—", "26", "5-Day", "100", "0"),
    ("A1030", "Lean concrete & blinding", "Task", "0", "2026-05-09", "2026-05-20", "—", "—", "12", "5-Day", "65", "0"),
    ("A1040", "Rebar fabrication & fixing", "Task", "0", "2026-05-21", "2026-06-14", "—", "—", "25", "5-Day", "20", "3"),
    ("M1050", "Civil works complete", "Milestone", "0", "2026-06-15", "2026-06-15", "—", "—", "0", "5-Day", "0", "0"),
    ("A1060", "Pump skid delivery", "Task", "0", "2026-06-16", "2026-07-04", "—", "—", "19", "5-Day", "0", "0"),
    ("A1070", "Mechanical installation", "Task", "0", "2026-07-05", "2026-07-30", "—", "—", "26", "5-Day", "0", "5"),
]

GANTT_ROWS = [
    ("A1010", "Site mobilisation", 0, 2, "task", 100, False, False),
    ("A1020", "Excavation &amp; dewatering", 2, 6, "actual", 100, True, False),
    ("A1030", "Lean concrete &amp; blinding", 6, 8, "task", 65, True, False),
    ("A1040", "Rebar fabrication &amp; fixing", 8, 12, "task", 20, True, True),
    ("M1050", "Civil works complete", 12, 12, "milestone", 0, False, True),
    ("A1060", "Pump skid delivery", 12, 15, "task", 0, False, False),
    ("A1070", "Mechanical installation", 15, 19, "task", 0, False, True),
]

DEPENDENCY_COLS = ["Predecessor", "Successor", "Type", "Lag (days)", "Archive"]
DEPENDENCIES = [
    ("A1010 · Site mobilisation", "A1020 · Excavation &amp; dewatering", "FS", "0"),
    ("A1020 · Excavation &amp; dewatering", "A1030 · Lean concrete &amp; blinding", "FS", "0"),
    ("A1030 · Lean concrete &amp; blinding", "A1040 · Rebar fabrication &amp; fixing", "FS", "2"),
    ("A1040 · Rebar fabrication &amp; fixing", "M1050 · Civil works complete", "FS", "0"),
]

BASELINE_COLS = ["Activity", "WBS", "Baseline Start", "Current Start", "Start Variance",
                 "Baseline Finish", "Current Finish", "Finish Variance", "Status"]
BASELINES = [
    ("A1010", WBS, "2026-04-01", "2026-04-01", "0d", "2026-04-12", "2026-04-12", "0d", "Active"),
    ("A1020", WBS, "2026-04-13", "2026-04-13", "0d", "2026-05-08", "2026-05-10", "+2d", "Active"),
    ("A1030", WBS, "2026-05-11", "2026-05-09", "&minus;2d", "2026-05-22", "2026-05-20", "&minus;2d", "Active"),
    ("A1090", WBS, "2026-08-01", "—", "—", "2026-08-20", "—", "—", "Archived"),
]


def bar_html(start, end, kind, pct, critical):
    left = start / 24 * 100
    width = max((end - start) / 24 * 100, 2.4)
    if kind == "milestone":
        return ('<span class="odm-milestone" style="left:calc(%.3f%% - 7px)"></span>' % left)
    cls = {"task": "odm-bar--task", "critical": "odm-bar--critical", "actual": "odm-bar--actual",
           "summary": "odm-bar--summary", "neutral": "odm-bar--neutral"}[kind]
    if critical and kind != "actual":
        cls = "odm-bar--critical"
    prog = ('<span class="odm-bar--progress" style="width:%d%%"></span>' % pct) if pct else ""
    label = ('<span class="odm-bar-label">%d%%</span>' % pct) if pct else ""
    return ('<span class="odm-bar %s" style="left:%.3f%%;width:%.3f%%">%s%s</span>'
            % (cls, left, width, prog, label))


def gantt_body():
    # Left pane + timeline rows, index-aligned
    left_rows = ""
    tl_rows = ""
    for i, (aid, name, s, e, kind, pct, critical, _flag) in enumerate(GANTT_ROWS):
        selected = " is-selected" if i == 2 else ""
        left_rows += (
            '<div class="odm-gantt-lrow%s">'
            '<span class="odm-gantt-wbs">%s</span>'
            '<span class="odm-gantt-act">%s</span>'
            '<span class="odm-gantt-id">%s</span>'
            '</div>' % (selected, WBS, name, aid)
        )
        crit_cls = " is-critical" if critical else ""
        tl_rows += (
            '<div class="odm-gantt-row%s">%s'
            '<span class="odm-gantt-marker odm-gantt-marker--data-date" style="left:41.6%%"></span>'
            '<span class="odm-gantt-marker odm-gantt-marker--today" style="left:33.3%%"></span>'
            '</div>' % (crit_cls, bar_html(s, e, kind, pct, critical))
        )

    act_head = "".join('<th>%s</th>' % c for c in ACTIVITY_COLS)
    act_rows = ""
    for (aid, name, typ, _o, ps, pf, as_, af, dur, cal, pct, floatd) in ACTIVITIES:
        act_rows += (
            '<tr><td class="muted">' + svg("list") + '</td>'
            '<td class="strong">%s</td><td>%s</td><td>%s</td><td class="muted">%s</td>'
            '<td class="odm-num">%s</td><td class="odm-num">%s</td><td class="odm-num">%s</td><td class="odm-num">%s</td>'
            '<td class="odm-num">%s</td><td class="muted">%s</td><td class="odm-num">%s%%</td>'
            '<td class="odm-num muted">%s</td><td class="odm-num muted">%s</td>'
            '<td class="odm-num muted">%s</td><td class="odm-num muted">%s</td>'
            '<td class="odm-num">%s</td><td class="muted">%s</td></tr>'
            % (aid, name, typ, WBS, ps, pf, as_, af, dur, cal, pct, ps, pf, ps, pf, floatd, svg("trash-2"))
        )

    dep_head = "".join('<th>%s</th>' % c for c in DEPENDENCY_COLS)
    dep_rows = "".join('<tr><td>%s</td><td>%s</td><td><span class="odm-badge odm-badge--neutral">%s</span></td>'
                       '<td class="odm-num">%s</td><td class="muted">%s</td></tr>' % (a, b, t, l, svg("trash-2"))
                       for a, b, t, l in DEPENDENCIES)

    bl_head = "".join('<th>%s</th>' % c for c in BASELINE_COLS)
    bl_rows = ""
    for (aid, wbs, bs, cs, sv, bf, cf, fv, status) in BASELINES:
        tone = {"Active": "success", "Archived": "warning", "Missing": "danger"}[status]
        bl_rows += ('<tr><td class="strong">%s</td><td class="muted">%s</td><td class="odm-num">%s</td>'
                    '<td class="odm-num">%s</td><td class="odm-num">%s</td><td class="odm-num">%s</td>'
                    '<td class="odm-num">%s</td><td class="odm-num">%s</td>'
                    '<td><span class="odm-badge odm-badge--%s">%s</span></td></tr>'
                    % (aid, wbs, bs, cs, sv, bf, cf, fv, tone, status))

    legend = "".join([
        '<span class="odm-gantt-legend-item"><i style="background:#2563EB"></i>Planned</span>',
        '<span class="odm-gantt-legend-item"><i style="background:#2563EB;opacity:.45;border:1px dashed #64748B"></i>CPM</span>',
        '<span class="odm-gantt-legend-item"><i style="background:#DC2626;border:1px dashed #7F1D1D"></i>Critical CPM</span>',
        '<span class="odm-gantt-legend-item"><i style="background:#DC2626"></i>Critical chip (current path)</span>',
        '<span class="odm-gantt-legend-item"><i style="background:#059669"></i>Actual</span>',
        '<span class="odm-gantt-legend-item"><i style="background:#3B82F6;border:1px solid #1D4ED8;transform:rotate(45deg)"></i>Planned milestone</span>',
        '<span class="odm-gantt-legend-item"><i style="background:transparent;border:1px solid #64748B;transform:rotate(45deg)"></i>CPM milestone</span>',
        '<span class="odm-gantt-legend-item"><i style="background:#059669;border-radius:999px"></i>Open actual</span>',
        '<span class="odm-gantt-legend-item"><i style="background:rgba(255,255,255,.55);border:1px solid #CBD5E1"></i>Shaded = % complete</span>',
        '<span class="odm-gantt-legend-item"><i style="background:#FCD34D"></i>Unresolved progress</span>',
    ])

    return (
        module_header("ODM Primavera Lite Online", "Link-based project scheduling") +
        '<div class="odm-subbar"><div class="odm-subbar-in">\n'
        '  <span class="odm-field odm-field--inline"><label class="odm-label">DATA DATE</label>'
        '<input class="odm-input" value="2026-05-18" style="width:140px"></span>\n'
        '  <button class="odm-btn">Set Data Date</button>\n'
        '  <button class="odm-btn odm-btn--primary">' + svg("play") + 'Run Schedule</button>\n'
        '  <button class="odm-btn">' + svg("layers") + 'Archive Project</button>\n'
        '  <div class="odm-toolbar-spacer"></div>\n'
        '  <span class="odm-badge odm-badge--warning">' + svg("triangle-alert") + 'Schedule Out of Date</span>\n'
        '</div></div>\n'

        '<main class="odm-main">\n'
        '  <div class="odm-card">\n'
        '    <div class="odm-card-head">'
        '      <span class="odm-card-title">Project Overview</span>'
        '      <span class="odm-faint" style="font-size:11.5px">Role: Admin | Revision: 7 | Last Scheduled: 2026-05-18 09:14</span>'
        '    </div>\n'
        '    <div class="odm-card-body">\n'

        '      <div class="odm-section-head"><h3 class="odm-section-title">WBS Structure</h3>'
        '<span class="odm-row"><button class="odm-btn odm-btn--sm">' + svg("plus") + 'New WBS name</button>'
        '<button class="odm-btn odm-btn--sm">Collapse</button></span></div>\n'
        '      <div class="odm-wbs">'
        '<div class="odm-wbs-row odm-wbs-row--root">' + svg("chevron-down") + 'PUMP STN 2</div>'
        '<div class="odm-wbs-row odm-wbs-row--l1">' + svg("chevron-down") + 'CIVIL</div>'
        '<div class="odm-wbs-row odm-wbs-row--l2">' + svg("circle-dot") + 'Excavation &amp; structures</div>'
        '<div class="odm-wbs-row odm-wbs-row--l1">' + svg("chevron-right") + 'MECHANICAL</div>'
        '<div class="odm-wbs-row odm-wbs-row--l1">' + svg("chevron-right") + 'ELECTRICAL</div>'
        '</div>\n'

        '      <div class="odm-section-head odm-mt-4"><h3 class="odm-section-title">Timeline</h3>'
        '<span class="odm-row odm-tabs" style="padding:2px">'
        '<button class="odm-tab">day</button><button class="odm-tab">week</button>'
        '<button class="odm-tab odm-tab--active">month</button><button class="odm-tab">quarter</button>'
        '<button class="odm-tab">Fit Project</button></span></div>\n'
        '      <div class="odm-card odm-card--flush"><div class="odm-gantt-grid">'
        '<div class="odm-gantt-left"><div class="odm-gantt-lhead">WBS / Activity</div>' + left_rows + '</div>'
        '<div class="odm-gantt-right"><div class="odm-gantt-timeline">'
        '<div class="odm-gantt-scale">'
        + "".join('<span>%s</span>' % m for m in
                  ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]) +
        '</div>' + tl_rows + '</div></div></div>\n'
        '        <div class="odm-gantt-legend">' + legend + '</div>\n'
        '        <div class="odm-gantt-caption">Planned (solid) &middot; Scheduled/CPM (dashed) &middot; Actual &mdash; read-only</div>\n'
        '      </div>\n'

        '      <div class="odm-section-head odm-mt-4"><h3 class="odm-section-title">Activities</h3>'
        '<span class="odm-row"><span class="odm-badge odm-badge--neutral">7 activities</span>'
        '<button class="odm-btn odm-btn--sm">Show archived</button>'
        '<button class="odm-btn odm-btn--sm odm-btn--primary">' + svg("plus") + 'Add Activity</button></span></div>\n'
        '      <div class="odm-card odm-card--flush"><div class="odm-table-wrap">'
        '<table class="odm-table odm-table--compact"><thead><tr>' + act_head + '</tr></thead>'
        '<tbody>' + act_rows + '</tbody></table></div></div>\n'

        '      <div class="odm-section-head odm-mt-4"><h3 class="odm-section-title">Dependencies</h3>'
        '<span class="odm-badge odm-badge--neutral">4 relationships</span></div>\n'
        '      <div class="odm-card odm-card--flush"><div class="odm-table-wrap">'
        '<table class="odm-table odm-table--compact"><thead><tr>' + dep_head + '</tr></thead>'
        '<tbody>' + dep_rows + '</tbody></table></div></div>\n'

        '      <div class="odm-section-head odm-mt-4"><h3 class="odm-section-title">Baselines</h3>'
        '<span class="odm-row"><span class="odm-badge odm-badge--neutral">Rev-B (52 activities)</span>'
        '<button class="odm-btn odm-btn--sm">Capture Baseline</button></span></div>\n'
        '      <div class="odm-card odm-card--flush"><div class="odm-table-wrap">'
        '<table class="odm-table odm-table--compact"><thead><tr>' + bl_head + '</tr></thead>'
        '<tbody>' + bl_rows + '</tbody></table></div></div>\n'

        '    </div>\n  </div>\n'
        '</main>\n'
        '<footer class="odm-footer"><div class="odm-footer-in">Program Oversight Center &copy; 2026</div></footer>\n'
    )
