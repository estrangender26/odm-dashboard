/* ============================================================
   CHART INTERACTIONS ENGINE
   Click-to-filter, drill-down panel, and filter state for ODM Dashboard.
   All state is in-memory only — no localStorage persistence.
   ============================================================ */

(function (global) {
  'use strict';

  /* ---------- FILTER STATE ---------- */
  let activeFilter = null;

  function getActiveFilter() { return activeFilter; }
  function setActiveFilter(filter) { activeFilter = filter; }
  function clearActiveFilter() { activeFilter = null; }

  /* ---------- FILTER PANEL RENDERING ---------- */

  function renderFilterChip(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!activeFilter) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    container.style.display = 'flex';
    container.innerHTML =
      '<span style="font-size:11px;font-weight:600;color:#4A6380;margin-right:6px">Filtered by:</span>' +
      '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#005BAC;background:#E3F2FD;padding:3px 10px;border-radius:999px;border:1px solid #BBDEFB">' +
        escHtml(activeFilter.label) +
        '<button onclick="ChartInteractions.clearFilter()" style="background:none;border:none;color:#005BAC;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;margin-left:2px" title="Clear filter">&times;</button>' +
      '</span>';
  }

  /* ---------- DRILL-DOWN PANEL ---------- */

  function renderDrillDown(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!data) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    const rows = data.rows || [];
    const hasRows = rows.length > 0;

    let rowsHtml = '';
    if (hasRows) {
      rowsHtml = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px">' +
        '<thead><tr style="border-bottom:1px solid #D6DFE8">' +
          '<th style="text-align:left;padding:5px 4px;color:#5A6B7D;font-weight:600">Asset</th>' +
          '<th style="text-align:left;padding:5px 4px;color:#5A6B7D;font-weight:600">Equipment</th>' +
          '<th style="text-align:left;padding:5px 4px;color:#5A6B7D;font-weight:600">Inspector</th>' +
          '<th style="text-align:left;padding:5px 4px;color:#5A6B7D;font-weight:600">Date</th>' +
          '<th style="text-align:left;padding:5px 4px;color:#5A6B7D;font-weight:600">Finding</th>' +
        '</tr></thead><tbody>' +
        rows.slice(0, 20).map(r =>
          '<tr style="border-bottom:1px solid #EDF1F4">' +
            '<td style="padding:4px;color:#16324F;font-weight:500">' + escHtml(r.AssetTag || r.AssetName || '—') + '</td>' +
            '<td style="padding:4px;color:#4A6380">' + escHtml(r.EquipmentType || '—') + '</td>' +
            '<td style="padding:4px;color:#4A6380">' + escHtml(r.Inspector || '—') + '</td>' +
            '<td style="padding:4px;color:#4A6380;white-space:nowrap">' + escHtml(r.InspectionDate ? r.InspectionDate.slice(0, 10) : '—') + '</td>' +
            '<td style="padding:4px;color:#DC2626;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(r.EntryNotes || r.Capture1Response || r.Findings || '') + '">' + escHtml((r.EntryNotes || r.Capture1Response || r.Findings || '').toString().slice(0, 40)) + '</td>' +
          '</tr>'
        ).join('') +
        (rows.length > 20 ? '<tr><td colspan="5" style="padding:6px;text-align:center;color:#8BA3B8;font-size:10px">... and ' + (rows.length - 20) + ' more records</td></tr>' : '') +
        '</tbody></table>';
    }

    container.innerHTML =
      '<div style="background:#fff;border:1px solid #D6DFE8;border-radius:8px;padding:14px;margin-top:10px;box-shadow:0 1px 4px rgba(0,0,0,.04)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,#E3F2FD,#BBDEFB);display:flex;align-items:center;justify-content:center;color:#005BAC">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:12px;font-weight:700;color:#16324F">' + escHtml(data.title) + '</div>' +
              '<div style="font-size:10px;color:#8BA3B8">' + escHtml(data.subtitle) + '</div>' +
            '</div>' +
          '</div>' +
          '<button onclick="ChartInteractions.clearFilter()" style="font-size:11px;font-weight:600;color:#DC2626;background:#FEF2F2;border:1px solid #FECACA;padding:4px 10px;border-radius:5px;cursor:pointer">Clear Filter</button>' +
        '</div>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px">' +
          '<div style="background:#F8FAFC;padding:6px 12px;border-radius:6px;text-align:center">' +
            '<div style="font-size:9px;color:#8BA3B8;font-weight:600;text-transform:uppercase">Distinct Assets</div>' +
            '<div style="font-size:16px;font-weight:700;color:#DC2626">' + (data.distinctCount || '—') + '</div>' +
          '</div>' +
          '<div style="background:#F8FAFC;padding:6px 12px;border-radius:6px;text-align:center">' +
            '<div style="font-size:9px;color:#8BA3B8;font-weight:600;text-transform:uppercase">Total Inspections</div>' +
            '<div style="font-size:16px;font-weight:700;color:#005BAC">' + (data.totalCount || '—') + '</div>' +
          '</div>' +
          (data.cumulativePct ? '<div style="background:#F8FAFC;padding:6px 12px;border-radius:6px;text-align:center">' +
            '<div style="font-size:9px;color:#8BA3B8;font-weight:600;text-transform:uppercase">Cumulative %</div>' +
            '<div style="font-size:16px;font-weight:700;color:#F59E0B">' + data.cumulativePct + '%</div>' +
          '</div>' : '') +
          (data.topInspector ? '<div style="background:#F8FAFC;padding:6px 12px;border-radius:6px;text-align:center">' +
            '<div style="font-size:9px;color:#8BA3B8;font-weight:600;text-transform:uppercase">Top Inspector</div>' +
            '<div style="font-size:16px;font-weight:700;color:#1F9D55">' + escHtml(data.topInspector) + '</div>' +
          '</div>' : '') +
        '</div>' +
        rowsHtml +
      '</div>';
    container.style.display = 'block';
  }

  /* ---------- CLICK HANDLERS ---------- */

  function onDailyChartClick(elements, labels, distinctArr, totalArr, allRows) {
    if (!elements || !elements.length) return;
    const idx = elements[0].index;
    const dateStr = labels[idx];
    if (!dateStr) return;

    // Filter rows for this date
    const filteredRows = allRows.filter(r => {
      if (!r.InspectionDate) return false;
      const d = r.InspectionDate.toISOString ? r.InspectionDate.toISOString().slice(0, 10) : String(r.InspectionDate).slice(0, 10);
      return d === dateStr && hasNegativeKeyword(r);
    });

    // Find top inspector
    const inspCounts = {};
    filteredRows.forEach(r => { const n = r.Inspector || 'Unknown'; inspCounts[n] = (inspCounts[n] || 0) + 1; });
    const topInsp = Object.entries(inspCounts).sort((a, b) => b[1] - a[1])[0];

    const d = new Date(dateStr);
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    activeFilter = {
      sourceChart: 'dailyDistinctNegativeFindings',
      filterType: 'date',
      value: dateStr,
      label: label
    };

    renderFilterChip('filterChipContainer');
    renderDrillDown('drillDownContainer', {
      title: 'Negative Findings for ' + label,
      subtitle: dateStr,
      distinctCount: distinctArr[idx],
      totalCount: totalArr[idx],
      topInspector: topInsp ? topInsp[0] : null,
      rows: filteredRows
    });

    // Scroll to drill-down
    const dd = document.getElementById('drillDownContainer');
    if (dd) dd.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function onParetoChartClick(elements, labels, distinctArr, totalArr, cumPct, allRows) {
    if (!elements || !elements.length) return;
    const idx = elements[0].index;
    const category = labels[idx];
    if (!category) return;

    // Filter rows for this equipment category
    const filteredRows = allRows.filter(r => {
      if (!hasNegativeKeyword(r)) return false;
      const cat = r.EquipmentType || 'Unknown';
      return cat === category;
    });

    activeFilter = {
      sourceChart: 'paretoAnalysis',
      filterType: 'category',
      value: category,
      label: category
    };

    renderFilterChip('filterChipContainer');
    renderDrillDown('drillDownContainer', {
      title: category + ' — Negative Findings',
      subtitle: 'Pareto Analysis Drill-Down',
      distinctCount: distinctArr[idx],
      totalCount: totalArr[idx],
      cumulativePct: cumPct ? cumPct[idx] : null,
      rows: filteredRows
    });

    const dd = document.getElementById('drillDownContainer');
    if (dd) dd.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- AI INSIGHT DRILL-DOWN (right-side drawer, mobile bottom sheet) ---------- */
  var insightDrawerState = {
    rows: [],
    insights: []
  };
  var drawerReady = false;
  var drawerRoot = null;
  var insightExportHandler = undefined;

  function injectAiInsightDrawerStyles() {
    if (document.getElementById('aiInsightDrilldownStyles')) return;
    var style = document.createElement('style');
    style.id = 'aiInsightDrilldownStyles';
    style.textContent =
      '.insight-card--clickable{cursor:pointer;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background .18s ease}\n' +
      '.insight-card--clickable:hover{transform:translateY(-1px);border-color:var(--border-medium);box-shadow:0 8px 22px rgba(11,29,68,.1)}\n' +
      '.insight-card--clickable:focus-visible{outline:2px solid rgba(35,126,255,.5);outline-offset:2px}\n' +
      '.ai-insight-action{margin-top:10px;font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px}\n' +
      '#aiInsightDrilldownDrawer{position:fixed;inset:0;z-index:10000;display:none}\n' +
      '#aiInsightDrilldownDrawer.open{display:block}\n' +
      '#aiInsightDrilldownBackdrop{position:absolute;inset:0;background:rgba(13,24,38,.35);opacity:0;transition:opacity .2s ease}\n' +
      '#aiInsightDrilldownDrawer.open #aiInsightDrilldownBackdrop{opacity:1}\n' +
      '#aiInsightDrilldownPanel{position:fixed;top:0;right:0;width:min(680px,86vw);height:100%;max-height:100vh;background:#fff;box-shadow:-18px 0 35px rgba(11,29,68,.2);transform:translateX(110%);transition:transform .25s ease;display:flex;flex-direction:column;border-left:1px solid var(--border-light);overflow:hidden}\n' +
      '#aiInsightDrilldownDrawer.open #aiInsightDrilldownPanel{transform:translateX(0)}\n' +
      '#aiInsightDrilldownHeader{padding:14px 16px;border-bottom:1px solid var(--border-light);background:linear-gradient(135deg,#16324F,#005BAC);color:#fff;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;position:sticky;top:0;z-index:2}\n' +
      '#aiInsightDrilldownBody{padding:14px 16px;overflow:auto;flex:1;display:flex;flex-direction:column;gap:12px;background:#FBFDFF}\n' +
      '#aiInsightDrilldownBody .panel-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}\n' +
      '#aiInsightDrilldownBody .panel-cell{border:1px solid var(--border-light);border-radius:8px;padding:8px;background:#fff;font-size:12px}\n' +
      '#aiInsightDrilldownBody .panel-label{color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}\n' +
      '#aiInsightDrilldownBody .panel-value{color:var(--text-primary);font-size:12px;line-height:1.45;word-break:break-word}\n' +
      '#aiInsightDrilldownTableWrap{border:1px solid var(--border-light);background:#fff;border-radius:8px;overflow:auto}\n' +
      '#aiInsightDrilldownTableWrap table{width:100%;border-collapse:collapse}\n' +
      '#aiInsightDrilldownTableWrap th,#aiInsightDrilldownTableWrap td{text-align:left;padding:8px 10px;vertical-align:top;font-size:11px;border-bottom:1px solid var(--border-light)}\n' +
      '#aiInsightDrilldownTableWrap th{background:#F8FAFC;position:sticky;top:0;z-index:1}\n' +
      '#aiInsightDrilldownTableWrap tbody tr:hover{background:#F8FBFF}\n' +
      '#aiInsightEmptyState{border:1px dashed var(--border-medium);border-radius:10px;background:var(--bg-secondary);color:var(--text-secondary);text-align:center;padding:16px}\n' +
      '#aiInsightEmptyState strong{color:var(--text-primary);display:block;margin-bottom:4px}\n' +
      '@media (max-width:768px){\n' +
      '#aiInsightDrilldownPanel{width:100%;border-left:none;border-top:1px solid var(--border-light);transform:translateY(110%);top:auto;bottom:0;box-shadow:0 -12px 30px rgba(11,29,68,.18)}\n' +
      '#aiInsightDrilldownDrawer.open #aiInsightDrilldownPanel{transform:translateY(0)}\n' +
      '#aiInsightDrilldownBody{padding:12px;gap:10px}\n' +
      '#aiInsightDrilldownBody .panel-grid{grid-template-columns:1fr}\n' +
      '#aiInsightDrilldownTableWrap th,#aiInsightDrilldownTableWrap td{padding:5px 3px}\n' +
      '}';
    document.head.appendChild(style);
  }

  function normalizeText(value) {
    return value ? String(value).toLowerCase().trim() : '';
  }

  function toDate(value) {
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
  }

  function formatDateCell(value) {
    var d = toDate(value);
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function toTitleCase(value) {
    return (value || '').toString()
      .toLowerCase()
      .replace(/\b([a-z])/g, function(match) { return match.toUpperCase(); });
  }

  function getExportableRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function(row) {
      return {
        'Asset / Equipment': getAssetName(row),
        'Facility / Site': getFacilityName(row),
        'Inspector': getInspectorName(row),
        'Date Inspected': formatDateCell(row.InspectionDate) || '-',
        'Finding / Status': getStatus(row),
        'Remarks / Negative Finding Text': getRemark(row)
      };
    });
  }

  function findAiInsightExportFn() {
    if (insightExportHandler !== undefined) return insightExportHandler;

    var candidates = [
      'exportVisibleRows',
      'exportRowsToCsv',
      'exportRowsToCSV',
      'exportToCsv',
      'exportToCSV',
      'exportAiRows',
      'exportAiInsightRows',
      'downloadCsv'
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      var fn = window[candidate];
      if (typeof fn === 'function') {
        insightExportHandler = fn;
        return insightExportHandler;
      }
    }

    insightExportHandler = null;
    return insightExportHandler;
  }

  function exportAiInsightRows(insight, rows) {
    var exportFn = findAiInsightExportFn();
    if (!exportFn || !rows.length) return;

    var slug = normalizeText(insight.title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'detail';
    var payload = {
      fileName: 'ai-insight-' + slug + '.csv',
      rows: getExportableRows(rows),
      title: insight.title || 'AI Insight Detail'
    };

    try {
      if (exportFn.length >= 2) {
        exportFn(payload.rows, payload.fileName);
      } else if (exportFn.length >= 1) {
        exportFn(payload.rows);
      } else {
        exportFn();
      }
    } catch (e) {
      console.warn('[AI Insight] Export utility failed.', e);
    }
  }

  function getAssetName(row) {
    return row.AssetTag || row.AssetName || row.EquipmentName || row.EquipmentType || '(Unknown)';
  }

  function getFacilityName(row) {
    return row.Plant || row.Site || row.Facility || '(Unknown facility)';
  }

  function getInspectorName(row) {
    return row.Inspector || '(Unknown inspector)';
  }

  function getStatus(row) {
    return row.Status || row.EscalationTrigger || row.Task || row.Category || '-';
  }

  function getRemark(row) {
    return row.Findings || row.EntryNotes || row.Capture1Response || '-';
  }

  function isPumpNegative(row) {
    return hasNegativeKeyword(row) && /(centrifugal|pump system|pump-system|pump)/.test(normalizeText([row.AssetTag, row.AssetName, row.EquipmentType, row.Task, row.Capture1Response, row.EntryNotes, row.Findings].join(' ')));
  }

  function isCriticalPriority(row) {
    return /(critical|urgent|high priority|high-priority|emergency|shutdown|immediate|major)/.test(
      normalizeText([row.EntryNotes, row.Capture1Response, row.Findings, row.Status, row.EscalationTrigger].join(' '))
    );
  }

  function getInsightType(insight) {
    if (insight && insight.drilldown && insight.drilldown.type) return insight.drilldown.type;
    var title = normalizeText(insight && insight.title || '');
    if (title.indexOf('centrifugal pump') !== -1) return 'centrifugal-pump-negative-findings';
    if (title.indexOf('critical issues require immediate action') !== -1) return 'critical-issues-immediate-action';
    if (title.indexOf('recurring issues on same assets') !== -1) return 'recurring-issues-same-assets';
    if (title.indexOf('inspection coverage gaps detected') !== -1) return 'inspection-coverage-gaps';
    if (title.indexOf('low activity') !== -1) return 'inspectors-low-activity';
    if (title.indexOf('inactive inspector') !== -1) return 'inspectors-inactive';
    if (title.indexOf('negative findings declining') !== -1) return 'negative-findings-declining';
    if (title.indexOf('negative finding rate within normal range') !== -1) return 'negative-finding-rate-normal';
    if (title.indexOf('high negative finding rate') !== -1) return 'negative-finding-rate-high';
    return 'generic';
  }

  function buildAiInsightPayload(insight, rows) {
    var type = getInsightType(insight);
    var payload = { criteria: '-', rows: [], summary: [], notes: '' };

    if (!rows.length) {
      payload.notes = 'No rows available from the current dashboard filter.';
      return payload;
    }

    if (type === 'centrifugal-pump-negative-findings') {
      payload.criteria = 'Negative findings where facility records mention centrifugal/pump system wording.';
      payload.rows = rows.filter(isPumpNegative);
      if (!payload.rows.length) payload.notes = 'No centrifugal/pump-system negative findings found for the current filters.';
      return payload;
    }

    if (type === 'critical-issues-immediate-action') {
      payload.criteria = 'Rows that are negative findings with critical/high-priority wording.';
      payload.rows = rows.filter(function(row) { return hasNegativeKeyword(row) && isCriticalPriority(row); });
      if (!payload.rows.length) payload.notes = 'No critical/high-priority negative findings found for the current filters.';
      return payload;
    }

    if (type === 'recurring-issues-same-assets') {
      var threshold = insight.drilldown && insight.drilldown.threshold ? insight.drilldown.threshold : 3;
      var assetCount = {};
      rows.forEach(function(row) {
        if (!hasNegativeKeyword(row)) return;
        var key = getAssetName(row);
        assetCount[key] = (assetCount[key] || 0) + 1;
      });
      var repeated = Object.keys(assetCount).filter(function(asset) { return assetCount[asset] >= threshold; });
      payload.criteria = 'Assets with repeated negative findings (count >= ' + threshold + ').';
      payload.rows = rows.filter(function(row) { return repeated.indexOf(getAssetName(row)) !== -1; });
      payload.summary.push(repeated.length + ' repeated assets');
      payload.summary.push('Threshold: ' + threshold + ' negative findings');
      if (!payload.rows.length) payload.notes = 'No assets met the recurring findings threshold in current filters.';
      return payload;
    }

    if (type === 'inspection-coverage-gaps') {
      var gapDays = insight.drilldown && insight.drilldown.gapDays ? insight.drilldown.gapDays : 14;
      var today = new Date().toISOString().slice(0, 10);
      var latest = {};
      rows.forEach(function(row) {
        var date = formatDateCell(row.InspectionDate);
        if (!date) return;
        var asset = getAssetName(row);
        if (!latest[asset] || date > latest[asset].date) {
          latest[asset] = { date: date, row: row };
        }
      });
      payload.criteria = 'Assets whose last inspection is older than configured gap days (' + gapDays + ').';
      payload.rows = [];
      Object.keys(latest).forEach(function(asset) {
        var rec = latest[asset];
        var gap = daysBetween(rec.date, today);
        if (gap > gapDays) {
          payload.rows.push({
            _synthetic: true,
            AssetTag: asset,
            Plant: getFacilityName(rec.row),
            Inspector: getInspectorName(rec.row),
            InspectionDate: rec.date,
            Status: 'Overdue (' + gap + ' days)',
            EntryNotes: getRemark(rec.row)
          });
        }
      });
      payload.summary.push(payload.rows.length + ' assets overdue');
      if (!payload.rows.length) payload.notes = 'No assets were overdue in current filters.';
      return payload;
    }

    if (type === 'inspectors-low-activity') {
      var counts = {};
      rows.forEach(function(row) {
        var name = getInspectorName(row);
        if (!counts[name]) counts[name] = 0;
        counts[name] += 1;
      });
      var avg = 0;
      var n = 0;
      Object.keys(counts).forEach(function(key) { avg += counts[key]; n += 1; });
      avg = n ? avg / n : 0;
      var threshold = insight.drilldown && insight.drilldown.threshold ? insight.drilldown.threshold : Math.max(5, avg * 0.3);
      var low = Object.keys(counts).filter(function(name) { return counts[name] < threshold; });
      payload.criteria = 'Inspectors with activity lower than the computed threshold (' + Math.round(threshold) + ' inspections).';
      payload.rows = rows.filter(function(row) { return low.indexOf(getInspectorName(row)) !== -1; });
      payload.summary.push('Average inspections: ' + Math.round(avg));
      payload.summary.push('Threshold: ' + Math.round(threshold));
      if (!payload.rows.length) payload.notes = 'No low-activity inspectors in current filters.';
      return payload;
    }

    if (type === 'inspectors-inactive') {
      var inactivity = insight.drilldown && insight.drilldown.inactivityDays ? insight.drilldown.inactivityDays : 7;
      var latestByInspector = {};
      rows.forEach(function(row) {
        var name = getInspectorName(row);
        var date = formatDateCell(row.InspectionDate);
        if (!date) return;
        if (!latestByInspector[name] || date > latestByInspector[name]) latestByInspector[name] = date;
      });
      var todayDate = new Date().toISOString().slice(0, 10);
      var inactiveInspectors = Object.keys(latestByInspector).filter(function(name) {
        return daysBetween(latestByInspector[name], todayDate) > inactivity;
      });
      payload.criteria = 'Inspectors without inspections in last ' + inactivity + ' days.';
      payload.rows = rows.filter(function(row) { return inactiveInspectors.indexOf(getInspectorName(row)) !== -1; });
      payload.summary.push(inactiveInspectors.length + ' inactive inspector(s)');
      if (!payload.rows.length) payload.notes = 'No inactive inspectors in current filters.';
      return payload;
    }

    if (type === 'negative-findings-declining') {
      var dateBuckets = {};
      rows.forEach(function(row) {
        var date = formatDateCell(row.InspectionDate);
        if (!date) return;
        if (!dateBuckets[date]) dateBuckets[date] = { negative: 0, total: [] };
        if (hasNegativeKeyword(row)) dateBuckets[date].negative += 1;
      });
      var dates = Object.keys(dateBuckets).sort();
      if (dates.length < 4) {
        payload.criteria = 'Need at least 4 date buckets to compare recent vs previous period.';
        payload.rows = rows.filter(hasNegativeKeyword);
        payload.notes = payload.rows.length
          ? 'Using all matching negative rows as period comparison requires more date buckets.'
          : 'No negative rows available for period comparison.';
        return payload;
      }
      var half = Math.floor(dates.length / 2);
      var recent = dates.slice(half);
      var previous = dates.slice(0, half);
      var recentTotal = recent.reduce(function(sum, date) { return sum + dateBuckets[date].negative; }, 0);
      var previousTotal = previous.reduce(function(sum, date) { return sum + dateBuckets[date].negative; }, 0);
      payload.criteria = 'Negative finding volume in recent period vs previous period.';
      payload.summary.push('Recent period: ' + recentTotal);
      payload.summary.push('Previous period: ' + previousTotal);
      payload.rows = rows.filter(function(row) {
        if (!hasNegativeKeyword(row)) return false;
        var date = formatDateCell(row.InspectionDate);
        return recent.indexOf(date) !== -1 || previous.indexOf(date) !== -1;
      });
      if (!payload.rows.length) payload.notes = 'No negative findings available in the compared periods.';
      return payload;
    }

    if (type === 'negative-finding-rate-normal' || type === 'negative-finding-rate-high') {
      payload.criteria = 'Negative findings count compared to total inspections in current dashboard filter.';
      payload.rows = rows.filter(hasNegativeKeyword);
      payload.summary.push('Negative findings: ' + payload.rows.length + ' / ' + rows.length);
      payload.summary.push('Rate: ' + Math.round(rows.length ? (payload.rows.length / rows.length) * 100 : 0) + '%');
      if (!payload.rows.length) payload.notes = 'No negative findings in current filters.';
      return payload;
    }

    payload.criteria = 'Asset-level drill-down filtered to the current dashboard rows.';
    payload.rows = rows.filter(hasNegativeKeyword);
    if (!payload.rows.length) payload.notes = 'No matching negative finding records found in current filters.';
    return payload;
  }

  function renderAiInsightRowsTable(rows) {
    if (!rows.length) {
      return '<div id="aiInsightEmptyState"><strong>No Matching Records</strong>Adjust dashboard filters or verify field availability.</div>';
    }
    return '<div id="aiInsightDrilldownTableWrap"><table><thead><tr>' +
      '<th>Asset / Equipment</th>' +
      '<th>Facility / Site</th>' +
      '<th>Inspector</th>' +
      '<th>Date Inspected</th>' +
      '<th>Finding / Status</th>' +
      '<th>Remarks / Negative Finding Text</th>' +
      '</tr></thead><tbody>' +
      rows.map(function(row) {
        return '<tr>' +
          '<td>' + escHtml(getAssetName(row)) + '</td>' +
          '<td>' + escHtml(getFacilityName(row)) + '</td>' +
          '<td>' + escHtml(getInspectorName(row)) + '</td>' +
          '<td>' + (formatDateCell(row.InspectionDate) || '-') + '</td>' +
          '<td>' + escHtml(getStatus(row)) + '</td>' +
          '<td style="max-width:260px;white-space:normal;word-break:break-word">' + escHtml(getRemark(row) || '-') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function renderAiInsightSeverityBadge(level) {
    var value = normalizeText(level);
    var color = '#64748B';
    if (value === 'critical') color = '#B91C1C';
    if (value === 'high') color = '#B45309';
    if (value === 'medium') color = '#0369A1';
    if (value === 'low') color = '#0F766E';
    return '<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border:1px solid ' + color + ';border-radius:999px;color:' + color + ';font-size:10px;font-weight:700;line-height:1.2;text-transform:uppercase">' + escHtml(toTitleCase(value || 'info')) + '</span>';
  }

  function openAiInsightDrawer(index) {
    var insight = insightDrawerState.insights[Number(index)] || null;
    if (!insight) return;
    var payload = buildAiInsightPayload(insight, insightDrawerState.rows);
    var drawer = ensureAiInsightDrawer();
    if (!drawer) return;

    var titleEl = document.getElementById('aiInsightDrillDownTitle');
    var metaEl = document.getElementById('aiInsightDrillDownMeta');
    var severityEl = document.getElementById('aiInsightDrillDownSeverity');
    var countEl = document.getElementById('aiInsightDrillDownCount');
    var bodyEl = document.getElementById('aiInsightDrilldownBody');
    if (!titleEl || !metaEl || !bodyEl) return;

    var rows = payload.rows || [];
    var hasExport = !!findAiInsightExportFn();
    var details = [
      '<div class="panel-grid">' +
        '<div class="panel-cell"><div class="panel-label">Insight Title</div><div class="panel-value">' + escHtml(insight.title || '-') + '</div></div>' +
        '<div class="panel-cell"><div class="panel-label">Severity</div><div class="panel-value">' + escHtml(insight.severity || '-') + '</div></div>' +
        '<div class="panel-cell"><div class="panel-label">Summary</div><div class="panel-value">' + escHtml(insight.description || '-') + '</div></div>' +
        '<div class="panel-cell"><div class="panel-label">Recommendation</div><div class="panel-value">' + escHtml(insight.recommendation || '-') + '</div></div>' +
      '</div>' +
      '<div class="panel-cell"><div class="panel-label">Filter Criteria</div><div class="panel-value">' + escHtml(payload.criteria) + '</div></div>' +
      '<div class="panel-cell"><div class="panel-label">Matching Records</div><div class="panel-value">' + rows.length + '</div></div>'
    ];

    if (payload.summary.length) {
      details.push('<div class="panel-cell"><div class="panel-label">Drill-down Metrics</div><div class="panel-value">' + escHtml(payload.summary.join(' • ')) + '</div></div>');
    }

    if (hasExport) {
      details.push('<div style="display:flex;justify-content:flex-end;"><button id="aiInsightExportRowsButton" type="button" style="margin-top:6px;background:var(--info);color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:11px;font-weight:700;cursor:pointer;">Export visible rows</button></div>');
    }

    if (payload.notes) {
      details.push('<div id="aiInsightEmptyState"><strong>Note</strong>' + escHtml(payload.notes) + '</div>');
    }

    var missing = [];
    if (!rows.some(function(r) { return normalizeText(r.AssetTag) || normalizeText(r.AssetName) || normalizeText(r.EquipmentName) || normalizeText(r.EquipmentType); })) missing.push('asset/equipment name');
    if (!rows.some(function(r) { return normalizeText(r.Plant) || normalizeText(r.Site) || normalizeText(r.Facility); })) missing.push('facility/site');
    if (!rows.some(function(r) { return normalizeText(r.Inspector); })) missing.push('inspector');
    if (!rows.some(function(r) { return normalizeText(r.InspectionDate); })) missing.push('date inspected');
    if (missing.length) {
      details.push('<div id="aiInsightEmptyState"><strong>Computed from partial data</strong>Some required fields are missing: ' + escHtml(missing.join(', ')) + '</div>');
    }

    details.push(renderAiInsightRowsTable(rows));

    titleEl.textContent = insight.title || 'Insight Detail';
    if (severityEl) {
      severityEl.innerHTML = renderAiInsightSeverityBadge(insight.severity || 'info');
    }
    if (countEl) {
      countEl.textContent = rows.length + ' records';
    }
    bodyEl.innerHTML = details.join('');

    if (hasExport) {
      var exportBtn = document.getElementById('aiInsightExportRowsButton');
      if (exportBtn) {
        exportBtn.onclick = function() { exportAiInsightRows(insight, rows); };
      }
    }

    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function ensureAiInsightDrawer() {
    if (drawerReady) return drawerRoot;
    injectAiInsightDrawerStyles();
    var wrapper = document.createElement('div');
    wrapper.id = 'aiInsightDrilldownDrawer';
    wrapper.innerHTML =
      '<div id="aiInsightDrilldownBackdrop" onclick="window.closeAiInsightDrilldown()"></div>' +
      '<aside id="aiInsightDrilldownPanel" aria-live="polite" aria-label="Insight drill-down drawer">' +
        '<div id="aiInsightDrilldownHeader">' +
          '<div style="display:flex;align-items:flex-start;gap:10px;min-width:0">' +
            '<div style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><polyline points="12 12 16 12 14 10"/></svg>' +
            '</div>' +
            '<div style="min-width:0">' +
              '<h2 id="aiInsightDrillDownTitle" style="color:#fff;font-size:16px;margin:0 0 4px 0;line-height:1.3">Insight Detail</h2>' +
              '<div id="aiInsightDrillDownMeta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:rgba(255,255,255,.8)">' +
                '<span id="aiInsightDrillDownSeverity"></span>' +
                '<span style="opacity:.8">•</span>' +
                '<span id="aiInsightDrillDownCount"></span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:4px;align-items:center;flex-shrink:0">' +
            '<button id="aiInsightCloseButton" style="background:rgba(255,255,255,.14);border:none;color:#fff;cursor:pointer;padding:6px 12px;border-radius:8px;font-size:12px;font-family:inherit;font-weight:600">Close</button>' +
            '<button onclick="window.closeAiInsightDrilldown()" style="background:none;border:none;color:rgba(255,255,255,.75);cursor:pointer;padding:2px 8px;font-size:20px;line-height:1;border-radius:8px">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div id="aiInsightDrilldownBody"></div>' +
      '</aside>';
    wrapper.querySelector('#aiInsightCloseButton').onclick = function() { closeAiInsightDrilldown(); };
    document.body.appendChild(wrapper);
    drawerReady = true;
    drawerRoot = wrapper;
    return drawerRoot;
  }

  function closeAiInsightDrilldown() {
    if (!drawerRoot) return;
    drawerRoot.classList.remove('open');
    document.body.style.overflow = '';
  }

  function attachAiInsightCardHandlers() {
    var container = document.getElementById('insightsContainer');
    if (!container) return;
    var cards = container.querySelectorAll('.insight-card');
    cards.forEach(function(card, index) {
      if (!insightDrawerState.insights[index]) return;
      card.classList.add('insight-card--clickable');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      if (!card.querySelector('.ai-insight-action')) {
        card.innerHTML += '<div class="ai-insight-action">View drill-down</div>';
      }
      card.onclick = function() { openAiInsightDrawer(index); };
      card.onkeydown = function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openAiInsightDrawer(index);
        }
      };
    });
  }

  function patchRenderInsightsForAiCards() {
    if (typeof window.renderInsights !== 'function' || window.__aiInsightRenderPatched) return false;

    var originalRenderInsights = window.renderInsights;
    window.renderInsights = function(rows) {
      var result = originalRenderInsights.call(this, rows);
      insightDrawerState.rows = Array.isArray(rows) ? rows : [];
      insightDrawerState.insights =
        (typeof AnalyticsEngine !== 'undefined' && AnalyticsEngine.generateInsights)
          ? AnalyticsEngine.generateInsights({ rows: insightDrawerState.rows })
          : [];
      attachAiInsightCardHandlers();
      return result;
    };

    window.__aiInsightRenderPatched = true;

    if (typeof getFilteredRows === 'function') {
      var currentRows = getFilteredRows();
      var rows = Array.isArray(currentRows) ? currentRows : [];
      insightDrawerState.rows = rows;
      insightDrawerState.insights =
        (typeof AnalyticsEngine !== 'undefined' && AnalyticsEngine.generateInsights)
          ? AnalyticsEngine.generateInsights({ rows: rows })
          : [];
      attachAiInsightCardHandlers();
    }

    return true;
  }

  function initAiInsightDrilldown() {
    if (drawerReady) return;
    injectAiInsightDrawerStyles();
    var attempts = 0;
    (function bindLoop() {
      if (patchRenderInsightsForAiCards()) return;
      attempts += 1;
      if (attempts < 120) setTimeout(bindLoop, 100);
    })();

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') closeAiInsightDrilldown();
    });
    window.closeAiInsightDrilldown = closeAiInsightDrilldown;
    window.openAiInsightDrawer = openAiInsightDrawer;
  }

  initAiInsightDrilldown();

  /* ---------- SHARED NEGATIVE DETECTION (matches dashboard) ---------- */

  const NEGATIVE_KEYWORDS = [
    'leak','loose','vibration','vibrating','noisy','noise','abnormal',
    'hot','overheat','overheating','smoke','blocked','jammed','misaligned',
    'worn','crack','damage','fail','alarm','not ok','not_ok','ng','no good',
    'defect','fault','error','critical','urgent','repair','replace','broken'
  ];

  function hasNegativeKeyword(row) {
    function check(text) {
      if (!text || text.toString().trim() === '') return false;
      const t = text.toString().toLowerCase();
      return NEGATIVE_KEYWORDS.some(k => t.includes(k));
    }
    return check(row.EntryNotes) || check(row.Capture1Response) || check(row.Findings);
  }

  /* ---------- ESCAPE HTML ---------- */

  function escHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ---------- CLEAR FILTER ---------- */

  function clearFilter() {
    activeFilter = null;
    renderFilterChip('filterChipContainer');
    renderDrillDown('drillDownContainer', null);
  }

  /* ---------- CHART CURSOR HELPERS ---------- */

  function addHoverCursor(chartInstance) {
    if (!chartInstance || !chartInstance.canvas) return;
    chartInstance.canvas.style.cursor = 'default';
    chartInstance.options.onHover = (event, elements) => {
      event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    };
  }

  function enableLegendToggle(chartInstance) {
    if (!chartInstance) return;
    const original = chartInstance.options.plugins.legend.onClick;
    chartInstance.options.plugins.legend.onClick = function(e, legendItem, legend) {
      const ci = legend.chart;
      if (ci.isDatasetVisible(legendItem.datasetIndex)) {
        ci.hide(legendItem.datasetIndex);
      } else {
        ci.show(legendItem.datasetIndex);
      }
    };
  }

  /* ---------- EXPORT ---------- */

  global.ChartInteractions = {
    getActiveFilter,
    setActiveFilter,
    clearActiveFilter,
    onDailyChartClick,
    onParetoChartClick,
    renderFilterChip,
    renderDrillDown,
    clearFilter,
    addHoverCursor,
    enableLegendToggle,
    hasNegativeKeyword,
    escHtml
  };

})(typeof window !== 'undefined' ? window : global);
