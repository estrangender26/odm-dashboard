"""SMP + O&M Manuals Library mockup pages (mockup only).

These two modules currently ship with zero lucide-react and zero shadcn/ui
imports — they are bespoke. That is exactly why they are the two screens where
the proposed system does the most work.
"""
from odm_icons import svg
from pages_gantt import module_header


# ── STANDARD MAINTENANCE PROCEDURES ────────────────────────────────────────

SMP_ROWS = [
    dict(code="MW-ENGG-SP-1.0", rev="Rev. 0", smp="SMP-001", title="Centrifugal Pump System",
         family="Centrifugal Pump System", equip="end-suction pumps", facility="Treatment",
         crit="ABC A", eff="Mar 16, 2026", updated="Mar 16, 2026", status="Current", selected=True),
    dict(code="MW-ENGG-SP-2.0", rev="Rev. 1", smp="SMP-002", title="Blower System",
         family="Blower System", equip="screw blowers", facility="Treatment",
         crit="ABC B", eff="Feb 02, 2026", updated="Feb 02, 2026", status="Under Review"),
    dict(code="MW-ENGG-SP-3.0", rev="Rev. 2", smp="SMP-003", title="Agitator General Inspection",
         family="Agitators General", equip="agitators", facility="Treatment",
         crit="ABC A", eff="Apr 01, 2026", updated="Apr 01, 2026", status="Current"),
    dict(code="MW-ENGG-SP-4.0", rev="Rev. 0", smp="SMP-004", title="DG Set Weekly Run Procedure",
         family="DG SET", equip="generating sets", facility="Standby Power",
         crit="ABC A", eff="Nov 30, 2025", updated="Nov 30, 2025", status="Expired"),
    dict(code="MW-ENGG-SP-5.0", rev="Rev. 3", smp="SMP-005", title="FDAS Alarm Response",
         family="FDAS", equip="fire detection", facility="Safety",
         crit="ABC A", eff="Aug 02, 2026", updated="Aug 02, 2026", status="Superseded"),
]

SMP_STATUS = {"Current": "success", "Superseded": "neutral", "Under Review": "warning",
              "Expired": "danger", "Draft": "neutral"}

REVISION_COLS = ["Revision", "Status", "Effectivity", "Uploaded By", "Uploaded At", "File"]
REVISIONS = [
    ("Rev. 2", "Current", "2026-04-01", "G. Balucan", "2026-04-01 09:12", True),
    ("Rev. 1", "Superseded", "2026-01-15", "G. Balucan", "2026-01-15 14:02", False),
    ("Rev. 0", "Superseded", "2025-09-30", "R. Delos Santos", "2025-09-30 11:40", False),
]


def smp_row(r):
    cls = " is-selected" if r.get("selected") else ""
    return (
        '<button class="odm-listrow%s" type="button">'
        '<span class="odm-listrow-top">'
        '<span class="odm-listrow-code">%s &middot; %s &middot; %s</span>'
        '<span class="odm-badge odm-badge--%s">%s</span></span>'
        '<span class="odm-listrow-title">%s</span>'
        '<span class="odm-listrow-meta">%s &middot; %s &middot; %s &middot; %s &middot; Eff. %s</span>'
        '<span class="odm-listrow-foot">Updated %s</span>'
        '</button>' % (cls, r["code"], r["rev"], r["smp"], SMP_STATUS[r["status"]], r["status"],
                       r["title"], r["family"], r["equip"], r["facility"], r["crit"], r["eff"], r["updated"])
    )


def detail_field(label, value, mono=False):
    return ('<div class="odm-dfield"><span class="odm-dlabel">%s</span>'
            '<span class="odm-dvalue%s">%s</span></div>'
            % (label, " odm-mono" if mono else "", value))


def smp_body():
    rows = "".join(smp_row(r) for r in SMP_ROWS)

    rev_head = "".join("<th>%s</th>" % c for c in REVISION_COLS)
    rev_rows = ""
    for rev, status, eff, by, at, is_file in REVISIONS:
        file_cell = ('<span class="odm-row" style="gap:8px">'
                     '<a class="odm-link" href="#">PDF</a>'
                     '<a class="odm-link" href="#">View data</a></span>') if is_file else '&mdash;'
        rev_rows += ('<tr><td class="strong">%s</td>'
                     '<td><span class="odm-badge odm-badge--%s">%s</span></td>'
                     '<td class="odm-num">%s</td><td class="muted">%s</td><td class="odm-num muted">%s</td>'
                     '<td>%s</td></tr>'
                     % (rev, "success" if status == "Current" else "neutral", status, eff, by, at, file_cell))

    return (
        module_header("Standard Maintenance Procedures", "Controlled Engineering Document Library",
                      extra='<span class="odm-stat-tile"><b>17</b><em>Docs</em></span>'
                            '<button class="odm-hdr-btn">' + svg("download") + 'Export</button>'
                            '<button class="odm-hdr-btn">' + svg("upload") + 'Upload SMP PDF</button>') +
        '<main class="odm-main">\n'
        '  <div class="odm-split odm-split--wide">\n'

        # ── Left: library
        '    <div class="odm-card odm-split-pane">\n'
        '      <div class="odm-pane-toolbar">\n'
        '        <span class="odm-search odm-grow">' + svg("search") +
        '<input class="odm-input odm-input--search" value="pump" '
        'placeholder="Search reference no., title, SMP ID, family, asset, equipment, facility..."></span>\n'
        '        <button class="odm-btn odm-btn--icon odm-btn--sm" title="Clear search">' + svg("x") + '</button>\n'
        '      </div>\n'
        '      <div class="odm-pane-filters">\n'
        + "".join('<select class="odm-select odm-select--xs"><option>%s</option></select>' % o
                  for o in ["All Families", "All Equipment", "All Facility Types", "All Criticality",
                            "All Revisions", "All Status"]) +
        '      </div>\n'
        '      <div class="odm-pane-actions">\n'
        '        <button class="odm-btn odm-btn--sm odm-btn--primary">' + svg("upload") + 'Upload SMP PDF</button>\n'
        '        <button class="odm-btn odm-btn--sm">Clear Search &amp; Filters</button>\n'
        '      </div>\n'
        '      <div class="odm-pane-counts"><span>5 shown</span><span class="odm-faint">4 current/active</span>'
        '<span class="odm-faint">16 Sep 2026</span></div>\n'
        '      <div class="odm-list">' + rows + '</div>\n'
        '    </div>\n'

        # ── Right: detail + procedure data (stacked, as today's two panes)
        '    <div class="odm-col" style="gap:14px">\n'
        '      <div class="odm-card">\n'
        '        <div class="odm-card-head">\n'
        '          <div><span class="odm-listrow-code">MW-ENGG-SP-1.0 &middot; Rev. 2 &middot; SMP-001</span>'
        '          <h2 class="odm-doc-title">Centrifugal Pump System</h2></div>\n'
        '          <span class="odm-row"><span class="odm-badge odm-badge--neutral">Centrifugal Pump System</span>'
        '          <button class="odm-btn odm-btn--sm">' + svg("pencil") + 'Edit Metadata</button>'
        '          <button class="odm-btn odm-btn--sm">' + svg("upload") + 'Upload New Revision</button>'
        '          <button class="odm-btn odm-btn--sm odm-btn--danger">' + svg("trash-2") + 'Delete</button>'
        '          </span>\n'
        '        </div>\n'
        '        <div class="odm-card-body">\n'

        '          <h3 class="odm-dsection">Document Control</h3>\n'
        '          <div class="odm-dgrid">'
        + detail_field("Reference No.", "MW-ENGG-SP-1.0", True)
        + detail_field("SMP ID", "SMP-001", True)
        + detail_field("Title", "Centrifugal Pump System")
        + detail_field("Revision", "Rev. 2")
        + detail_field("Effectivity Date", "2026-04-01")
        + detail_field("Document Owner", "O&amp;M Engineering")
        + detail_field("Prepared By", "R. Delos Santos")
        + detail_field("Reviewed By", "M. Aquino")
        + detail_field("Approved By", "G. Balucan")
        + detail_field("Last Updated", "2026-04-01 09:12")
        + '</div>\n'

        '          <h3 class="odm-dsection">Applicability</h3>\n'
        '          <div class="odm-dgrid">'
        + detail_field("SMP Family (as documented)", "Centrifugal Pump System")
        + detail_field("Family Classification", "Rotating Equipment")
        + detail_field("Asset Name", "End suction pumps")
        + detail_field("Asset Type", "Pump")
        + detail_field("Equipment Type", "end-suction pumps")
        + detail_field("Facility Type", "Treatment")
        + detail_field("Criticality", "ABC &mdash; A")
        + detail_field("System", "Pumping")
        + '</div>\n'

        '          <h3 class="odm-dsection">Controlled Document</h3>\n'
        '          <div class="odm-card odm-card--sunk"><div class="odm-card-body odm-row odm-row--between">'
        '<div class="odm-col"><span class="odm-strong">MW-ENGG-SP-1.0_Rev2.pdf</span>'
        '<span class="odm-faint" style="font-size:11.5px">application/pdf &middot; 1.8 MB &middot; Uploaded 2026-04-01</span></div>'
        '<span class="odm-row"><button class="odm-btn odm-btn--sm">' + svg("file-text") + 'Open PDF</button>'
        '<button class="odm-btn odm-btn--sm">' + svg("download") + 'Download</button></span>'
        '</div></div>\n'

        '          <h3 class="odm-dsection">Procedure Data</h3>\n'
        '          <p class="odm-caption">Showing structured content as of Rev. 2 &middot; '
        '<a class="odm-link" href="#">Show current revision data</a></p>\n'
        '          <div class="odm-proc">'
        '<div class="odm-proc-block"><span class="odm-proc-h">1. Objective</span>'
        '<p>Maintain pump availability.</p></div>'
        '<div class="odm-proc-block"><span class="odm-proc-h">Operator Driven Tasks</span>'
        '<div class="odm-taskcard"><div class="odm-taskcard-head">Check bearing temperature'
        '<span class="odm-badge odm-badge--neutral">Daily</span></div>'
        '<div class="odm-taskcard-meta"><span><b>Applies to:</b> All, Volute</span>'
        '<span><b>Tools &amp; materials:</b> Thermometer</span>'
        '<span><b>Safety controls:</b> PPE</span>'
        '<span><b>Escalation trigger:</b> Above 90&deg;C</span></div></div></div>'
        '<div class="odm-proc-block"><span class="odm-proc-h">Technician Tasks &mdash; Preventive Maintenance</span>'
        '<div class="odm-taskcard"><div class="odm-taskcard-head">Inspect mechanical seal for leakage'
        '<span class="odm-badge odm-badge--neutral">Monthly</span></div>'
        '<div class="odm-taskcard-meta"><span><b>Failure mode:</b> Seal wear</span>'
        '<span><b>Responsibility:</b> AMD In-house</span></div></div></div>'
        '<div class="odm-proc-block"><span class="odm-proc-h">Technician Tasks &mdash; Condition-Based Maintenance</span>'
        '<div class="odm-taskcard"><div class="odm-taskcard-head">Trend vibration signature'
        '<span class="odm-badge odm-badge--neutral">Weekly</span></div>'
        '<div class="odm-taskcard-meta"><span><b>Tools &amp; materials:</b> Vibrometer</span>'
        '<span><b>Field capture data:</b> <code>{"axis":"H","rms":"mm/s"}</code></span></div></div></div>'
        '<div class="odm-proc-block"><span class="odm-proc-h odm-proc-h--alert">Escalation Criteria</span>'
        '<div class="odm-escalation"><span class="odm-strong">Check bearing temperature &middot; Daily</span>'
        '<span class="odm-escalation-line">' + svg("triangle-alert") + 'Above 90&deg;C</span></div></div>'
        '</div>\n'

        '          <h3 class="odm-dsection">Revision History</h3>\n'
        '          <p class="odm-caption">The original uploaded PDF is the authoritative controlled document. '
        'Revisions are never overwritten.</p>\n'
        '          <div class="odm-card odm-card--flush"><div class="odm-table-wrap">'
        '<table class="odm-table odm-table--compact"><thead><tr>' + rev_head + '</tr></thead>'
        '<tbody>' + rev_rows + '</tbody></table></div></div>\n'

        '        </div>\n      </div>\n    </div>\n'
        '  </div>\n'
        '</main>\n'
    )


# ── O&M MANUALS LIBRARY ────────────────────────────────────────────────────

FOLDERS = [
    ("Aglipay STP", 2, 46, 0, False),
    ("HTT STP", 3, 64, 0, False),
    ("Eastbay Phase-2 TP", 1, 22, 1, False),
    ("Kaysakat TP", 1, 18, 1, False),
    ("Treatment", 0, 31, 2, True),
    ("Pumping Station", 0, 24, 2, False),
]

FILES = [
    ("O&M Manual — Aglipay STP (2024).pdf", "pdf", "Rev. 2"),
    ("O&M Manual — HTT STP (2024).pdf", "pdf", "Rev. 1"),
    ("Pump Station Operating Manual.pdf", "pdf", "Rev. 0"),
    ("Blower Maintenance Annex.xlsx", "xlsx", "—"),
]


def tree_row(name, folders, docs, level, selected=False, expanded=False, is_file=False, rev=None):
    indent = " odm-tree-indent-%d" % level if level else ""
    cls = " is-selected" if selected else ""
    icon = ("folder-open" if expanded else "folder") if not is_file else ("file-text" if rev else "file-spreadsheet")
    suffix = ""
    if not is_file:
        parts = []
        if folders:
            parts.append("%df" % folders)
        if docs:
            parts.append("%dd" % docs)
        if parts:
            suffix = '<span class="odm-tree-count">%s</span>' % " &middot; ".join(parts)
    rev_chip = ('<span class="odm-revchip">%s</span>' % rev) if rev and rev != "—" else ""
    actions = ("" if not is_file else
               '<span class="odm-tree-actions">' + svg("download") + svg("trash-2") + '</span>')
    kebab = ("" if is_file else '<span class="odm-tree-actions">' + svg("list") + '</span>')
    return ('<div class="odm-tree-row%s%s">%s<span class="odm-tree-name">%s</span>%s%s%s%s</div>'
            % (cls, indent, svg(icon), name, suffix, rev_chip, actions, kebab))


def manuals_body():
    tree = (
        tree_row("Aglipay STP", 2, 46, 1, expanded=True)
        + tree_row("O&M Manual — Aglipay STP (2024).pdf", 0, 0, 2, is_file=True, rev="Rev. 2")
        + tree_row("Blower Maintenance Annex.xlsx", 0, 0, 2, is_file=True)
        + tree_row("HTT STP", 3, 64, 1)
        + tree_row("Eastbay Phase-2 TP", 1, 22, 1)
        + tree_row("Kaysakat TP", 1, 18, 1)
        + tree_row("Treatment", 0, 31, 1, selected=True, expanded=True)
        + tree_row("Pump Station Operating Manual.pdf", 0, 0, 2, is_file=True, rev="Rev. 0", selected=True)
        + tree_row("Pumping Station", 0, 24, 1)
    )

    menu = (
        '<div class="odm-menu odm-contextmenu">'
        '<div class="odm-menu-item">' + svg("folder-plus") + 'New Subfolder</div>'
        '<div class="odm-menu-item">' + svg("pencil") + 'Rename</div>'
        '<div class="odm-menu-item">' + svg("move") + 'Move</div>'
        '<div class="odm-menu-sep"></div>'
        '<div class="odm-menu-item odm-menu-item--danger">' + svg("trash-2") + 'Delete</div>'
        '</div>'
    )

    return (
        module_header("O&amp;M Manuals Library", "Document Management System",
                      extra='<span class="odm-stat-tile"><b>83</b><em>Folders</em></span>'
                            '<span class="odm-stat-tile"><b>417</b><em>Files</em></span>') +
        '<main class="odm-main">\n'
        '  <div class="odm-split">\n'

        '    <div class="odm-card odm-split-pane">\n'
        '      <div class="odm-pane-toolbar">'
        '<span class="odm-search odm-grow">' + svg("search") +
        '<input class="odm-input odm-input--search" placeholder="Search folders and files..."></span>'
        '<button class="odm-btn odm-btn--icon odm-btn--sm" title="Clear search">' + svg("x") + '</button></div>\n'
        '      <div class="odm-pane-actions">'
        '<button class="odm-btn odm-btn--sm">' + svg("folder-plus") + 'New Folder</button>'
        '<button class="odm-btn odm-btn--sm odm-btn--primary">' + svg("upload") + 'Upload</button>'
        '<button class="odm-btn odm-btn--sm">Expand</button>'
        '<button class="odm-btn odm-btn--sm">Collapse</button></div>\n'
        '      <div class="odm-pane-actions">'
        '<button class="odm-btn odm-btn--sm">' + svg("folder-plus") + 'New Subfolder</button>'
        '<button class="odm-btn odm-btn--sm">' + svg("pencil") + 'Rename</button>'
        '<button class="odm-btn odm-btn--sm odm-btn--danger">' + svg("trash-2") + 'Delete</button>'
        '<button class="odm-btn odm-btn--sm">' + svg("download") + 'Download</button>'
        '</div>\n'
        '      <div class="odm-breadcrumb"><span>Treatment</span>'
        '<span class="odm-breadcrumb-sep">/</span><span>Pumping Station</span></div>\n'
        '      <div class="odm-tree odm-tree--host">' + tree + menu + '</div>\n'
        '      <div class="odm-pane-foot"><span class="odm-faint">Right-click folders or files for more options.</span></div>\n'
        '    </div>\n'

        '    <div class="odm-card odm-split-pane odm-split-pane--viewer">\n'
        '      <div class="odm-pane-toolbar">'
        '<span class="odm-grow odm-truncate odm-strong">Pump Station Operating Manual.pdf</span>'
        '<button class="odm-btn odm-btn--icon odm-btn--sm">' + svg("x") + '</button>'
        '<span class="odm-zoom">' + svg("x") + '<b>100%</b>' + svg("plus") + '</span>'
        '<button class="odm-btn odm-btn--sm">Fit</button>'
        '<button class="odm-btn odm-btn--sm">' + svg("external-link") + 'Open PDF in new tab</button>'
        '<button class="odm-btn odm-btn--icon odm-btn--sm">' + svg("download") + '</button>'
        '<button class="odm-btn odm-btn--icon odm-btn--sm odm-btn--danger">' + svg("trash-2") + '</button>'
        '</div>\n'
        '      <div class="odm-viewer">'
        '<div class="odm-viewer-page">'
        '<div class="odm-viewer-line" style="width:62%%"></div>'
        '<div class="odm-viewer-line" style="width:88%%"></div>'
        '<div class="odm-viewer-line" style="width:74%%"></div>'
        '<div class="odm-viewer-line" style="width:52%%"></div>'
        '<div class="odm-viewer-line" style="width:80%%"></div>'
        '<div class="odm-viewer-line" style="width:44%%"></div>'
        '</div></div>\n'

        '    </div>\n'
        '  </div>\n'
        '</main>\n'
    )
