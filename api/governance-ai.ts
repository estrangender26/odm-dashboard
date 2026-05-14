// O&M Governance AI Engine — Rule-based analysis of real dashboard data
// Processes actual milestone states, PPP dates, completion dates, uploads
// to generate insights, recommendations, and answer governance questions

export interface MilestoneDef {
  n: string; // name
  o: number; // month offset from PPP
  ph: string; // phase id
  pct: number; // custom percentage
}

export interface MilestoneState {
  done: boolean;
  compDate?: string;
  pppDate?: string;
  customPct?: number;
}

export interface FacilityState {
  pp: string; // PPP start date
  ms: Record<string, MilestoneState>;
  up: Record<string, string[]>; // uploads per milestone
}

export interface TOCItem {
  it: string;
  [milestoneId: string]: string;
}

// Milestone definitions (must match governance.html)
const MS_DEF: Record<string, MilestoneDef> = {
  M1: { n: "T&C Check Sheets Complete", o: -6, ph: "p1", pct: 0 },
  M2: { n: "Wet Commissioning Passed", o: -4, ph: "p1", pct: 0 },
  M3: { n: "Defects/Punchlist Closed", o: -1, ph: "p1", pct: 0 },
  M4: { n: "O&M Manuals Submitted", o: 2, ph: "p2", pct: 0 },
  M5: { n: "SOPs/SMPs Approved", o: 5, ph: "p2", pct: 0 },
  M6: { n: "Training Completed", o: 8, ph: "p2", pct: 0 },
  M7: { n: "Pre-TO Inspection", o: 12, ph: "p3", pct: 0 },
  M8: { n: "Commissioning Sign-off", o: 16, ph: "p3", pct: 0 },
  M9: { n: "Final Turnover", o: 20, ph: "p3", pct: 0 },
};

const PHASES: Record<string, { l: string; m: string[] }> = {
  p1: { l: "PRE-PPP", m: ["M1", "M2", "M3"] },
  p2: { l: "PPP", m: ["M4", "M5", "M6"] },
  p3: { l: "POST-PPP", m: ["M7", "M8", "M9"] },
};

// TOC deliverables matrix (must match governance.html)
const TOC_MATRIX: TOCItem[] = [
  { it: "01 Executive Summary", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "", M7: "P", M8: "", M9: "" },
  { it: "02 Facility Overview", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "", M7: "P", M8: "", M9: "" },
  { it: "03 Operating Philosophy", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "", M7: "P", M8: "", M9: "" },
  { it: "04 SOPs (A1)", M1: "", M2: "", M3: "S", M4: "", M5: "", M6: "", M7: "P", M8: "", M9: "" },
  { it: "05 SMPs (A2)", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "", M7: "P", M8: "", M9: "" },
  { it: "06 Maint Mgmt (A3)", M1: "", M2: "", M3: "", M4: "P", M5: "P", M6: "", M7: "P", M8: "P", M9: "P" },
  { it: "07 SCADA & Automation", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "P", M7: "", M8: "", M9: "" },
  { it: "08 T&C / Proving (A4)", M1: "P", M2: "P", M3: "P", M4: "", M5: "", M6: "", M7: "", M8: "", M9: "" },
  { it: "09 As-Built Drawings (A4)", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "", M7: "P", M8: "", M9: "" },
  { it: "10 Training (A5)", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "P", M7: "", M8: "", M9: "" },
  { it: "11 Digital/SAP (A6)", M1: "", M2: "", M3: "", M4: "P", M5: "", M6: "", M7: "", M8: "", M9: "P" },
  { it: "12 Critical Spares (A7)", M1: "", M2: "", M3: "S", M4: "", M5: "", M6: "", M7: "P", M8: "", M9: "" },
  { it: "13 Acceptance (A8)", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "", M7: "", M8: "", M9: "P" },
  { it: "14 Addenda (A9)", M1: "", M2: "", M3: "", M4: "", M5: "", M6: "", M7: "", M8: "", M9: "P" },
];

// ── Core Analysis Engine ──
export function analyzeGovernance(
  facilitySlug: string,
  state: FacilityState,
  allStates: Record<string, FacilityState>
): AIInsights {
  const ms = state.ms || {};
  const up = state.up || {};
  const pp = state.pp || "";

  // 1. Milestone completion analysis
  const milestoneAnalysis = Object.entries(MS_DEF).map(([mid, def]) => {
    const st = ms[mid] || { done: false };
    const hasCompDate = !!(st.compDate && st.compDate.length === 10);
    const hasPppDate = !!(st.pppDate && st.pppDate.length === 10);
    const uploadsForMilestone = up[mid] || [];
    const uploadCount = uploadsForMilestone.length;
    const tocRequired = getTOCRequired(mid);
    const tocComplete = tocRequired.filter((t) => {
      const key = mid + "_" + t.code;
      return uploadForTOCExists(up, mid, t.code);
    }).length;

    return {
      id: mid,
      name: def.n,
      phase: PHASES[def.ph]?.l || def.ph,
      offset: def.o,
      completed: st.done || false,
      hasCompletionDate: hasCompDate,
      hasPPPDate: hasPppDate,
      completionDate: st.compDate || null,
      pppDate: st.pppDate || null,
      uploadCount,
      tocRequired: tocRequired.length,
      tocComplete,
      tocPct: tocRequired.length > 0 ? Math.round((tocComplete / tocRequired.length) * 100) : 100,
      readiness: st.done ? 100 : hasCompDate ? 75 : hasPppDate ? 50 : uploadCount > 0 ? 30 : 10,
    };
  });

  // 2. Phase-level analysis
  const phaseAnalysis = Object.entries(PHASES).map(([pid, ph]) => {
    const milestones = milestoneAnalysis.filter((m) => MS_DEF[m.id]?.ph === pid);
    const completed = milestones.filter((m) => m.completed).length;
    const total = milestones.length;
    const avgReadiness = milestones.length > 0
      ? Math.round(milestones.reduce((s, m) => s + m.readiness, 0) / milestones.length)
      : 0;
    return {
      id: pid,
      name: ph.l,
      milestones: ph.m,
      completed,
      total,
      avgReadiness,
      status: completed === total ? "COMPLETE" : completed > 0 ? "IN PROGRESS" : "NOT STARTED",
    };
  });

  // 3. PPP Status
  const hasPPP = pp && pp.length === 10;
  const pppMilestone = milestoneAnalysis.find((m) => m.id === "M1");
  const m1HasPPP = !!(pppMilestone?.hasPPPDate || pppMilestone?.pppDate);

  // 4. Overall readiness score
  const overallReadiness = milestoneAnalysis.length > 0
    ? Math.round(milestoneAnalysis.reduce((s, m) => s + m.readiness, 0) / milestoneAnalysis.length)
    : 0;

  // 5. Identify gaps
  const gaps: string[] = [];
  if (!hasPPP && !m1HasPPP) {
    gaps.push("No PPP Start Date set — this drives all milestone target dates. Set M1 PPP Start to activate the schedule.");
  }
  const incompleteMilestones = milestoneAnalysis.filter((m) => !m.completed);
  for (const m of incompleteMilestones) {
    if (!m.hasCompletionDate && !m.hasPPPDate) {
      gaps.push(`${m.id} (${m.name}): No target date or completion date. ${m.tocComplete}/${m.tocRequired} TOC items uploaded.`);
    } else if (!m.hasCompletionDate && m.hasPPPDate) {
      gaps.push(`${m.id} (${m.name}): Has target date but not completed. ${m.tocComplete}/${m.tocRequired} TOC items uploaded.`);
    }
  }

  // 6. Missing deliverables
  const missingDeliverables = analyzeMissingDeliverables(ms, up);

  // 7. Upload completeness
  const totalUploads = Object.values(up).reduce((s, files) => s + files.length, 0);
  const totalRequiredUploads = countRequiredUploads();
  const uploadPct = totalRequiredUploads > 0 ? Math.round((totalUploads / totalRequiredUploads) * 100) : 0;

  // 8. Risk assessment
  const riskLevel = overallReadiness >= 80 ? "LOW" : overallReadiness >= 50 ? "MEDIUM" : overallReadiness >= 20 ? "HIGH" : "CRITICAL";

  // 9. Cross-facility comparison
  const allFacilities = Object.entries(allStates).map(([slug, st]) => {
    const fMs = st.ms || {};
    const completed = Object.keys(MS_DEF).filter((mid) => fMs[mid]?.done).length;
    const total = Object.keys(MS_DEF).length;
    return { slug, completed, total, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
  }).sort((a, b) => b.pct - a.pct);

  // 10. Recommendations
  const recommendations = generateRecommendations(milestoneAnalysis, phaseAnalysis, hasPPP || m1HasPPP, gaps);

  return {
    facility: facilitySlug,
    overallReadiness,
    riskLevel,
    milestoneAnalysis,
    phaseAnalysis,
    hasPPP: hasPPP || m1HasPPP,
    pppDate: pp || pppMilestone?.pppDate || null,
    gaps,
    missingDeliverables,
    uploadStats: { total: totalUploads, required: totalRequiredUploads, percent: uploadPct },
    crossFacilityRank: allFacilities.findIndex((f) => f.slug === facilitySlug) + 1,
    totalFacilities: allFacilities.length,
    recommendations,
  };
}

// ── AI Chat Engine ──
export function chatWithAI(question: string, context: AIInsights): AIChatResponse {
  const q = question.toLowerCase().trim();

  // Pattern matching for governance questions
  if (q.includes("ppp") && (q.includes("date") || q.includes("start"))) {
    return {
      answer: context.hasPPP
        ? `PPP Start Date is set to ${context.pppDate}. This drives all milestone target dates in the governance schedule.`
        : `No PPP Start Date is set. This is critical — the PPP date drives all milestone calendar dates. Set the M1 PPP Start date to activate the schedule.`,
      sources: ["Milestone M1 state"],
      confidence: "HIGH",
    };
  }

  if (q.includes("missing") && (q.includes("sop") || q.includes("smp"))) {
    const sopItems = context.missingDeliverables.filter((d) => d.item.toLowerCase().includes("sop") || d.item.toLowerCase().includes("smp"));
    if (sopItems.length === 0) {
      return { answer: "All SOP/SMP deliverables are complete or on track.", sources: ["TOC matrix analysis"], confidence: "HIGH" };
    }
    return {
      answer: `Found ${sopItems.length} SOP/SMP gaps: ${sopItems.map((d) => `${d.milestone}: ${d.item}`).join("; ")}`,
      sources: ["TOC matrix M4-M6"],
      confidence: "HIGH",
    };
  }

  if (q.includes("ready") && (q.includes("turnover") || q.includes("acceptance") || q.includes("to"))) {
    const ready = context.overallReadiness >= 80;
    return {
      answer: ready
        ? `Facility is ${context.overallReadiness}% ready for turnover. ${context.phaseAnalysis.find((p) => p.name === "POST-PPP")?.completed || 0}/3 POST-PPP milestones complete.`
        : `Facility is ${context.overallReadiness}% ready — not yet ready for turnover. Critical gaps: ${context.gaps.slice(0, 3).join("; ")}`,
      sources: ["Phase analysis", "Milestone completion"],
      confidence: "HIGH",
    };
  }

  if (q.includes("governance") && q.includes("gap")) {
    if (context.gaps.length === 0) {
      return { answer: "No critical governance gaps identified. All milestones have target dates or completion tracking.", sources: ["Full analysis"], confidence: "HIGH" };
    }
    return {
      answer: `Found ${context.gaps.length} governance gaps: ${context.gaps.slice(0, 5).join("; ")}${context.gaps.length > 5 ? ` and ${context.gaps.length - 5} more.` : ""}`,
      sources: ["Milestone analysis", "TOC matrix"],
      confidence: "HIGH",
    };
  }

  if (q.includes("summary") || q.includes("overview") || q.includes("status")) {
    const phases = context.phaseAnalysis.map((p) => `${p.name}: ${p.completed}/${p.total} (${p.avgReadiness}%)`).join(" | ");
    return {
      answer: `Readiness: ${context.overallReadiness}% (${context.riskLevel} risk). PPP: ${context.hasPPP ? context.pppDate : "NOT SET"}. Phases: ${phases}. Uploads: ${context.uploadStats.total}/${context.uploadStats.required} (${context.uploadStats.percent}%).`,
      sources: ["Full analysis"],
      confidence: "HIGH",
    };
  }

  if (q.includes("recommend") || q.includes("what should") || q.includes("next step")) {
    if (context.recommendations.length === 0) {
      return { answer: "All items are on track. No immediate action required.", sources: ["Analysis"], confidence: "HIGH" };
    }
    return {
      answer: `Top recommendations: ${context.recommendations.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join(" ")}`,
      sources: ["Gap analysis", "Phase assessment"],
      confidence: "HIGH",
    };
  }

  if (q.includes("which") && q.includes("facility")) {
    if (context.totalFacilities <= 1) {
      return { answer: "Only one facility in current context. Compare across facilities by checking the facility selector.", sources: ["Multi-facility data"], confidence: "MEDIUM" };
    }
    return {
      answer: `This facility ranks #${context.crossFacilityRank} of ${context.totalFacilities} facilities by completion percentage.`,
      sources: ["Cross-facility comparison"],
      confidence: "HIGH",
    };
  }

  // Default: provide summary
  return {
    answer: `Governance readiness for ${context.facility}: ${context.overallReadiness}% (${context.riskLevel} risk). ${context.milestoneAnalysis.filter((m) => m.completed).length}/9 milestones complete. ${context.hasPPP ? "PPP date is set." : "PPP date NOT SET — this is critical."} Uploads: ${context.uploadStats.percent}% complete. Ask about specific milestones, deliverables, or recommendations.`,
    sources: ["Full analysis"],
    confidence: "HIGH",
  };
}

// ── Helpers ──
function getTOCRequired(milestoneId: string): { code: string; desc: string }[] {
  const items: { code: string; desc: string }[] = [];
  for (const toc of TOC_MATRIX) {
    const val = toc[milestoneId];
    if (val === "P" || val === "S") {
      const codeMatch = toc.it.match(/^(\d+)\s/);
      items.push({ code: codeMatch ? codeMatch[1] : "", desc: toc.it });
    }
  }
  return items;
}

function uploadForTOCExists(up: Record<string, string[]>, milestoneId: string, tocCode: string): boolean {
  const files = up[milestoneId] || [];
  // Check if any file name contains the TOC code or relevant keywords
  return files.some((f) => f.toLowerCase().includes(tocCode) || f.toLowerCase().includes("toc") || f.toLowerCase().includes("upload"));
}

function countRequiredUploads(): number {
  let count = 0;
  for (const toc of TOC_MATRIX) {
    for (const mid of Object.keys(MS_DEF)) {
      if (toc[mid] === "P" || toc[mid] === "S") count++;
    }
  }
  return count;
}

function analyzeMissingDeliverables(ms: Record<string, MilestoneState>, up: Record<string, string[]>): MissingDeliverable[] {
  const missing: MissingDeliverable[] = [];
  for (const toc of TOC_MATRIX) {
    for (const mid of Object.keys(MS_DEF)) {
      const req = toc[mid];
      if (!req) continue; // Not required for this milestone
      const codeMatch = toc.it.match(/^(\d+)\s/);
      const code = codeMatch ? codeMatch[1] : "";
      const files = up[mid] || [];
      const hasUpload = files.length > 0;
      const mState = ms[mid] || { done: false };
      if (!hasUpload && !mState.done) {
        missing.push({
          milestone: mid,
          milestoneName: MS_DEF[mid]?.n || mid,
          item: toc.it,
          code,
          priority: req === "P" ? "PRIMARY" : "SECONDARY",
        });
      }
    }
  }
  return missing.sort((a, b) => (a.priority === "PRIMARY" ? -1 : 1));
}

function generateRecommendations(
  msAnalysis: MilestoneAnalysis[],
  phaseAnalysis: PhaseAnalysis[],
  hasPPP: boolean,
  gaps: string[]
): string[] {
  const recs: string[] = [];

  if (!hasPPP) {
    recs.push("Set PPP Start Date for M1 immediately — this unlocks all milestone target dates");
  }

  // Phase-level recommendations
  for (const ph of phaseAnalysis) {
    if (ph.status === "NOT STARTED") {
      recs.push(`Begin ${ph.name} phase (${ph.milestones.join(", ")}) — no milestones started`);
    } else if (ph.status === "IN PROGRESS") {
      const incomplete = ph.milestones.filter((mid) => !msAnalysis.find((m) => m.id === mid)?.completed);
      recs.push(`Complete remaining ${ph.name} milestones: ${incomplete.join(", ")}`);
    }
  }

  // Upload recommendations
  const lowUploadMilestones = msAnalysis.filter((m) => m.tocPct < 50 && m.tocRequired > 0);
  for (const m of lowUploadMilestones) {
    recs.push(`Upload TOC documents for ${m.id} (${m.name}) — only ${m.tocPct}% complete`);
  }

  // Date recommendations
  const noDateMilestones = msAnalysis.filter((m) => !m.hasCompletionDate && !m.hasPPPDate && !m.completed);
  if (noDateMilestones.length > 0) {
    recs.push(`Set target/completion dates for: ${noDateMilestones.map((m) => m.id).join(", ")}`);
  }

  return recs;
}

// ── Types ──
export interface MilestoneAnalysis {
  id: string;
  name: string;
  phase: string;
  offset: number;
  completed: boolean;
  hasCompletionDate: boolean;
  hasPPPDate: boolean;
  completionDate: string | null;
  pppDate: string | null;
  uploadCount: number;
  tocRequired: number;
  tocComplete: number;
  tocPct: number;
  readiness: number;
}

export interface PhaseAnalysis {
  id: string;
  name: string;
  milestones: string[];
  completed: number;
  total: number;
  avgReadiness: number;
  status: string;
}

export interface MissingDeliverable {
  milestone: string;
  milestoneName: string;
  item: string;
  code: string;
  priority: "PRIMARY" | "SECONDARY";
}

export interface UploadStats {
  total: number;
  required: number;
  percent: number;
}

export interface AIInsights {
  facility: string;
  overallReadiness: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  milestoneAnalysis: MilestoneAnalysis[];
  phaseAnalysis: PhaseAnalysis[];
  hasPPP: boolean;
  pppDate: string | null;
  gaps: string[];
  missingDeliverables: MissingDeliverable[];
  uploadStats: UploadStats;
  crossFacilityRank: number;
  totalFacilities: number;
  recommendations: string[];
}

export interface AIChatResponse {
  answer: string;
  sources: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
}
