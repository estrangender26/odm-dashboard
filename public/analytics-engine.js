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

  function getAssetName(row) {
    return row.AssetTag || row.AssetName || row.EquipmentName || row.EquipmentType || 'Unknown';
  }

  function getCategoryName(row) {
    return row.EquipmentType || row.Category || row.Task || 'Unknown';
  }

  function getInspectorName(row) {
    return row.Inspector || '(Unknown)';
  }

  function isCriticalPriority(row) {
    return /(critical|urgent|high priority|high-priority|emergency|shutdown|immediate|major)/.test(
      String([row.EntryNotes, row.Capture1Response, row.Findings, row.Status, row.EscalationTrigger].join(' ')).toLowerCase()
    );
  }

  function getCriticalContributorName(row) {
    return getCategoryName(row) || getAssetName(row);
  }

  function buildParetoTopContributors(rows) {
    const negativeRows = rows.filter(r => hasNegativeFindings(r));
    const groups = new Map();

    negativeRows.forEach(r => {
      const name = getCriticalContributorName(r);
      if (!groups.has(name)) {
        groups.set(name, { name, facility: r.Plant || r.Site || r.Facility || '(Unknown facility)', count: 0 });
      }
      const group = groups.get(name);
      group.count++;
      if (r.Plant || r.Site || r.Facility) group.facility = r.Plant || r.Site || r.Facility;
    });

    const sorted = Array.from(groups.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const take = Math.max(1, Math.ceil(sorted.length * 0.2));
    const total = negativeRows.length || 1;
    let cumulative = 0;

    return sorted.slice(0, take).map(group => {
      cumulative += group.count;
      return {
        name: group.name,
        facility: group.facility,
        findingCount: group.count,
        share: Math.round((group.count / total) * 100),
        cumulative: Math.round((cumulative / total) * 100)
      };
    });
  }

  function normalizeInsightText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getInsightDrilldownType(insight) {
    return insight && insight.drilldown && insight.drilldown.type ? insight.drilldown.type : '';
  }

  function getInsightConcentrationCategory(insight) {
    if (!insight || !insight.drilldown) return '';
    return normalizeInsightText(insight.drilldown.category || insight.drilldown.dominantCategory || '');
  }

  function getCriticalContributorSet(insight) {
    if (!insight || !insight.drilldown || !Array.isArray(insight.drilldown.contributors)) return new Set();
    return new Set(insight.drilldown.contributors.map(item => normalizeInsightText(item && item.name)).filter(Boolean));
  }

  function removeOverlappingManagementInsights(insights) {
    const criticalInsight = insights.find(insight => getInsightDrilldownType(insight) === 'critical-issues-immediate-action');
    const criticalContributors = getCriticalContributorSet(criticalInsight);

    return insights.filter(insight => {
      if (!criticalInsight) return true;

      const drilldownType = getInsightDrilldownType(insight);
      const title = normalizeInsightText(insight && insight.title);

      if (drilldownType === 'pareto-concentration') return false;

      if (
        drilldownType === 'dominant-equipment-type-negative-findings' ||
        drilldownType === 'centrifugal-pump-negative-findings' ||
        title.includes('systems dominate negative findings')
      ) {
        const category = getInsightConcentrationCategory(insight);
        return !category || !criticalContributors.has(category);
      }

      return true;
    });
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  /* ---------- HAS NEGATIVE FINDINGS (EXACT match to dashboard logic) ---------- */
  const ABNORMAL_KEYWORDS = [
    'leak','loose','vibration','vibrating','noisy','noise','abnormal',
    'hot','overheat','overheating','smoke','blocked','jammed','misaligned',
    'worn','crack','damage','fail','alarm','not ok','not_ok','ng','no good',
    'defect','fault','error','critical','urgent','repair','replace','broken'
  ];

  function hasAbnormalKeyword(text) {
    if (!text || text.toString().trim() === '') return false;
    const t = text.toString().toLowerCase();
    return ABNORMAL_KEYWORDS.some(k => t.includes(k));
  }

  function hasNegativeFindings(row) {
    if (hasAbnormalKeyword(row.EntryNotes)) return true;
    if (hasAbnormalKeyword(row.Capture1Response)) return true;
    if (hasAbnormalKeyword(row.Findings)) return true;
    return false;
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
        const assetId = getAssetName(r);
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
        recommendation: 'Review recent inspection entries and prioritize follow-up on flagged assets.',
        drilldown: { type: 'negative-findings-trend-increased', change, recentDistinct, prevDistinct }
      });
    } else if (change <= config.declineThresholdPct) {
      insights.push({
        type: TYPE.TREND, severity: SEVERITY.INFO,
        title: 'Negative Findings Declining',
        description: `Distinct negative findings decreased ${Math.abs(change)}% compared to the previous period.`,
        metric: `${recentDistinct} vs ${prevDistinct}`,
        recommendation: 'Continue current maintenance approach. Monitor for sustained improvement.',
        drilldown: {
          type: 'negative-findings-declining',
          change,
          recentDistinct,
          prevDistinct,
          periodSize: half,
          totalDays: dates.length
        }
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
          recommendation: 'Immediately investigate the cause. Check for equipment failure batch or inspection scope change.',
          drilldown: {
            type: 'sudden-spike-negative-findings',
            spikeDate: dates[dates.length - 1],
            lastVal,
            rollingAverage: Math.round(rollAvg)
          }
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
        recommendation: 'Verify inspection schedules are being followed. Check for resource constraints.',
        drilldown: {
          type: 'inspection-activity-declining',
          change: totalChange,
          recentTotal,
          prevTotal,
          periodSize: half,
          totalDays: dates.length
        }
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
      const cat = getCategoryName(r);
      const assetId = getAssetName(r);
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
          const dominantCategory = sorted[0].category || 'Unknown';
          const isPumpDominant =
            /centrifugal|pump system|pump-system|pump/i.test(String(dominantCategory).toLowerCase());
          insights.push({
            type: TYPE.RISK, severity: topPct >= 60 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
            title: isPumpDominant
              ? 'Centrifugal Pump Systems Dominate Negative Findings'
              : `${dominantCategory} Systems Dominate Negative Findings`,
            description: `${sorted[0].category} accounts for ${sorted[0].distinct} distinct assets with ${sorted[0].total} negative findings (${topPct}% of ${totalDistinct} affected assets).`,
            metric: `${sorted[0].distinct} assets • ${sorted[0].total} findings`,
            recommendation: `Prioritize preventive maintenance planning for ${sorted[0].category.toLowerCase()} systems. Review recurring failure patterns.`,
            drilldown: {
              type: isPumpDominant ? 'centrifugal-pump-negative-findings' : 'dominant-equipment-type-negative-findings',
              category: sorted[0].category,
              topPercent: topPct,
              distinctAssets: sorted[0].distinct,
              recordCount: sorted[0].total
            }
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
          const paretoCategories = sorted.slice(0, paretoCount);
          const paretoAssets = paretoCategories.reduce((sum, item) => sum + item.distinct, 0);
          const paretoRecords = paretoCategories.reduce((sum, item) => sum + item.total, 0);
          insights.push({
            type: TYPE.RISK, severity: SEVERITY.MEDIUM,
            title: 'Pareto Concentration Detected',
            description: `${paretoCount} equipment categories account for ${paretoAssets} distinct assets and ${paretoRecords} negative findings.`,
            metric: `${paretoCount} categories • ${paretoRecords} findings`,
            recommendation: 'Focus corrective efforts on the top equipment categories for maximum impact.',
            drilldown: {
              type: 'pareto-concentration',
              categories: paretoCategories.map(item => item.category),
              distinctCategories: paretoCount,
              distinctAssets: paretoAssets,
              recordCount: paretoRecords,
              totalCategories: sorted.length
            }
          });
        }
      }
    }

    // Recurring individual assets
    const assetCounts = new Map();
    rows.forEach(r => {
      if (!hasNegativeFindings(r)) return;
      const key = getAssetName(r);
      assetCounts.set(key, (assetCounts.get(key) || 0) + 1);
    });
    const recurring = Array.from(assetCounts.entries())
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, config.topNAssets);

    if (recurring.length >= 2) {
      insights.push({
        type: TYPE.RISK, severity: SEVERITY.HIGH,
        title: 'Recurring Issues on Same Assets',
        description: `${recurring.length} assets show repeated negative findings across ${recurring.reduce((sum, item) => sum + item[1], 0)} records. Top: ${recurring[0][0]} (${recurring[0][1]} occurrences).`,
        metric: `${recurring.length} assets • ${recurring.reduce((sum, item) => sum + item[1], 0)} findings`,
        recommendation: 'Schedule dedicated maintenance review for assets with 3+ repeated findings. Consider replacement assessment.',
        drilldown: {
          type: 'recurring-issues-same-assets',
          threshold: 3,
          recurring
        }
      });
    }

    return insights;
  }

  // 3. INSPECTOR INSIGHTS
  function generateInspectorInsights(rows, config) {
    const insights = [];
    const byInspector = new Map();

    rows.forEach(r => {
      const name = getInspectorName(r);
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

    // Inactive inspectors are a current availability concern. Keep them out of
    // the low-activity population so the same person does not appear in both cards.
    const today = todayISO();
    const inactive = Array.from(byInspector.entries())
      .filter(([, d]) => {
        if (!d.dates.length) return true;
        const lastDate = d.dates.sort()[d.dates.length - 1];
        return daysBetween(lastDate, today) > config.inactivityDays;
      })
      .map(([name, d]) => ({ name, lastDate: d.dates.sort()[d.dates.length - 1] || 'unknown' }));
    const inactiveNames = new Set(inactive.map(item => item.name));

    // Low-activity inspectors
    const avgInspections = avg(Array.from(byInspector.values()).map(d => d.count));
    const lowActivity = Array.from(byInspector.entries())
      .filter(([name, d]) => !inactiveNames.has(name) && d.count < Math.max(config.inspectorMinInspections, avgInspections * 0.3))
      .map(([name]) => name);

    if (lowActivity.length >= 2) {
      insights.push({
        type: TYPE.INSPECTOR, severity: SEVERITY.MEDIUM,
        title: `${lowActivity.length} Inspectors with Low Activity`,
        description: `${lowActivity.slice(0, 3).join(', ')}${lowActivity.length > 3 ? ' and others' : ''} have significantly fewer inspection entries than average (${Math.round(avgInspections)}).`,
        metric: `${lowActivity.length} inspectors • ${lowActivity.reduce((sum, name) => sum + (byInspector.get(name) ? byInspector.get(name).count : 0), 0)} records`,
        recommendation: 'Verify inspector assignments and workload distribution. Check for scheduling gaps or resource issues.',
        drilldown: {
          type: 'inspectors-low-activity',
          avgInspections: Math.round(avgInspections),
          threshold: Math.max(config.inspectorMinInspections, avgInspections * 0.3),
          inspectors: lowActivity
        }
      });
 }

    if (inactive.length >= 1) {
      insights.push({
        type: TYPE.INSPECTOR, severity: SEVERITY.LOW,
        title: `${inactive.length} Inactive Inspector${inactive.length > 1 ? 's' : ''}`,
        description: `${inactive.slice(0, 3).map(i => i.name).join(', ')}${inactive.length > 3 ? ' and others' : ''} have no inspection activity in the last ${config.inactivityDays} days.`,
        metric: `${inactive.length} inspectors • ${inactive.reduce((sum, item) => sum + (byInspector.get(item.name) ? byInspector.get(item.name).count : 0), 0)} records`,
        recommendation: 'Confirm inspector availability and reassign coverage if needed.',
        drilldown: { type: 'inspectors-inactive', inactivityDays: config.inactivityDays, inspectors: inactive.map(item => item.name) }
      });
    }

    return insights;
  }

  // 4. COVERAGE INSIGHTS
  function generateCoverageInsights(rows, config) {
    const insights = [];
    const assetDates = new Map();

    rows.forEach(r => {
      const asset = getAssetName(r);
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
    const uncoveredSet = new Set(uncovered);
    const negAssets = new Set();
    rows.forEach(r => { if (hasNegativeFindings(r)) negAssets.add(getAssetName(r)); });
    const staleNeg = Array.from(negAssets).filter(asset => uncoveredSet.has(asset));

    if (uncovered.length >= 3) {
      insights.push({
        type: TYPE.COVERAGE, severity: SEVERITY.MEDIUM,
        title: 'Inspection Coverage Gaps Detected',
        description: `${uncovered.length} assets have not been inspected within the last ${config.coverageGapDays} days${staleNeg.length ? `, including ${staleNeg.length} with prior negative findings` : ''}.`,
        metric: `${uncovered.length} assets overdue${staleNeg.length ? ` • ${staleNeg.length} priority` : ''}`,
        recommendation: 'Schedule overdue inspections. Prioritize assets with historical negative findings.',
        drilldown: {
          type: 'inspection-coverage-gaps',
          gapDays: config.coverageGapDays,
          overdueAssets: uncovered,
          priorityNegativeAssets: staleNeg,
          distinctAssets: uncovered.length,
          priorityCount: staleNeg.length
        }
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
        recommendation: 'Initiate a focused maintenance campaign. Use the Pareto chart to target the highest-impact equipment categories first.',
        drilldown: { type: 'negative-finding-rate-high', negCount, totalCount: rows.length, negPct }
      });
    } else if (negCount >= 10 && negPct > 0) {
      recs.push({
        type: TYPE.RECOMMENDATION, severity: SEVERITY.INFO,
        title: 'Negative Finding Rate Within Normal Range',
        description: `${negPct}% of inspections contain negative findings (${negCount} entries).`,
        metric: `${negPct}% negative rate`,
        recommendation: 'Continue monitoring. Address individual findings through standard maintenance workflow.',
        drilldown: { type: 'negative-finding-rate-normal', negCount, totalCount: rows.length, negPct }
      });
    }

    // Critical issues are the top 20% Pareto contributors to negative findings.
    const criticalContributors = buildParetoTopContributors(rows);
    const criticalFindingCount = criticalContributors.reduce((sum, item) => sum + item.findingCount, 0);
    if (criticalContributors.length > 0 && criticalFindingCount > 0) {
      recs.push({
        type: TYPE.RECOMMENDATION, severity: SEVERITY.CRITICAL,
        title: 'Critical Issues Require Immediate Action',
        description: `${criticalContributors.length} Pareto top-20% contributor${criticalContributors.length !== 1 ? 's' : ''} account for ${criticalFindingCount} negative finding${criticalFindingCount !== 1 ? 's' : ''}.`,
        metric: `${criticalContributors.length} contributors • ${criticalFindingCount} findings`,
        recommendation: 'Escalate Pareto top contributors to maintenance management. Assign corrective actions against the highest-impact assets or categories.',
        drilldown: {
          type: 'critical-issues-immediate-action',
          basis: 'pareto-top-20-negative-findings',
          contributors: criticalContributors,
          distinctAssets: criticalContributors.length,
          recordCount: criticalFindingCount
        }
      });
    }

    const explicitCriticalRows = rows.filter(r => hasNegativeFindings(r) && isCriticalPriority(r));
    const explicitCriticalAssets = new Set(explicitCriticalRows.map(r => getAssetName(r)));
    if (explicitCriticalRows.length > 0) {
      recs.push({
        type: TYPE.RECOMMENDATION, severity: SEVERITY.HIGH,
        title: 'Explicit Critical Findings Detected',
        description: `${explicitCriticalAssets.size} asset${explicitCriticalAssets.size !== 1 ? 's' : ''} include explicit critical/high-priority wording across ${explicitCriticalRows.length} finding${explicitCriticalRows.length !== 1 ? 's' : ''}.`,
        metric: `${explicitCriticalAssets.size} assets • ${explicitCriticalRows.length} findings`,
        recommendation: 'Review explicitly critical wording alongside Pareto-driven priorities.',
        drilldown: {
          type: 'explicit-critical-findings',
          distinctAssets: explicitCriticalAssets.size,
          recordCount: explicitCriticalRows.length
        }
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

    const finalInsights = removeOverlappingManagementInsights(allInsights);

    // Sort by severity weight (critical first)
    const severityWeight = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    finalInsights.sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity]);

    return finalInsights;
  }

  /* ---------- EXPORT ---------- */
  global.AnalyticsEngine = {
    generateInsights,
    SEVERITY,
    TYPE,
    config: DEFAULT_CONFIG
  };

})(typeof window !== 'undefined' ? window : global);
