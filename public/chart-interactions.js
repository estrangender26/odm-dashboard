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
