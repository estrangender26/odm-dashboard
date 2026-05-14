// Universal AI Engine — Context-aware rule-based analysis for all dashboards
// Analyzes real data, generates insights, answers questions per dashboard type
// Phase 2 ready: structured for external AI API integration

// ─── Types ───
export type DashboardContext =
  | "gantt"
  | "maintenance"
  | "governance"
  | "odm"
  | "kpi"
  | "scorecard";

export interface AIContext {
  type: DashboardContext;
  data: any;
  filters?: Record<string, string>;
  metadata?: Record<string, any>;
}

export interface AIInsight {
  title: string;
  description: string;
  severity: "info" | "warning" | "critical" | "success";
  metric?: string | number;
  recommendation?: string;
}

export interface AIResponse {
  answer: string;
  insights: AIInsight[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  source: string;
  suggestedQuestions?: string[];
}

// ─── Gantt Analysis ───
function analyzeGanttData(tasks: any[]): { insights: AIInsight[]; summary: string; stats: any } {
  if (!tasks || tasks.length === 0) {
    return {
      insights: [{ title: "No data", description: "No Gantt tasks available for analysis.", severity: "info" }],
      summary: "No task data loaded.",
      stats: {},
    };
  }

  const total = tasks.length;
  const completed = tasks.filter((t) => (t.progress || 0) >= 100).length;
  const inProgress = tasks.filter((t) => { const p = t.progress || 0; return p > 0 && p < 100; }).length;
  const notStarted = tasks.filter((t) => (t.progress || 0) === 0).length;

  // Delay analysis
  const delayed = tasks.filter((t) => {
    const aEnd = t.endDate ? new Date(t.endDate) : null;
    const pEnd = t.plannedEnd ? new Date(t.plannedEnd) : null;
    return aEnd && pEnd && aEnd > pEnd && (t.progress || 0) < 100;
  });

  // Overdue (past due, not completed)
  const now = new Date();
  const overdue = tasks.filter((t) => {
    const end = t.endDate ? new Date(t.endDate) : t.plannedEnd ? new Date(t.plannedEnd) : null;
    return end && end < now && (t.progress || 0) < 100;
  });

  // Milestones
  const milestones = tasks.filter((t) => t.type === "milestone");
  const milestonesDone = milestones.filter((t) => (t.progress || 0) >= 100).length;

  // Tasks without dates
  const noDates = tasks.filter((t) => !t.startDate && !t.plannedStart).length;

  // Critical path risk
  const criticalRisk = delayed.filter((t) => {
    const p = t.progress || 0;
    return p > 0 && p < 100;
  });

  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const insights: AIInsight[] = [];

  if (overdue.length > 0) {
    insights.push({
      title: `${overdue.length} Overdue Task${overdue.length > 1 ? "s" : ""}`,
      description: `Tasks past their end date with incomplete status.`,
      severity: "critical",
      metric: overdue.length,
      recommendation: "Review overdue tasks immediately. Consider schedule recovery actions.",
    });
  }

  if (delayed.length > 0) {
    insights.push({
      title: `${delayed.length} Delayed Task${delayed.length > 1 ? "s" : ""}`,
      description: `Actual end dates exceed planned end dates.`,
      severity: "warning",
      metric: delayed.length,
      recommendation: "Investigate root causes. Update schedules or allocate more resources.",
    });
  }

  if (noDates > 0) {
    insights.push({
      title: `${noDates} Task${noDates > 1 ? "s" : ""} Without Dates`,
      description: `Tasks missing start/planned dates cannot be tracked properly.`,
      severity: "warning",
      metric: noDates,
      recommendation: "Assign dates to all tasks for complete schedule visibility.",
    });
  }

  if (completionRate >= 80) {
    insights.push({
      title: "Project Nearly Complete",
      description: `${completionRate}% of tasks are done.`,
      severity: "success",
      metric: `${completionRate}%`,
      recommendation: "Focus on remaining tasks and close-out activities.",
    });
  } else if (completionRate < 20 && total > 5) {
    insights.push({
      title: "Project in Early Phase",
      description: `Only ${completionRate}% complete. ${notStarted} tasks not started.`,
      severity: "info",
      metric: `${completionRate}%`,
      recommendation: "Ensure all prerequisite activities are planned before proceeding.",
    });
  }

  if (milestones.length > 0 && milestonesDone === milestones.length) {
    insights.push({
      title: "All Milestones Achieved",
      description: `${milestonesDone}/${milestones.length} milestones complete.`,
      severity: "success",
      metric: `${milestonesDone}/${milestones.length}`,
    });
  }

  // Summary text
  const summary =
    `${total} tasks: ${completed} completed (${completionRate}%), ${inProgress} in progress, ${notStarted} not started. ` +
    `${overdue.length} overdue, ${delayed.length} delayed. ${milestonesDone}/${milestones.length} milestones done.`;

  return {
    insights,
    summary,
    stats: { total, completed, inProgress, notStarted, overdue: overdue.length, delayed: delayed.length, completionRate, milestones: milestones.length, milestonesDone, noDates, criticalRisk: criticalRisk.length },
  };
}

function ganttAnswer(question: string, ctx: AIContext, analysis: any): AIResponse {
  const q = question.toLowerCase();
  const { stats } = analysis;
  let answer = "";
  const suggested: string[] = [];

  if (q.includes("summar") || q.includes("overview") || q.includes("status")) {
    answer = analysis.summary;
    suggested.push("Which tasks are overdue?", "What is the completion rate?", "Are there any delays?");
  } else if (q.includes("overdue")) {
    const tasks = ctx.data?.filter((t: any) => {
      const end = t.endDate ? new Date(t.endDate) : t.plannedEnd ? new Date(t.plannedEnd) : null;
      return end && end < new Date() && (t.progress || 0) < 100;
    });
    if (!tasks || tasks.length === 0) answer = "No overdue tasks found.";
    else {
      answer = `${tasks.length} overdue task(s): ${tasks.slice(0, 5).map((t: any) => t.text || t.taskName || "Untitled").join(", ")}${tasks.length > 5 ? ` and ${tasks.length - 5} more.` : ""}`;
    }
    suggested.push("Why are they overdue?", "How can we recover the schedule?");
  } else if (q.includes("delay") || q.includes("late")) {
    answer = `${stats.delayed || 0} task(s) have actual dates exceeding planned dates. ${stats.criticalRisk || 0} are critical-path risks.`;
    suggested.push("Which tasks are on the critical path?", "What caused the delays?");
  } else if (q.includes("complete") || q.includes("progress") || q.includes("rate")) {
    answer = `Completion rate is ${stats.completionRate || 0}%. ${stats.completed || 0} of ${stats.total || 0} tasks are done.`;
    suggested.push("When will the project finish?", "What tasks are blocking progress?");
  } else if (q.includes("milestone")) {
    answer = `${stats.milestonesDone || 0} of ${stats.milestones || 0} milestones achieved.`;
    suggested.push("Which milestones are pending?", "What is the next milestone?");
  } else if (q.includes("recommend") || q.includes("what should") || q.includes("next step")) {
    const recs = analysis.insights.filter((i: AIInsight) => i.recommendation).map((i: AIInsight) => i.recommendation);
    answer = recs.length > 0 ? `Recommendations: ${recs.slice(0, 3).join(" ")}` : "Project is on track. No immediate action needed.";
    suggested.push("What are the risks?", "Which tasks need attention?");
  } else if (q.includes("critical path") || q.includes("blocking")) {
    const blocking = ctx.data?.filter((t: any) => (t.progress || 0) > 0 && (t.progress || 0) < 100 && t.plannedEnd && new Date(t.plannedEnd) < new Date(Date.now() + 14 * 86400000));
    if (!blocking || blocking.length === 0) answer = "No critical-path blockers identified in the next 14 days.";
    else answer = `${blocking.length} task(s) due within 14 days and in progress: ${blocking.slice(0, 5).map((t: any) => t.text || "Untitled").join(", ")}`;
  } else if (q.includes("resource") || q.includes("owner") || q.includes("assignee")) {
    const owners = ctx.data?.reduce((acc: Record<string, number>, t: any) => {
      const o = t.owner || "Unassigned";
      acc[o] = (acc[o] || 0) + 1;
      return acc;
    }, {});
    if (!owners || Object.keys(owners).length === 0) answer = "No owner assignments found.";
    else {
      const sorted = Object.entries(owners).sort((a: any, b: any) => b[1] - a[1]);
      answer = `Task distribution by owner: ${sorted.slice(0, 5).map(([name, count]) => `${name}: ${count}`).join(", ")}`;
    }
    suggested.push("Who has the most tasks?", "Is anyone overloaded?");
  } else {
    answer = `${analysis.summary} Ask about: overdue tasks, delays, completion rate, milestones, critical path, or recommendations.`;
    suggested.push("Summarize the schedule", "What tasks are overdue?", "What are the recommendations?");
  }

  return {
    answer,
    insights: analysis.insights,
    confidence: "HIGH",
    source: "gantt-analysis",
    suggestedQuestions: suggested,
  };
}

// ─── Maintenance Analysis ───
function analyzeMaintenanceData(records: any[]): { insights: AIInsight[]; summary: string; stats: any } {
  if (!records || records.length === 0) {
    return {
      insights: [{ title: "No data", description: "No maintenance records available.", severity: "info" }],
      summary: "No maintenance data loaded.",
      stats: {},
    };
  }

  const total = records.length;
  const overdue = records.filter((r) => {
    const status = (r.status || "").toLowerCase();
    const nextDue = r.nextDue ? new Date(r.nextDue) : null;
    return status === "overdue" || (nextDue && nextDue < new Date() && status !== "completed");
  }).length;

  const completed = records.filter((r) => (r.status || "").toLowerCase() === "completed").length;
  const inProgress = records.filter((r) => (r.status || "").toLowerCase() === "in progress").length;

  // By frequency
  const freqDist = records.reduce((acc: Record<string, number>, r) => {
    const f = r.frequency || "Unknown";
    acc[f] = (acc[f] || 0) + 1;
    return acc;
  }, {});

  // By equipment type
  const equipDist = records.reduce((acc: Record<string, number>, r) => {
    const e = r.equipmentType || "Unknown";
    acc[e] = (acc[e] || 0) + 1;
    return acc;
  }, {});

  // By implementor
  const implDist = records.reduce((acc: Record<string, number>, r) => {
    const i = r.implementor || "Unassigned";
    acc[i] = (acc[i] || 0) + 1;
    return acc;
  }, {});

  // Plants
  const plantDist = records.reduce((acc: Record<string, number>, r) => {
    const p = r.plant || "Unknown";
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const insights: AIInsight[] = [];

  if (overdue > 0) {
    insights.push({
      title: `${overdue} Overdue PM Task${overdue > 1 ? "s" : ""}`,
      description: `Maintenance activities past their due date.`,
      severity: "critical",
      metric: overdue,
      recommendation: "Execute overdue PMs immediately. Reschedule to prevent equipment degradation.",
    });
  }

  if (completionRate < 50 && total > 10) {
    insights.push({
      title: "Low PM Completion Rate",
      description: `Only ${completionRate}% of maintenance tasks are completed.`,
      severity: "warning",
      metric: `${completionRate}%`,
      recommendation: "Review backlog. Consider increasing maintenance crew or prioritizing critical equipment.",
    });
  }

  const dailyCount = (freqDist["Daily"] || 0) + (freqDist["daily"] || 0);
  if (dailyCount > 50) {
    insights.push({
      title: "High Daily PM Volume",
      description: `${dailyCount} daily recurring tasks across all facilities.`,
      severity: "info",
      metric: dailyCount,
      recommendation: "Consider automating daily checks where possible via SCADA or checklists.",
    });
  }

  if (Object.keys(plantDist).length > 5) {
    insights.push({
      title: `${Object.keys(plantDist).length} Facilities Tracked`,
      description: `Multi-facility maintenance program with ${total} total PM activities.`,
      severity: "info",
      metric: Object.keys(plantDist).length,
    });
  }

  const summary = `${total} PM records: ${completed} completed (${completionRate}%), ${inProgress} in progress, ${overdue} overdue. ${Object.keys(plantDist).length} facilities, ${Object.keys(equipDist).length} equipment types.`;

  return { insights, summary, stats: { total, completed, inProgress, overdue, completionRate, freqDist, equipDist, implDist, plantDist: Object.keys(plantDist).length } };
}

function maintenanceAnswer(question: string, ctx: AIContext, analysis: any): AIResponse {
  const q = question.toLowerCase();
  const { stats } = analysis;
  let answer = "";
  const suggested: string[] = [];

  if (q.includes("summar") || q.includes("overview") || q.includes("status")) {
    answer = analysis.summary;
    suggested.push("What is overdue?", "Which equipment needs attention?", "How is completion?");
  } else if (q.includes("overdue")) {
    const overdue = ctx.data?.filter((r: any) => {
      const status = (r.status || "").toLowerCase();
      const nextDue = r.nextDue ? new Date(r.nextDue) : null;
      return status === "overdue" || (nextDue && nextDue < new Date() && status !== "completed");
    });
    if (!overdue || overdue.length === 0) answer = "No overdue maintenance tasks.";
    else {
      const byEquip = overdue.reduce((acc: Record<string, number>, r: any) => {
        const e = r.equipmentType || "Unknown";
        acc[e] = (acc[e] || 0) + 1;
        return acc;
      }, {});
      answer = `${overdue.length} overdue task(s). Top equipment types: ${Object.entries(byEquip).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([e, c]) => `${e}: ${c}`).join(", ")}`;
    }
  } else if (q.includes("equipment") || q.includes("asset")) {
    const equip = stats.equipDist || {};
    const sorted = Object.entries(equip).sort((a: any, b: any) => b[1] - a[1]);
    answer = sorted.length > 0 ? `Equipment breakdown: ${sorted.slice(0, 5).map(([e, c]) => `${e}: ${c}`).join(", ")}` : "No equipment data.";
    suggested.push("Which equipment has the most PMs?", "What equipment is overdue?");
  } else if (q.includes("frequency") || q.includes("schedule")) {
    const freq = stats.freqDist || {};
    answer = `Frequency distribution: ${Object.entries(freq).map(([f, c]) => `${f}: ${c}`).join(", ")}`;
  } else if (q.includes("complete") || q.includes("progress")) {
    answer = `PM completion rate: ${stats.completionRate || 0}%. ${stats.completed || 0} of ${stats.total || 0} tasks completed.`;
    suggested.push("What is overdue?", "Which tasks are in progress?");
  } else if (q.includes("recommend") || q.includes("what should") || q.includes("priority")) {
    const recs = analysis.insights.filter((i: AIInsight) => i.recommendation).map((i: AIInsight) => i.recommendation);
    answer = recs.length > 0 ? `Priority actions: ${recs.slice(0, 3).join(" ")}` : "All PMs are on track.";
    suggested.push("What is overdue?", "Which equipment needs attention?");
  } else if (q.includes("compliance") || q.includes("regulat")) {
    const overdue = stats.overdue || 0;
    answer = overdue > 0
      ? `${overdue} overdue PM tasks represent a compliance risk. SLA and regulatory requirements may not be met.`
      : "No overdue items. PM compliance is current.";
  } else {
    answer = `${analysis.summary} Ask about: overdue tasks, equipment breakdown, frequencies, compliance, or recommendations.`;
    suggested.push("Summarize maintenance status", "What is overdue?", "Give me recommendations");
  }

  return { answer, insights: analysis.insights, confidence: "HIGH", source: "maintenance-analysis", suggestedQuestions: suggested };
}

// ─── ODM Analysis ───
function analyzeODMData(records: any[]): { insights: AIInsight[]; summary: string; stats: any } {
  if (!records || records.length === 0) {
    return {
      insights: [{ title: "No data", description: "No inspection records available.", severity: "info" }],
      summary: "No ODM data loaded.",
      stats: {},
    };
  }

  const total = records.length;

  // Negative findings analysis
  const negKw = ["leak", "loose", "vibration", "vibrating", "noisy", "noise", "abnormal", "hot", "overheat", "overheating", "smoke", "blocked", "jammed", "misaligned", "worn", "crack", "damage", "fail", "alarm", "not ok", "not_ok", "ng", "no good", "defect", "fault", "error", "critical", "urgent", "repair", "replace", "broken"];
  const hasNeg = (r: any) => {
    const text = String(r.EntryNotes || r.entryNotes || r.remarks || "").toLowerCase();
    return negKw.some((k) => text.includes(k));
  };

  const negCount = records.filter(hasNeg).length;
  const negPct = total > 0 ? Math.round((negCount / total) * 100) : 0;

  // Equipment type breakdown
  const equipDist = records.reduce((acc: Record<string, number>, r) => {
    const e = r.EquipmentType || r.equipmentType || "Unknown";
    acc[e] = (acc[e] || 0) + 1;
    return acc;
  }, {});

  // Inspector breakdown
  const inspectorDist = records.reduce((acc: Record<string, number>, r) => {
    const i = r.Inspector || r.inspector || "Unknown";
    acc[i] = (acc[i] || 0) + 1;
    return acc;
  }, {});

  // Recurring issues
  const assetIssues = records.filter(hasNeg).reduce((acc: Record<string, number>, r) => {
    const a = r.AssetTag || r.assetTag || r.AssetName || r.assetName || "Unknown";
    acc[a] = (acc[a] || 0) + 1;
    return acc;
  }, {});
  const recurring = Object.entries(assetIssues).filter(([, c]) => (c as number) >= 3);

  const insights: AIInsight[] = [];

  if (negPct >= 15) {
    insights.push({
      title: "High Negative Finding Rate",
      description: `${negPct}% of inspections contain negative findings — above normal threshold.`,
      severity: "critical",
      metric: `${negPct}%`,
      recommendation: "Review top equipment categories. Schedule corrective maintenance on recurring issues.",
    });
  } else if (negPct >= 8) {
    insights.push({
      title: "Elevated Findings",
      description: `${negPct}% negative finding rate.`,
      severity: "warning",
      metric: `${negPct}%`,
    });
  }

  if (recurring.length > 0) {
    insights.push({
      title: `${recurring.length} Recurring Issue Asset${recurring.length > 1 ? "s" : ""}`,
      description: `Assets with 3+ repeated negative findings.`,
      severity: "warning",
      metric: recurring.length,
      recommendation: "Schedule dedicated maintenance on recurring assets. Consider replacement if issues persist.",
    });
  }

  if (total > 100) {
    insights.push({
      title: `${total} Inspections Recorded`,
      description: `Large dataset provides reliable trend analysis.`,
      severity: "info",
      metric: total,
    });
  }

  const summary = `${total} inspections: ${negCount} negative findings (${negPct}%). ${Object.keys(equipDist).length} equipment types inspected by ${Object.keys(inspectorDist).length} inspector(s). ${recurring.length} recurring issue assets.`;

  return { insights, summary, stats: { total, negCount, negPct, equipDist, inspectorDist, recurring: recurring.length } };
}

function odmAnswer(question: string, ctx: AIContext, analysis: any): AIResponse {
  const q = question.toLowerCase();
  let answer = "";
  const suggested: string[] = [];

  if (q.includes("summar") || q.includes("overview")) {
    answer = analysis.summary;
    suggested.push("What are the top issues?", "Which assets are problematic?", "Show inspector performance");
  } else if (q.includes("negative") || q.includes("finding") || q.includes("issue")) {
    answer = `${analysis.stats.negCount || 0} negative findings (${analysis.stats.negPct || 0}% of ${analysis.stats.total || 0} inspections).`;
    suggested.push("What equipment has the most issues?", "Which assets are recurring?");
  } else if (q.includes("equipment") || q.includes("top")) {
    const equip = analysis.stats.equipDist || {};
    const sorted = Object.entries(equip).sort((a: any, b: any) => b[1] - a[1]);
    answer = sorted.length > 0 ? `Top equipment types: ${sorted.slice(0, 5).map(([e, c]) => `${e}: ${c}`).join(", ")}` : "No equipment data.";
  } else if (q.includes("inspector") || q.includes("who")) {
    const inspectors = analysis.stats.inspectorDist || {};
    answer = `Inspectors: ${Object.entries(inspectors).map(([i, c]) => `${i}: ${c}`).join(", ")}`;
  } else if (q.includes("recurring") || q.includes("repeat")) {
    answer = `${analysis.stats.recurring || 0} assets have 3+ repeated negative findings.`;
    suggested.push("Which assets are they?", "What should we do about them?");
  } else if (q.includes("recommend") || q.includes("what should") || q.includes("action")) {
    const recs = analysis.insights.filter((i: AIInsight) => i.recommendation).map((i: AIInsight) => i.recommendation);
    answer = recs.length > 0 ? `Actions: ${recs.slice(0, 3).join(" ")}` : "Operations are within normal parameters.";
  } else if (q.includes("trend") || q.includes("going") || q.includes("increas")) {
    answer = `Current negative finding rate is ${analysis.stats.negPct || 0}%. ${analysis.stats.negPct > 10 ? "This is above the normal threshold — investigate causes." : "Within normal range."}`;
  } else {
    answer = `${analysis.summary} Ask about: negative findings, equipment issues, recurring assets, inspector performance, or trends.`;
    suggested.push("Summarize the data", "What are the top issues?", "What should we focus on?");
  }

  return { answer, insights: analysis.insights, confidence: "HIGH", source: "odm-analysis", suggestedQuestions: suggested };
}

// ─── Finding Analysis (ODM Deep-Dive) ───
function analyzeFindingData(records: any[]): { insights: AIInsight[]; summary: string; stats: any } {
  if (!records || records.length === 0) {
    return { insights: [{ title: "No data", description: "No inspection findings available.", severity: "info" }], summary: "No inspection data loaded.", stats: {} };
  }

  const total = records.length;

  // Severity classification from findings text
  const severityKw = { critical: ["critical", "urgent", "emergency", "shutdown", "catastrophic", "danger"], warning: ["leak", "vibration", "loose", "worn", "hot", "overheat", "abnormal", "noisy", "corrosion", "misaligned"], info: ["check", "inspect", "monitor", "clean", "lubricate", "adjust"] };
  const classifySeverity = (r: any) => {
    const text = String(r.EntryNotes || r.entryNotes || r.findings || r.Finding || "").toLowerCase();
    const action = String(r.Action || r.action || r.Recommendation || "").toLowerCase();
    const combined = text + " " + action;
    if (severityKw.critical.some(k => combined.includes(k))) return "critical";
    if (severityKw.warning.some(k => combined.includes(k))) return "warning";
    return "info";
  };

  const sevCounts = { critical: 0, warning: 0, info: 0 };
  records.forEach(r => { sevCounts[classifySeverity(r) as keyof typeof sevCounts]++; });

  // Equipment type distribution
  const equipDist = records.reduce((acc: Record<string, number>, r) => {
    const e = r.EquipmentType || r.equipmentType || r.equipment || "Unknown";
    acc[e] = (acc[e] || 0) + 1;
    return acc;
  }, {});

  // Asset-level negative finding count
  const assetIssues = records.reduce((acc: Record<string, { count: number; severity: string; notes: string[] }>, r) => {
    const a = r.AssetTag || r.assetTag || r.AssetName || r.assetName || "Unknown";
    const sev = classifySeverity(r);
    if (!acc[a]) acc[a] = { count: 0, severity: sev, notes: [] };
    acc[a].count++;
    const note = String(r.EntryNotes || r.entryNotes || r.findings || "").trim();
    if (note) acc[a].notes.push(note);
    if (sev === "critical" || (sev === "warning" && acc[a].severity !== "critical")) acc[a].severity = sev;
    return acc;
  }, {});

  const criticalAssets = Object.entries(assetIssues).filter(([, v]) => (v as any).severity === "critical");
  const warningAssets = Object.entries(assetIssues).filter(([, v]) => (v as any).severity === "warning");

  // Service provider need detection
  const svcKw = ["pump", "motor", "blower", "calibration", "electrical", "scada", "instrument", "valve", "transformer", "generator"];
  const needsVendor = records.filter(r => {
    const text = String(r.EquipmentType || r.equipmentType || r.EntryNotes || "").toLowerCase();
    return svcKw.some(k => text.includes(k));
  });

  // Possible CM-to-PM conversions
  const cmIndicators = ["replace", "repair", "overhaul", "rewind", "rebuild", "remediate", "corrective"];
  const cmCandidates = records.filter(r => {
    const text = String(r.Action || r.action || r.EntryNotes || "").toLowerCase();
    return cmIndicators.some(k => text.includes(k));
  });

  const insights: AIInsight[] = [];

  if (sevCounts.critical > 0) {
    insights.push({
      title: `${sevCounts.critical} Critical Finding${sevCounts.critical > 1 ? "s" : ""}`,
      description: `Inspection findings requiring immediate action.`,
      severity: "critical", metric: sevCounts.critical,
      recommendation: "Escalate to operations immediately. Schedule emergency inspection or shutdown if safety-critical.",
    });
  }
  if (sevCounts.warning > 0) {
    insights.push({
      title: `${sevCounts.warning} Warning Finding${sevCounts.warning > 1 ? "s" : ""}`,
      description: `Degradation indicators that may lead to failure.`,
      severity: "warning", metric: sevCounts.warning,
      recommendation: "Schedule corrective maintenance within 7 days. Monitor trend.",
    });
  }
  if (criticalAssets.length > 0) {
    insights.push({
      title: `${criticalAssets.length} Asset${criticalAssets.length > 1 ? "s" : ""} with Critical Findings`,
      description: `Assets with repeated or severe negative findings.`,
      severity: "critical", metric: criticalAssets.length,
      recommendation: "Prepare scope of work for external vendor. Initiate procurement for specialist services.",
    });
  }
  if (needsVendor.length > 0) {
    insights.push({
      title: `${needsVendor.length} Finding${needsVendor.length > 1 ? "s" : ""} May Need Vendor Support`,
      description: `Equipment types typically requiring specialist contractors.`,
      severity: "warning", metric: needsVendor.length,
      recommendation: "Generate draft scope of work. Identify vendor category (pump overhaul, motor rewinding, calibration, etc.).",
    });
  }
  if (cmCandidates.length > 0) {
    insights.push({
      title: `${cmCandidates.length} Potential Corrective Maintenance`,
      description: `Findings that may require CM work orders.`,
      severity: "info", metric: cmCandidates.length,
      recommendation: "Convert to PM or CM work orders. Prepare SAP fields (functional location, equipment number, cost center).",
    });
  }

  const summary = `${total} findings: ${sevCounts.critical} critical, ${sevCounts.warning} warning, ${sevCounts.info} info. ${criticalAssets.length} critical assets. ${needsVendor.length} may need vendors. ${cmCandidates.length} CM candidates.`;

  return { insights, summary, stats: { total, sevCounts, equipDist, criticalAssets: criticalAssets.length, warningAssets: warningAssets.length, needsVendor: needsVendor.length, cmCandidates: cmCandidates.length, assetIssues } };
}

function findingAnswer(question: string, ctx: AIContext, analysis: any): AIResponse {
  const q = question.toLowerCase();
  let answer = "";
  const suggested: string[] = [];
  const stats = analysis.stats || {};

  if (q.includes("critical") || q.includes("severity")) {
    answer = `${stats.sevCounts?.critical || 0} critical findings requiring immediate action. ${stats.sevCounts?.warning || 0} warning findings need attention within 7 days.`;
    suggested.push("Which assets are critical?", "What actions are needed?");
  } else if (q.includes("vendor") || q.includes("service") || q.includes("scope")) {
    answer = `${stats.needsVendor || 0} findings may require external vendor support. Common categories: pump overhaul, motor rewinding, calibration, electrical testing, SCADA troubleshooting.`;
    suggested.push("Generate scope of work", "Which findings need vendors?");
  } else if (q.includes("sap") || q.includes("cost center") || q.includes("functional location") || q.includes("wbs")) {
    answer = `For SAP readiness: ensure Functional Location, Equipment Number, Maintenance Order, Cost Center, and GL Account are assigned. ${stats.cmCandidates || 0} findings may need CM work orders. Prepare PR/PO references for vendor services.`;
    suggested.push("Which findings need SAP fields?", "Generate SAP readiness summary");
  } else if (q.includes("cm") || q.includes("corrective") || q.includes("maintenance")) {
    answer = `${stats.cmCandidates || 0} findings suggest corrective maintenance may be needed. Review each for PM-to-CM conversion eligibility.`;
    suggested.push("Prioritize findings by severity", "Which findings are most urgent?");
  } else if (q.includes("asset") || q.includes("equipment")) {
    const equip = stats.equipDist || {};
    const sorted = Object.entries(equip).sort((a: any, b: any) => b[1] - a[1]);
    answer = sorted.length > 0 ? `Equipment with findings: ${sorted.slice(0, 5).map(([e, c]) => `${e}: ${c}`).join(", ")}` : "No equipment data.";
  } else if (q.includes("prior") || q.includes("urgent")) {
    answer = `Priority order: 1) ${stats.sevCounts?.critical || 0} critical findings (immediate), 2) ${stats.sevCounts?.warning || 0} warning findings (within 7 days), 3) Vendor support items (${stats.needsVendor || 0}), 4) CM candidates (${stats.cmCandidates || 0}).`;
  } else if (q.includes("summar") || q.includes("overview")) {
    answer = analysis.summary;
    suggested.push("Which findings are critical?", "Which need vendor support?", "What SAP fields are needed?");
  } else {
    answer = `${analysis.summary} Ask about: critical findings, vendor support, SAP readiness, corrective maintenance, asset breakdown, or prioritization.`;
    suggested.push("Summarize critical findings", "Which findings need vendor support?", "Generate scope of work");
  }

  return { answer, insights: analysis.insights, confidence: "HIGH", source: "finding-analysis", suggestedQuestions: suggested };
}

// ─── KPI / Scorecard Analysis ───
function analyzeScorecardData(kpis: any[]): { insights: AIInsight[]; summary: string; stats: any } {
  if (!kpis || kpis.length === 0) {
    return {
      insights: [{ title: "No data", description: "No KPI data available.", severity: "info" }],
      summary: "No KPI data loaded.",
      stats: {},
    };
  }

  const insights: AIInsight[] = [];

  // Count by status
  const green = kpis.filter((k) => (k.status || "").toLowerCase() === "green" || (k.status || "").toLowerCase() === "met").length;
  const yellow = kpis.filter((k) => (k.status || "").toLowerCase() === "yellow" || (k.status || "").toLowerCase() === "at risk").length;
  const red = kpis.filter((k) => (k.status || "").toLowerCase() === "red" || (k.status || "").toLowerCase() === "not met").length;
  const total = kpis.length;

  if (red > 0) {
    insights.push({
      title: `${red} KPI${red > 1 ? "s" : ""} Not Met`,
      description: `Critical performance indicators below target.`,
      severity: "critical",
      metric: red,
      recommendation: "Develop recovery plans for red KPIs. Escalate to management.",
    });
  }

  if (yellow > 0) {
    insights.push({
      title: `${yellow} KPI${yellow > 1 ? "s" : ""} At Risk`,
      description: `Performance indicators approaching limits.`,
      severity: "warning",
      metric: yellow,
      recommendation: "Monitor closely and implement preventive actions.",
    });
  }

  if (green === total && total > 0) {
    insights.push({
      title: "All KPIs Met",
      description: `${total} of ${total} performance indicators at target.`,
      severity: "success",
      metric: `${green}/${total}`,
    });
  }

  const complianceRate = total > 0 ? Math.round((green / total) * 100) : 0;
  const summary = `${total} KPIs: ${green} met (${complianceRate}%), ${yellow} at risk, ${red} not met.`;

  return { insights, summary, stats: { total, green, yellow, red, complianceRate } };
}

function scorecardAnswer(question: string, ctx: AIContext, analysis: any): AIResponse {
  const q = question.toLowerCase();
  let answer = "";
  const suggested: string[] = [];

  if (q.includes("summar") || q.includes("overview")) {
    answer = analysis.summary;
    suggested.push("Which KPIs are red?", "What is the compliance rate?");
  } else if (q.includes("red") || q.includes("not met")) {
    answer = `${analysis.stats.red || 0} KPI(s) not met.`;
    suggested.push("Which KPIs are red?", "Why are they red?");
  } else if (q.includes("yellow") || q.includes("at risk")) {
    answer = `${analysis.stats.yellow || 0} KPI(s) at risk.`;
  } else if (q.includes("compliance") || q.includes("rate")) {
    answer = `Compliance rate: ${analysis.stats.complianceRate || 0}% (${analysis.stats.green || 0}/${analysis.stats.total || 0}).`;
  } else if (q.includes("benchmark")) {
    answer = `Current performance: ${analysis.stats.complianceRate || 0}% of KPIs at target. ${analysis.stats.red > 0 ? "Below 100% due to " + analysis.stats.red + " non-compliant indicator(s)." : ""}`;
  } else if (q.includes("trend") || q.includes("improv")) {
    answer = `Current compliance: ${analysis.stats.complianceRate || 0}%. ${analysis.stats.red > 0 ? "Focus on recovering red KPIs to improve." : "Maintain current performance levels."}`;
  } else {
    answer = `${analysis.summary} Ask about: red/yellow KPIs, compliance rate, benchmarks, or trends.`;
    suggested.push("Summarize KPI status", "Which KPIs need attention?", "What is the compliance rate?");
  }

  return { answer, insights: analysis.insights, confidence: "HIGH", source: "scorecard-analysis", suggestedQuestions: suggested };
}

// ─── Governance Analysis ───
function analyzeGovernanceData(data: any): { insights: AIInsight[]; summary: string; stats: any } {
  // Handle pre-computed insights object (from governance-ai.ts)
  if (data && data.milestoneAnalysis) {
    const ma = data.milestoneAnalysis || [];
    const completed = ma.filter((m: any) => m.completed).length;
    const total = ma.length;
    const readiness = data.overallReadiness || 0;
    const gaps = data.gaps || [];

    const insights: AIInsight[] = [];

    if (gaps.length > 0) {
      insights.push({
        title: `${gaps.length} Governance Gap${gaps.length > 1 ? "s" : ""}`,
        description: `Milestones missing dates, uploads, or completion tracking.`,
        severity: "warning",
        metric: gaps.length,
        recommendation: "Address gaps in priority order: PPP date → missing completion dates → uploads.",
      });
    }

    if (!data.hasPPP) {
      insights.push({
        title: "PPP Date Not Set",
        description: `The PPP start date drives all milestone schedules.`,
        severity: "critical",
        recommendation: "Set the PPP Start Date for M1 immediately to activate the schedule.",
      });
    }

    if (readiness < 30 && total > 0) {
      insights.push({
        title: "Low Readiness Score",
        description: `Only ${readiness}% ready for turnover.`,
        severity: "critical",
        metric: `${readiness}%`,
        recommendation: "Accelerate milestone completion. Focus on date-setting and document uploads.",
      });
    }

    if (readiness >= 80) {
      insights.push({
        title: "High Readiness",
        description: `${readiness}% ready for turnover.`,
        severity: "success",
        metric: `${readiness}%`,
        recommendation: "Complete remaining deliverables and prepare for final acceptance.",
      });
    }

    const summary = `${completed}/${total} milestones complete. Readiness: ${readiness}%. PPP: ${data.hasPPP ? "SET" : "NOT SET"}. ${gaps.length} gaps. ${data.riskLevel} risk.`;
    return { insights, summary, stats: { completed, total, readiness, hasPPP: data.hasPPP, gaps: gaps.length, riskLevel: data.riskLevel } };
  }

  // Handle raw milestone state + uploads arrays (from React component)
  const msArr = Array.isArray(data) ? data : (data?.milestoneState || data?.ms || []);
  const upArr = data?.uploads || data?.up || [];

  if (!msArr || msArr.length === 0) {
    return {
      insights: [{ title: "No data", description: "No governance data available.", severity: "info" }],
      summary: "No governance data loaded.",
      stats: {},
    };
  }

  // Compute from raw state
  const completed = msArr.filter((m: any) => m.completed || m.done).length;
  const total = msArr.length;
  const hasPPP = msArr.some((m: any) => m.pppDate || m.pp);
  const hasCompDates = msArr.filter((m: any) => m.completionDate || m.compDate).length;
  const noDates = msArr.filter((m: any) => !m.completionDate && !m.compDate && !m.pppDate && !m.pp && !(m.completed || m.done)).length;
  const uploadCount = Array.isArray(upArr) ? upArr.length : 0;
  const readiness = total > 0 ? Math.round((completed / total) * 100) : 0;
  const riskLevel = readiness >= 80 ? "LOW" : readiness >= 50 ? "MEDIUM" : readiness >= 20 ? "HIGH" : "CRITICAL";

  const insights: AIInsight[] = [];

  if (!hasPPP) {
    insights.push({
      title: "PPP Date Not Set",
      description: "The PPP start date drives all milestone schedules.",
      severity: "critical",
      recommendation: "Set the PPP Start Date for M1 immediately to activate the schedule.",
    });
  }

  if (noDates > 0) {
    insights.push({
      title: `${noDates} Milestone${noDates > 1 ? "s" : ""} Without Dates`,
      description: "Milestones missing target/completion dates.",
      severity: "warning",
      metric: noDates,
      recommendation: "Set dates for all milestones to enable schedule tracking.",
    });
  }

  if (uploadCount === 0 && total > 0) {
    insights.push({
      title: "No Documents Uploaded",
      description: "Upload TOC deliverables to track document completeness.",
      severity: "warning",
      recommendation: "Start uploading TOC section documents per milestone.",
    });
  }

  if (readiness >= 80) {
    insights.push({
      title: "High Readiness",
      description: `${readiness}% ready for turnover.`,
      severity: "success",
      metric: `${readiness}%`,
    });
  } else if (readiness < 30 && total > 0) {
    insights.push({
      title: "Low Readiness Score",
      description: `Only ${readiness}% ready for turnover.`,
      severity: "critical",
      metric: `${readiness}%`,
      recommendation: "Accelerate milestone completion. Focus on date-setting and uploads.",
    });
  }

  const summary = `${completed}/${total} milestones complete (${readiness}%). PPP: ${hasPPP ? "SET" : "NOT SET"}. ${hasCompDates} with dates, ${noDates} without. ${uploadCount} uploads. ${riskLevel} risk.`;

  return {
    insights,
    summary,
    stats: { completed, total, readiness, hasPPP, noDates, uploadCount, riskLevel, hasCompDates },
  };
}

function governanceAnswer(question: string, ctx: AIContext, analysis: any): AIResponse {
  const q = question.toLowerCase();
  let answer = "";
  const suggested: string[] = [];
  const stats = analysis.stats || {};

  if (q.includes("summar") || q.includes("overview")) {
    answer = analysis.summary;
    suggested.push("What is the readiness score?", "What are the gaps?", "What are the recommendations?");
  } else if (q.includes("readiness")) {
    answer = `Readiness: ${stats.readiness || 0}%. ${stats.readiness >= 80 ? "Ready for turnover." : stats.readiness >= 50 ? "Moderate readiness — continue progress." : "Low readiness — significant work needed."}`;
  } else if (q.includes("gap")) {
    const noDates = stats.noDates || stats.gaps || 0;
    answer = noDates > 0 ? `${noDates} governance gap(s) identified. ${!stats.hasPPP ? "Critical: PPP date not set." : ""}` : "No critical gaps identified.";
  } else if (q.includes("ppp")) {
    answer = stats.hasPPP ? "PPP date is set." : "PPP date NOT SET — this is critical for all milestone scheduling.";
  } else if (q.includes("milestone")) {
    answer = `${stats.completed || 0} of ${stats.total || 0} milestones complete.`;
  } else if (q.includes("risk")) {
    answer = `Risk level: ${stats.riskLevel || "UNKNOWN"}. Readiness: ${stats.readiness || 0}%.`;
  } else if (q.includes("upload") || q.includes("document")) {
    answer = stats.uploadCount !== undefined ? `${stats.uploadCount} document(s) uploaded.` : "Upload data not available.";
    suggested.push("What is missing?", "What should I upload?");
  } else if (q.includes("recommend")) {
    const recs = analysis.insights.filter((i: AIInsight) => i.recommendation).map((i: AIInsight) => i.recommendation);
    answer = recs.length > 0 ? recs.slice(0, 3).join(" ") : "All items are on track.";
  } else {
    answer = `${analysis.summary} Ask about: readiness, gaps, PPP, milestones, risk, uploads, or recommendations.`;
    suggested.push("Summarize governance status", "What is the readiness score?", "What are the gaps?");
  }

  return { answer, insights: analysis.insights, confidence: "HIGH", source: "governance-analysis", suggestedQuestions: suggested };
}

// ─── Main Router ───
export function analyze(context: AIContext): { insights: AIInsight[]; summary: string; stats: any } {
  switch (context.type) {
    case "gantt":
      return analyzeGanttData(context.data || []);
    case "maintenance":
      return analyzeMaintenanceData(context.data || []);
    case "odm":
      return analyzeODMData(context.data || []);
    case "finding":
      return analyzeFindingData(context.data || []);
    case "kpi":
    case "scorecard":
      return analyzeScorecardData(context.data || []);
    case "governance":
      return analyzeGovernanceData(context.data);
    default:
      return { insights: [{ title: "Unknown context", description: `Dashboard type "${context.type}" not recognized.`, severity: "info" }], summary: "Unknown dashboard type.", stats: {} };
  }
}

export function ask(context: AIContext, question: string): AIResponse {
  const analysis = analyze(context);

  switch (context.type) {
    case "gantt":
      return ganttAnswer(question, context, analysis);
    case "maintenance":
      return maintenanceAnswer(question, context, analysis);
    case "odm":
      return odmAnswer(question, context, analysis);
    case "finding":
      return findingAnswer(question, context, analysis);
    case "kpi":
    case "scorecard":
      return scorecardAnswer(question, context, analysis);
    case "governance":
      return governanceAnswer(question, context, analysis);
    default:
      return { answer: "I don't have analysis for this dashboard type yet.", insights: [], confidence: "LOW", source: "fallback" };
  }
}

// ─── Suggested prompts per dashboard type ───
export function getSuggestedPrompts(type: DashboardContext): string[] {
  switch (type) {
    case "gantt":
      return ["Summarize the schedule", "What tasks are overdue?", "What is the completion rate?", "Are there any delays?", "What are the recommendations?"];
    case "maintenance":
      return ["Summarize maintenance status", "What is overdue?", "Which equipment needs attention?", "What is the completion rate?", "Give me recommendations"];
    case "odm":
      return ["Summarize the data", "What are the top issues?", "Which assets are recurring?", "Show inspector performance", "What should we focus on?"];
    case "finding":
      return ["Summarize critical findings", "Which findings need vendor support?", "Generate scope of work for this finding", "What SAP fields are needed?", "Which findings may become corrective maintenance?", "Prioritize findings by severity"];
    case "governance":
      return ["Summarize governance status", "What is the readiness score?", "What are the gaps?", "Is PPP date set?", "What are the recommendations?"];
    case "kpi":
    case "scorecard":
      return ["Summarize KPI status", "Which KPIs need attention?", "What is the compliance rate?", "What is the trend?"];
    default:
      return ["Summarize", "What are the issues?", "What should I focus on?"];
  }
}

// ─── Phase 2: External AI stub ───
export async function askExternalAI(question: string, context: AIContext, options?: { provider?: string; apiKey?: string }): Promise<AIResponse> {
  if (options?.provider && options?.apiKey) {
    // Future: call OpenAI, Gemini, etc.
    const local = ask(context, question);
    return { ...local, answer: `[AI+${options.provider}] ${local.answer}`, source: `hybrid:${options.provider}` };
  }
  return ask(context, question);
}

export type { AIContext, AIInsight, AIResponse, DashboardContext };
