/* ============================================================
   AI ASSISTANT ENGINE
   Phase 1: Rule-based Q&A using dashboard data.
   Phase 2: Structured for external AI API integration.
   No external API keys required. No localStorage.
   ============================================================ */

(function (global) {
  'use strict';

  /* ---------- SUGGESTED PROMPTS ---------- */
  const SUGGESTED_PROMPTS = [
    'What are the top recurring equipment issues?',
    'Why are negative findings increasing?',
    'Which assets need priority attention?',
    'Summarize inspector performance.',
    'What should operations focus on this week?'
  ];

  /* ---------- NEGATIVE KEYWORDS (matches dashboard) ---------- */
  const NEG_KW = ['leak','loose','vibration','vibrating','noisy','noise','abnormal','hot','overheat','overheating','smoke','blocked','jammed','misaligned','worn','crack','damage','fail','alarm','not ok','not_ok','ng','no good','defect','fault','error','critical','urgent','repair','replace','broken'];

  function hasNeg(row) {
    const t = String(row.EntryNotes || '').toLowerCase();
    const c = String(row.Capture1Response || '').toLowerCase();
    const f = String(row.Findings || '').toLowerCase();
    return NEG_KW.some(k => t.includes(k) || c.includes(k) || f.includes(k));
  }

  /* ---------- CONTEXT BUILDER ---------- */
  function buildContext(rows) {
    const total = rows.length;
    const neg = rows.filter(hasNeg);
    const negCount = neg.length;
    const negPct = total > 0 ? Math.round((negCount / total) * 100) : 0;

    // Daily distinct
    const daily = new Map();
    rows.forEach(r => {
      if (!r.InspectionDate) return;
      const k = r.InspectionDate.toISOString ? r.InspectionDate.toISOString().slice(0,10) : String(r.InspectionDate).slice(0,10);
      if (!daily.has(k)) daily.set(k, { assets: new Set(), total: 0 });
      if (hasNeg(r)) daily.get(k).assets.add(r.AssetTag || r.AssetName || 'Unknown');
      daily.get(k).total++;
    });
    const dates = Array.from(daily.keys()).sort();
    const dailyDistinct = dates.map(d => daily.get(d).assets.size);
    const totalDistinct = dailyDistinct.reduce((a,b) => a+b, 0);

    // Equipment categories
    const catData = new Map();
    rows.forEach(r => {
      if (!hasNeg(r)) return;
      const cat = r.EquipmentType || 'Unknown';
      if (!catData.has(cat)) catData.set(cat, { assets: new Set(), total: 0 });
      catData.get(cat).assets.add(r.AssetTag || r.AssetName || 'Unknown');
      catData.get(cat).total++;
    });
    const cats = Array.from(catData.entries()).map(([c,d]) => ({ category: c, distinct: d.assets.size, total: d.total })).sort((a,b) => b.distinct - a.distinct);

    // Recurring assets
    const assetCounts = new Map();
    rows.forEach(r => { if (hasNeg(r)) { const a = r.AssetTag || r.AssetName || 'Unknown'; assetCounts.set(a, (assetCounts.get(a)||0)+1); } });
    const recurring = Array.from(assetCounts.entries()).filter(([,c]) => c >= 3).sort((a,b) => b[1]-a[1]);

    // Inspectors
    const insp = new Map();
    rows.forEach(r => { const n = r.Inspector || '(Unknown)'; if (!insp.has(n)) insp.set(n, { count: 0, neg: 0 }); insp.get(n).count++; if (hasNeg(r)) insp.get(n).neg++; });
    const inspectors = Array.from(insp.entries()).map(([name,d]) => ({ name, count: d.count, negCount: d.neg })).sort((a,b) => b.count - a.count);

    // Date range
    const dateRange = dates.length ? dates[0] + ' to ' + dates[dates.length-1] : 'N/A';

    return { total, negCount, negPct, totalDistinct, dates, dailyDistinct, cats, recurring, inspectors, dateRange };
  }

  /* ---------- RULE-BASED ANSWER ENGINE ---------- */
  function ruleBasedAnswer(question, ctx) {
    const q = question.toLowerCase();

    // 1. Top recurring / equipment issues
    if (q.match(/top|recur|equipment|issue|problem|most|pareto/)) {
      if (!ctx.cats.length) return 'No equipment with negative findings was found in the current dataset.';
      const top = ctx.cats.slice(0, 5);
      const totalDistinct = ctx.cats.reduce((s,c) => s + c.distinct, 0);
      let ans = 'Based on current dashboard data, here are the top equipment categories by distinct affected assets:\n\n';
      top.forEach((c, i) => {
        const pct = Math.round((c.distinct / totalDistinct) * 100);
        ans += (i+1) + '. **' + c.category + '**: ' + c.distinct + ' distinct assets (' + c.total + ' total inspections) — ' + pct + '% of all issues\n';
      });
      if (ctx.recurring.length) {
        ans += '\nAssets with 3+ repeated findings: ' + ctx.recurring.slice(0,3).map(a => a[0] + ' (' + a[1] + 'x)').join(', ');
      }
      return ans;
    }

    // 2. Why increasing / trend
    if (q.match(/why|increas|trend|going up|spike|wors/)) {
      if (ctx.dates.length < 4) return 'Not enough data to determine trends. Currently ' + ctx.dates.length + ' day(s) of inspection data available (minimum 4 needed).';
      const half = Math.floor(ctx.dates.length / 2);
      const recent = ctx.dailyDistinct.slice(half).reduce((a,b) => a+b, 0);
      const prev = ctx.dailyDistinct.slice(0, half).reduce((a,b) => a+b, 0);
      const change = prev > 0 ? Math.round(((recent - prev) / prev) * 100) : 0;
      let ans = 'Based on current dashboard data comparing recent vs. earlier period:\n\n';
      if (change > 20) {
        ans += 'Distinct negative findings **increased by ' + change + '%** (' + prev + ' → ' + recent + ').\n\nPossible causes:\n- New equipment issues emerged\n- Inspection scope expanded\n- Seasonal or operational changes';
      } else if (change < -20) {
        ans += 'Distinct negative findings **decreased by ' + Math.abs(change) + '%** (' + prev + ' → ' + recent + ').\n\nThis suggests maintenance efforts are having a positive impact.';
      } else {
        ans += 'Distinct negative findings are **relatively stable** (' + change + '% change: ' + prev + ' → ' + recent + ').\n\nNo significant trend detected.';
      }
      ans += '\n\nDate range: ' + ctx.dateRange;
      return ans;
    }

    // 3. Priority assets / what to focus on
    if (q.match(/priority|focus|attention|urgent|what should|recommend|action/)) {
      let ans = 'Based on current dashboard data, here are the priority recommendations:\n\n';
      if (ctx.cats.length > 0) {
        ans += '**1. Equipment to prioritize:** ' + ctx.cats.slice(0, 3).map(c => c.category + ' (' + c.distinct + ' assets)').join(', ') + '\n';
      }
      if (ctx.recurring.length > 0) {
        ans += '**2. Recurring issues:** ' + ctx.recurring.slice(0, 3).map(a => a[0]).join(', ') + ' have 3+ repeated findings each\n';
      }
      if (ctx.negPct >= 10) {
        ans += '**3. Overall negative rate:** ' + ctx.negPct + '% of inspections contain negative findings — above normal threshold\n';
      }
      ans += '\n**Suggested actions:**\n- Review top equipment categories in Pareto chart\n- Schedule follow-up inspections on recurring assets\n- Assign corrective actions with deadlines';
      return ans;
    }

    // 4. Inspector performance
    if (q.match(/inspector|performance|who|conducted/)) {
      if (!ctx.inspectors.length) return 'No inspector data found in the current dataset.';
      let ans = 'Based on current dashboard data, here is the inspector summary:\n\n';
      ctx.inspectors.slice(0, 5).forEach((insp, i) => {
        const pct = insp.count > 0 ? Math.round((insp.negCount / insp.count) * 100) : 0;
        ans += (i+1) + '. **' + insp.name + '**: ' + insp.count + ' inspections, ' + insp.negCount + ' negative (' + pct + '%)\n';
      });
      const totalInsp = ctx.inspectors.length;
      ans += '\nTotal inspectors: ' + totalInsp;
      return ans;
    }

    // 5. Summary / overview
    if (q.match(/summar|overview|status|how is|dashboard|what.*data/)) {
      let ans = '**Dashboard Summary** (based on current data):\n\n';
      ans += '- Total inspections: ' + ctx.total.toLocaleString() + '\n';
      ans += '- Negative findings: ' + ctx.negCount + ' (' + ctx.negPct + '%)\n';
      ans += '- Distinct affected assets: ' + ctx.totalDistinct + '\n';
      ans += '- Equipment categories with issues: ' + ctx.cats.length + '\n';
      ans += '- Inspectors: ' + ctx.inspectors.length + '\n';
      ans += '- Date range: ' + ctx.dateRange + '\n';
      if (ctx.cats.length > 0) {
        ans += '\nTop issue category: ' + ctx.cats[0].category + ' (' + ctx.cats[0].distinct + ' assets)';
      }
      return ans;
    }

    // Default
    return 'Based on current dashboard data:\n\n' +
      '- Total inspections: ' + ctx.total.toLocaleString() + '\n' +
      '- Negative findings: ' + ctx.negCount + ' (' + ctx.negPct + '%)\n' +
      '- Distinct affected assets: ' + ctx.totalDistinct + '\n' +
      '- Equipment categories with issues: ' + ctx.cats.length + '\n' +
      '\nTry asking about: top equipment issues, trends, priority assets, or inspector performance.';
  }

  /* ---------- PHASE 2: AI API ABSTRACTION ---------- */

  /**
   * Ask the AI assistant about dashboard data.
   * Phase 1: Uses rule-based engine.
   * Phase 2: Will route to external AI provider.
   *
   * @param {string} question - User question
   * @param {Array} rows - Dashboard data rows
   * @param {Object} options - Optional: { provider: 'gemini'|'openai'|'claude', apiKey: string }
   * @returns {Promise<{answer: string, source: string}>}
   */
  async function askDashboardAI(question, rows, options) {
    options = options || {};

    // Always try Groq AI first (via backend tRPC), fallback to rule-based
    try {
      var aiResult = await callExternalAI(question, rows, options);
      if (aiResult && aiResult.answer && aiResult.answer.length > 10) {
        return aiResult;
      }
    } catch (e) {
      console.error('[ODM AI] External AI failed, using fallback:', e);
    }

    // Phase 1: Rule-based fallback
    const ctx = buildContext(rows);
    const answer = ruleBasedAnswer(question, ctx);
    return { answer, source: 'rule-based', context: ctx };
  }

  /**
   * Phase 2: External AI via backend tRPC (Groq).
   */
  async function callExternalAI(question, rows, options) {
    // Build rich context from inspection data
    const ctx = buildContext(rows);
    var now = new Date().toISOString().slice(0, 10);
    var overdue = [];
    var criticalItems = [];
    var assetList = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.status === 'Overdue' || r.daysOverdue > 0) overdue.push(r.equipment + ' (' + r.daysOverdue + ' days)');
      if (r.severity === 'Critical' || r.severity === 'High') criticalItems.push(r.equipment + ': ' + r.description);
      if (assetList.indexOf(r.equipment) === -1) assetList.push(r.equipment);
    }
    var contextPrompt = 'You are analyzing an Operator Driven Maintenance (ODM) dashboard for water/wastewater facilities.\n\n' +
      'CURRENT DATE: ' + now + '\n' +
      'TOTAL INSPECTIONS: ' + ctx.total + '\n' +
      'NEGATIVE FINDINGS: ' + ctx.negCount + ' (' + ctx.negPct + '%)\n' +
      'DISTINCT ASSETS: ' + ctx.totalDistinct + '\n' +
      'TOP EQUIPMENT CATEGORIES: ' + ctx.cats.slice(0, 5).map(function (c) { return c.category + '(' + c.distinct + ')'; }).join(', ') + '\n' +
      'DATE RANGE: ' + ctx.dateRange + '\n';
    if (overdue.length) contextPrompt += 'OVERDUE ITEMS (' + overdue.length + '): ' + overdue.slice(0, 10).join(', ') + '\n';
    if (criticalItems.length) contextPrompt += 'CRITICAL/HIGH FINDINGS (' + criticalItems.length + '): ' + criticalItems.slice(0, 5).join('; ') + '\n';
    contextPrompt += 'ASSETS: ' + assetList.slice(0, 15).join(', ') + '\n\n' +
      'INSPECTION SUMMARY BY STATUS:\n';
    // Group by status
    var byStatus = {};
    for (var j = 0; j < rows.length; j++) {
      var st = rows[j].status || 'Unknown';
      if (!byStatus[st]) byStatus[st] = 0;
      byStatus[st]++;
    }
    for (var s in byStatus) contextPrompt += '- ' + s + ': ' + byStatus[s] + '\n';
    contextPrompt += '\nUSER QUESTION: ' + question + '\n';

    try {
      var resp = await fetch('/api/trpc/ai.maintenanceChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { message: contextPrompt } })
      });
      var data = await resp.json();
      var reply = data && data.result && data.result.data && data.result.data.json ? data.result.data.json.reply : null;
      if (reply) {
        return { answer: reply, source: 'Groq AI (Llama 3.3 70B)' };
      }
    } catch (e) {
      console.error('[ODM AI] Groq error:', e);
    }
    // Fallback to rule-based
    return {
      answer: ruleBasedAnswer(question, ctx),
      source: 'rule-based (fallback)'
    };
  }

  /* ---------- UI FUNCTIONS ---------- */

  function openPanel() {
    const panel = document.getElementById('aiPanel');
    const overlay = document.getElementById('aiPanelOverlay');
    if (panel) panel.style.display = 'block';
    if (overlay) overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    const input = document.getElementById('aiQuestionInput');
    if (input) setTimeout(() => input.focus(), 100);
  }

  function closePanel() {
    const panel = document.getElementById('aiPanel');
    const overlay = document.getElementById('aiPanelOverlay');
    if (panel) panel.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  function renderSuggestedChips(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = SUGGESTED_PROMPTS.map(p =>
      '<button class="ai-chip" onclick="AIAssistant.ask(' + JSON.stringify(p).replace(/"/g, '&quot;') + ')" title="' + escHtml(p) + '">' + escHtml(p) + '</button>'
    ).join('');
  }

  function setInput(value) {
    const input = document.getElementById('aiQuestionInput');
    if (input) { input.value = value; input.focus(); }
  }

  async function ask(question) {
    const q = question || document.getElementById('aiQuestionInput').value.trim();
    if (!q) return;

    const responseArea = document.getElementById('aiResponseArea');
    if (!responseArea) return;

    // Show loading
    responseArea.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:12px;color:#5A6B7D;font-size:13px"><div class="ai-loading"></div> Analyzing dashboard data...</div>';
    responseArea.style.display = 'block';

    // Get current data
    const rows = typeof getFilteredRows === 'function' ? getFilteredRows() : [];
    if (!rows || !rows.length) {
      responseArea.innerHTML = '<div style="padding:12px;color:#8BA3B8;font-size:13px">No dashboard data loaded. Import an Excel file or wait for data to load.</div>';
      return;
    }

    // Call engine
    try {
      const result = await askDashboardAI(q, rows);
      const formatted = result.answer
        .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#16324F">$1</strong>')
        .replace(/\n/g, '<br>');
      responseArea.innerHTML =
        '<div style="padding:12px">' +
          '<div style="font-size:10px;color:#8BA3B8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Based on current dashboard data</div>' +
          '<div style="font-size:13px;color:#2D3748;line-height:1.6">' + formatted + '</div>' +
          '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #EDF1F4;font-size:10px;color:#8BA3B8">Source: ' + escHtml(result.source) + ' | ' + rows.length + ' records analyzed</div>' +
        '</div>';
    } catch (err) {
      responseArea.innerHTML = '<div style="padding:12px;color:#DC2626;font-size:13px">Error: ' + escHtml(err.message) + '</div>';
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      AIAssistant.ask();
    }
  }

  function escHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ---------- EXPORT ---------- */
  global.AIAssistant = {
    ask,
    openPanel,
    closePanel,
    renderSuggestedChips,
    setInput,
    askDashboardAI,
    handleKeyDown,
    SUGGESTED_PROMPTS
  };

})(typeof window !== 'undefined' ? window : global);
