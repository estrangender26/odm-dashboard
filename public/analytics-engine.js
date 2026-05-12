/* ============================================================
   ANALYTICS INSIGHTS ENGINE
   Rule-based operational insight generation for ODM Dashboard.
   Architecture supports future AI API integration.
   ============================================================ */

(function (global) {
  'use strict';

  /* ---------- CONFIG / THRESHOLDS ---------- */
  const DEFAULT_CONFIG = {
    spikeThresholdPct: 50,        // % increase to flag as spike
    declineThresholdPct: -30,     // % decrease to flag as decline
    inspectorMinInspections: 5,   // low-activity threshold
    dataQualityThreshold: 95,     // % below = warning
    paretoThreshold: 80,          // cumulative % for Pareto insight
    inactivityDays: 7,            // days since last inspection = inactive
    coverageGapDays: 14,          // days since inspection = gap
    topNAssets: 5,                // top recurring assets to highlight
    rollingWindow: 3,             // days for rolling average
    minNegFindingsForRisk: 10,    // min total negative findings before risk insights fire
    minDistinctAssetsForRisk: 5,  // min distinct assets before dominance insights fire
  };

  const SEVERITY = { INFO: 'info', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };
  const TYPE = { TREND: 'trend', RISK: 'risk', INSPECTOR: 'inspector', ANOMALY: 'anomaly', COVERAGE: 'coverage', RECOMMENDATION: 'recommendation' };

  /* ---------- UTILITIES ---------- */
  function pctChange(current, previous) {
    if (!previous) return 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function rollingAvg(arr, window) {
    if (arr.length < window) return avg(arr);
    return avg(arr.slice(-window));
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  /* ---------- HAS NEGATIVE FINDINGS (mirrors dashboard logic) ---------- */
  const ABNORMAL_KEYWORDS = /abnormal|defect|fault|failure|leak|broken|damage|corrosion|wear|clog|blockage|malfunction|offline|down|alarm|critical|not ok|notok|not functioning|out of service|repair needed|needs repair/i;

  function hasNegativeFindings(row) {
    const notes = row.EntryNotes ? String(row.EntryNotes).trim() : '';
    const capture = row.Capture1Response ? String(row.Capture1Response).trim() : '';
    const findings = row.Findings ? String(row.Findings).trim() : '';
    return ABNORMAL_KEYWORDS.test(notes) || ABNORMAL_KEYWORDS.test(capture) || ABNORMAL_KEYWORDS.test(findings);
  }

  /* ---------- INSIGHT GENERATORS ---------- */

  // 1. TREND INSIGHTS
  function generateTrendInsights(rows, config) {
    const insights = [];
    const dailyMap = new Map();

    rows.forEach(r => {
      if (!r.InspectionDate) return;
      const key = r.InspectionDate.toISOString ? r.InspectionDate.toISOString().slice(0, 10) : String(r.InspectionDate).slice(0, 10);
      if (!dailyMap.has(key)) dailyMap.set(key, { assets: new Set(), total: 0 });
      if (hasNegativeFindings(r)) {
        const assetId = r.AssetTag || r.AssetName || r.EquipmentType || 'Unknown';
        dailyMap.get(key).assets.add(assetId);
      }
      dailyMap.get(key).total++;
    });

    const dates = Array.from(dailyMap.keys()).sort();
    if (dates.length < 4) return insights; // need at least 4 days for meaningful trends

    const distinctArr = dates.map(d => dailyMap.get(d).assets.size);
    const totalArr = dates.map(d => dailyMap.get(d).total);

    // Minimum total negative findings before trend insights fire
    const totalNegFindings = distinctArr.reduce((a, b) => a + b, 0);
    if (totalNegFindings < 5) return insights;

    // Compare latest vs previous period
    const half = Math.floor(dates.length / 2);
    const recentDistinct = distinctArr.slice(half).reduce((a, b) => a + b, 0);
    const prevDistinct = distinctArr.slice(0, half).reduce((a, b) => a + b, 0);
    const change = pctChange(recentDistinct, prevDistinct);

    if (change >= config.spikeThresholdPct) {
      insights.push({
        type: TYPE.TREND, severity: SEVERITY.HIGH,
        title: 'Negative Findings Trend Increased',
        description: `Distinct negative findings increased ${change}% compared to the previous period.`,
        metric: `${recentDistinct} vs ${prevDistinct}`,
        recommendation: 'Review recent inspection entries and prioritize follow-up on flagged assets.'
      });
    } else if (change <= config.declineThresholdPct) {
      insights.push({
        type: TYPE.TREND, severity: SEVERITY.INFO,
        title: 'Negative Findings Declining',
        description: `Distinct negative findings decreased ${Math.abs(change)}% compared to the previous period.`,
        metric: `${recentDistinct} vs ${prevDistinct}`,
        recommendation: 'Continue current maintenance approach. Monitor for sustained improvement.'
      });
    }

    // Spike detection: last day vs rolling average
    if (distinctArr.length >= config.rollingWindow + 1) {
      const lastVal = distinctArr[distinctArr.length - 1];
      const rollAvg = rollingAvg(distinctArr.slice(0, -1), config.rollingWindow);
      if (rollAvg > 0 && ((lastVal - rollAvg) / rollAvg) * 100 >= config.spikeThresholdPct) {
        insights.push({
          type: TYPE.ANOMALY, severity: SEVERITY.CRITICAL,
          title: 'Sudden Spike in Negative Findings',
          description: `A spike was detected on ${formatDate(dates[dates.length - 1])}: ${lastVal} distinct affected assets vs ${Math.round(rollAvg)} recent average.`,
          metric: `${lastVal} (avg ${Math.round(rollAvg)})`,
          recommendation: 'Immediately investigate the cause. Check for equipment failure batch or inspection scope change.'
        });
      }
    }

    // Overall inspection activity trend
    const recentTotal = totalArr.slice(half).reduce((a, b) => a + b, 0);
    const prevTotal = totalArr.slice(0, half).reduce((a, b) => a + b, 0);
    const totalChange = pctChange(recentTotal, prevTotal);
    if (totalChange <= config.declineThresholdPct) {
      insights.push({
        type: TYPE.TREND, severity: SEVERITY.MEDIUM,
        title: 'Inspection Activity Declining',
        description: `Total inspection entries decreased ${Math.abs(totalChange)}% in the recent period.`,
        metric: `${recentTotal} vs ${prevTotal}`,
        recommendation: 'Verify inspection schedules are being followed. Check for resource constraints.'
      });
    }

    return insights;
  }

  // 2. ASSET RISK INSIGHTS
  function generateRiskInsights(rows, config) {
    const insights = [];
    const catData = new Map();

    rows.forEach(r => {
      if (!hasNegativeFindings(r)) return;
      const cat = r.EquipmentType || 'Unknown';
      const assetId = r.AssetTag || r.AssetName || 'Unknown';
      if (!catData.has(cat)) catData.set(cat, { assets: new Set(), total: 0 });
      catData.get(cat).assets.add(assetId);
      catData.get(cat).total++;
    });

    if (!catData.size) return insights;

    const sorted = Array.from(catData.entries())
      .map(([cat, data]) => ({ category: cat, distinct: data.assets.size, total: data.total }))
      .sort((a, b) => b.distinct - a.distinct);

    const totalDistinct = sorted.reduce((s, d) => s + d.distinct, 0);
    const totalNegRecords = sorted.reduce((s, d) => s + d.total, 0);

    // Skip risk insights if data is too sparse to be meaningful
    if (totalNegRecords < config.minNegFindingsForRisk || totalDistinct < config.minDistinctAssetsForRisk) {
      // Still check for recurring individual assets
    } else {
      // Top category dominance
      if (sorted.length > 0 && totalDistinct > 0) {
        const topPct = Math.round((sorted[0].distinct / totalDistinct) * 100);
        if (topPct >= 40) {
          insights.push({
            type: TYPE.RISK, severity: topPct >= 60 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
            title: `${sorted[0].category} Systems Dominate Negative Findings`,
            description: `${sorted[0].category} accounts for ${topPct}% of distinct equipment with negative findings (${sorted[0].distinct} of ${totalDistinct} assets, ${sorted[0].total} records).`,
            metric: `${topPct}% of ${totalDistinct} assets`,
            recommendation: `Prioritize preventive maintenance planning for ${sorted[0].category.toLowerCase()} systems. Review recurring failure patterns.`
          });
        }

        // Pareto insight
        let cum = 0;
        let paretoCount = 0;
        for (const s of sorted) {
          cum += s.distinct;
          paretoCount++;
          if ((cum / totalDistinct) * 100 >= config.paretoThreshold) break;
        }
        if (paretoCount < sorted.length && sorted.length >= 3) {
          insights.push({
            type: TYPE.RISK, severity: SEVERITY.MEDIUM,
            title: 'Pareto Concentration Detected',
            description: `${paretoCount} of ${sorted.length} equipment categories account for 80% of distinct negative findings.`,
            metric: `${paretoCount}/${sorted.length} categories`,
            recommendation: 'Focus corrective efforts on the top equipment categories for maximum impact.'
          });
        }
      }
    }

    // Recurring individual assets
    const assetCounts = new Map();
    rows.forEach(r => {
      if (!hasNegativeFindings(r)) return;
      const key = r.AssetTag || r.AssetName || 'Unknown';
      assetCounts.set(key, (assetCounts.get(key) || 0) + 1);
    });
    const recurring = Array.from(assetCounts.entries())
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, config.topNAssets);

    if (recurring.length >= 2) {
      insights.push({
        type: TYPE.RISK, severity: SEVERITY.HIGH,
        title: 'Recurring Issues on Specific Assets',
        description: `${recurring.length} assets show repeated negative findings. Top: ${recurring[0][0]} (${recurring[0][1]} occurrences).`,
        metric: `${recurring.length} recurring assets`,
        recommendation: 'Schedule dedicated maintenance review for assets with 3+ repeated findings. Consider replacement assessment.'
      });
    }

    return insights;
  }

  // 3. INSPECTOR INSIGHTS
  function generateInspectorInsights(rows, config) {
    const insights = [];
    const byInspector = new Map();

    rows.forEach(r => {
      const name = r.Inspector || '(Unknown)';
      if (!byInspector.has(name)) {
        byInspector.set(name, { count: 0, negative: 0, dates: [] });
      }
      const d = byInspector.get(name);
      d.count++;
      if (hasNegativeFindings(r)) d.negative++;
      if (r.InspectionDate) {
        const key = r.InspectionDate.toISOString ? r.InspectionDate.toISOString().slice(0, 10) : String(r.InspectionDate).slice(0, 10);
        d.dates.push(key);
      }
    });

    if (byInspector.size < 2) return insights;

    // Low-activity inspectors
    const avgInspections = avg(Array.from(byInspector.values()).map(d => d.count));
    const lowActivity = Array.from(byInspector.entries())
      .filter(([, d]) => d.count < Math.max(config.inspectorMinInspections, avgInspections * 0.3))
      .map(([name]) => name);

    if (lowActivity.length >= 2) {
      insights.push({
        type: TYPE.INSPECTOR, severity: SEVERITY.MEDIUM,
        title: `${lowActivity.length} Inspectors with Low Activity`,
        description: `${lowActivity.slice(0, 3).join(', ')}${lowActivity.length > 3 ? ' and others' : ''} have significantly fewer inspection entries than average (${Math.round(avgInspections)}).`,
        metric: `${lowActivity.length} of ${byInspector.size} inspectors`,
        recommendation: 'Verify inspector assignments and workload distribution. Check for scheduling gaps or resource issues.'
      });
 }

    // Inactive inspectors (no recent inspections)
    const today = todayISO();
    const inactive = Array.from(byInspector.entries())
      .filter(([, d]) => {
        if (!d.dates.length) return true;
        const lastDate = d.dates.sort()[d.dates.length - 1];
        return daysBetween(lastDate, today) > config.inactivityDays;
      })
      .map(([name, d]) => ({ name, lastDate: d.dates.sort()[d.dates.length - 1] || 'unknown' }));

    if (inactive.length >= 1) {
      insights.push({
        type: TYPE.INSPECTOR, severity: SEVERITY.LOW,
        title: `${inactive.length} Inactive Inspector${inactive.length > 1 ? 's' : ''}`,
        description: `${inactive.slice(0, 3).map(i => i.name).join(', ')}${inactive.length > 3 ? ' and others' : ''} have no inspection activity in the last ${config.inactivityDays} days.`,
        metric: `${inactive.length} inactive`,
        recommendation: 'Confirm inspector availability and reassign coverage if needed.'
      });
    }

    // Data quality across inspectors
    const dqScores = Array.from(byInspector.values()).map(d => ({
      total: d.count,
      negative: d.negative,
      quality: d.count > 0 ? 100 - (d.negative / d.count * 100) : 100
    }));
    const avgQuality = avg(dqScores.map(s => s.quality));
    if (avgQuality >= config.dataQualityThreshold) {
      insights.push({
        type: TYPE.INSPECTOR, severity: SEVERITY.INFO,
        title: 'High Data Quality Across Inspectors',
        description: `Average data quality remains above ${config.dataQualityThreshold}% across all ${byInspector.size} inspectors.`,
        metric: `${Math.round(avgQuality)}% avg quality`,
        recommendation: 'Maintain current inspection standards and data capture procedures.'
      });
    }

    return insights;
  }

  // 4. COVERAGE INSIGHTS
  function generateCoverageInsights(rows, config) {
    const insights = [];
    const assetDates = new Map();

    rows.forEach(r => {
      const asset = r.AssetTag || r.AssetName || 'Unknown';
      const date = r.InspectionDate ? (r.InspectionDate.toISOString ? r.InspectionDate.toISOString().slice(0, 10) : String(r.InspectionDate).slice(0, 10)) : null;
      if (!date) return;
      if (!assetDates.has(asset) || date > assetDates.get(asset)) {
        assetDates.set(asset, date);
      }
    });

    const today = todayISO();
    const uncovered = Array.from(assetDates.entries())
      .filter(([, lastDate]) => daysBetween(lastDate, today) > config.coverageGapDays)
      .map(([asset]) => asset);

    if (uncovered.length >= 3) {
      insights.push({
        type: TYPE.COVERAGE, severity: SEVERITY.MEDIUM,
        title: 'Inspection Coverage Gaps Detected',
        description: `${uncovered.length} assets have not been inspected within the last ${config.coverageGapDays} days.`,
        metric: `${uncovered.length} assets overdue`,
        recommendation: 'Schedule overdue inspections. Prioritize assets with historical negative findings.'
      });
    }

    // Assets with negative findings that haven't been re-inspected
    const negAssets = new Set();
    rows.forEach(r => { if (hasNegativeFindings(r)) negAssets.add(r.AssetTag || r.AssetName || 'Unknown'); });
    const staleNeg = Array.from(negAssets).filter(a => {
      const lastDate = assetDates.get(a);
      if (!lastDate) return true;
      return daysBetween(lastDate, today) > config.coverageGapDays;
    });

    if (staleNeg.length >= 2) {
      insights.push({
        type: TYPE.COVERAGE, severity: SEVERITY.HIGH,
        title: 'Unresolved Negative Findings Need Follow-up',
        description: `${staleNeg.length} assets with prior negative findings have not been re-inspected recently.`,
        metric: `${staleNeg.length} assets`,
        recommendation: 'Prioritize follow-up inspections on assets with open negative findings to verify resolution status.'
      });
    }

    return insights;
  }

  // 5. RECOMMENDATIONS
  function generateRecommendations(insights, rows) {
    const recs = [];

    // If many negative findings overall (threshold: at least 10 negative records)
    const negCount = rows.filter(r => hasNegativeFindings(r)).length;
    const negPct = rows.length > 0 ? Math.round((negCount / rows.length) * 100) : 0;

    if (negCount >= 10 && negPct >= 10) {
      recs.push({
        type: TYPE.RECOMMENDATION, severity: SEVERITY.HIGH,
        title: 'High Negative Finding Rate',
        description: `${negPct}% of inspections (${negCount} entries) contain negative findings. This exceeds the 10% threshold.`,
        metric: `${negPct}% negative rate`,
        recommendation: 'Initiate a focused maintenance campaign. Use the Pareto chart to target the highest-impact equipment categories first.'
      });
    } else if (negCount >= 10 && negPct > 0) {
      recs.push({
        type: TYPE.RECOMMENDATION, severity: SEVERITY.INFO,
        title: 'Negative Finding Rate Within Normal Range',
        description: `${negPct}% of inspections contain negative findings (${negCount} entries).`,
        metric: `${negPct}% negative rate`,
        recommendation: 'Continue monitoring. Address individual findings through standard maintenance workflow.'
      });
    }

    // If critical insights exist, add summary recommendation
    const criticalCount = insights.filter(i => i.severity === SEVERITY.CRITICAL).length;
    if (criticalCount > 0) {
      recs.push({
        type: TYPE.RECOMMENDATION, severity: SEVERITY.CRITICAL,
        title: 'Critical Issues Require Immediate Action',
        description: `${criticalCount} critical operational insight${criticalCount > 1 ? 's' : ''} detected. Review all high-priority items.`,
        metric: `${criticalCount} critical`,
        recommendation: 'Escalate to maintenance management. Review critical findings and assign corrective actions with deadlines.'
      });
    }

    return recs;
  }

  /* ---------- MAIN ENGINE ---------- */

  /**
   * Generate operational insights from dashboard data.
   * @param {Object} data - Dashboard data object
   * @param {Array} data.rows - Inspection rows array
   * @param {Object} config - Optional configuration overrides
   * @returns {Array} Generated insights array
   */
  function generateInsights(data, config) {
    const rows = data.rows || [];
    if (!rows.length) return [];

    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    const allInsights = [];

    allInsights.push(...generateTrendInsights(rows, cfg));
    allInsights.push(...generateRiskInsights(rows, cfg));
    allInsights.push(...generateInspectorInsights(rows, cfg));
    allInsights.push(...generateCoverageInsights(rows, cfg));
    allInsights.push(...generateRecommendations(allInsights, rows));

    // Sort by severity weight (critical first)
    const severityWeight = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    allInsights.sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity]);

    return allInsights;
  }

  /* ---------- EXPORT ---------- */
  global.AnalyticsEngine = {
    generateInsights,
    SEVERITY,
    TYPE,
    config: DEFAULT_CONFIG
  };

})(typeof window !== 'undefined' ? window : global);
