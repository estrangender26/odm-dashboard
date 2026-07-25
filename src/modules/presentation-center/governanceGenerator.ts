import { createPresentation } from "./pptxBuilder";
import { MONTHLY_KPI_DECK_DESIGN } from "./monthlyKpiDeckDesign";
import { blobToDataUrl } from "./storage";
import type {
  DeckGenerationContext,
  GeneratedPresentation,
} from "./types";
import {
  buildGovernanceReport,
  GOVERNANCE_SOURCE_LABEL,
  GOVERNANCE_DECK_TYPE,
  DATA_QUALITY_DISCLOSURE,
  type GovernancePresentationReport,
  type FacilityGovernanceData,
} from "./governanceTypes";

type PresentationSlide = Parameters<typeof createPresentation>[0][number];
type PresentationElement = PresentationSlide["elements"][number];
type TextElement = Extract<PresentationElement, { type: "text" }>;

const DESIGN = MONTHLY_KPI_DECK_DESIGN;
const COLORS = DESIGN.colors;

export { GOVERNANCE_SOURCE_LABEL };
export const GOVERNANCE_DECK_TITLE = GOVERNANCE_SOURCE_LABEL;

// Generate a deterministic test fixture for 4 facilities
export function createDeterministicTestFixture(): FacilityGovernanceData[] {
  // const testDate = new Date("2026-07-25T00:00:00Z"); // Used for documentation
  const colors = ["#f97316", "#3b82f6", "#10b981", "#8b5cf6"];
  
  // Facility 1: On-schedule (all milestones planned and progressing well)
  const facility1: FacilityGovernanceData = {
    facility: {
      slug: "facility-on-schedule",
      name: "Laguna Water Treatment Plant",
      shortName: "Laguna",
      color: colors[0],
    },
    pppStartDate: "2025-01-01",
    milestones: [
      { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2025-02-01", actualDate: "2025-01-28", actualProgress: 100, status: "complete" },
      { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: "2025-04-01", actualDate: "2025-03-30", actualProgress: 100, status: "complete" },
      { milestoneId: "M3", milestoneName: "M3 - Construction Completion", weight: 1, plannedDate: "2025-08-01", actualDate: "2025-08-05", actualProgress: 100, status: "complete" },
      { milestoneId: "M4", milestoneName: "M4 - P1 Acceptance", weight: 1, plannedDate: "2025-10-01", actualDate: null, actualProgress: 75, status: "in-progress" },
      { milestoneId: "M5", milestoneName: "M5 - P1 Defects", weight: 1, plannedDate: "2025-12-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M6", milestoneName: "M6 - P2 Acceptance", weight: 1, plannedDate: "2026-03-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M7", milestoneName: "M7 - P2 Defects", weight: 1, plannedDate: "2026-05-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M8", milestoneName: "M8 - TOC Certificate", weight: 1, plannedDate: "2026-07-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M9", milestoneName: "M9 - Final TOC", weight: 1, plannedDate: "2026-09-01", actualDate: null, actualProgress: null, status: null },
    ],
    documentSummary: {
      totalDocuments: 8,
      byCategory: { "TOC-01": 2, "TOC-03": 2, "TOC-04": 2, "TOC-08": 2 },
      byWorkflowStatus: { accepted: 0, pendingReview: 8, returned: 0, missing: 0, overdue: 0, rejected: 0 },
      latestSubmissionDate: "2026-07-20T10:00:00Z",
    },
    governanceMetrics: {
      governanceReadiness: 75,
      riskLevel: "Low",
      milestones: { complete: 3, total: 9 },
      progress: { planned: 78, actual: 75, variance: -3 },
      ragStatus: "green",
    },
  };

  // Facility 2: Behind schedule
  const facility2: FacilityGovernanceData = {
    facility: {
      slug: "facility-behind",
      name: "Clark Water Reclamation Facility",
      shortName: "Clark",
      color: colors[1],
    },
    pppStartDate: "2025-02-01",
    milestones: [
      { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2025-03-01", actualDate: "2025-03-15", actualProgress: 100, status: "complete" },
      { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: "2025-05-01", actualDate: "2025-06-10", actualProgress: 100, status: "complete" },
      { milestoneId: "M3", milestoneName: "M3 - Construction Completion", weight: 1, plannedDate: "2025-09-01", actualDate: null, actualProgress: 60, status: "in-progress" },
      { milestoneId: "M4", milestoneName: "M4 - P1 Acceptance", weight: 1, plannedDate: "2025-11-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M5", milestoneName: "M5 - P1 Defects", weight: 1, plannedDate: "2026-01-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M6", milestoneName: "M6 - P2 Acceptance", weight: 1, plannedDate: "2026-04-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M7", milestoneName: "M7 - P2 Defects", weight: 1, plannedDate: "2026-06-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M8", milestoneName: "M8 - TOC Certificate", weight: 1, plannedDate: "2026-08-01", actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M9", milestoneName: "M9 - Final TOC", weight: 1, plannedDate: "2026-10-01", actualDate: null, actualProgress: null, status: null },
    ],
    documentSummary: {
      totalDocuments: 5,
      byCategory: { "TOC-01": 2, "TOC-03": 2, "TOC-04": 1 },
      byWorkflowStatus: { accepted: 0, pendingReview: 5, returned: 0, missing: 0, overdue: 0, rejected: 0 },
      latestSubmissionDate: "2026-07-18T14:30:00Z",
    },
    governanceMetrics: {
      governanceReadiness: 45,
      riskLevel: "Medium",
      milestones: { complete: 2, total: 9 },
      progress: { planned: 67, actual: 45, variance: -22 },
      ragStatus: "amber",
    },
  };

  // Facility 3: Insufficient forecast
  const facility3: FacilityGovernanceData = {
    facility: {
      slug: "facility-forecast",
      name: "Tagum Water Supply System",
      shortName: "Tagum",
      color: colors[2],
    },
    pppStartDate: "2025-03-01",
    milestones: [
      { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2025-04-01", actualDate: "2025-04-05", actualProgress: 100, status: "complete" },
      { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: "2025-06-01", actualDate: null, actualProgress: 80, status: "in-progress" },
      { milestoneId: "M3", milestoneName: "M3 - Construction Completion", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M4", milestoneName: "M4 - P1 Acceptance", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M5", milestoneName: "M5 - P1 Defects", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M6", milestoneName: "M6 - P2 Acceptance", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M7", milestoneName: "M7 - P2 Defects", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M8", milestoneName: "M8 - TOC Certificate", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M9", milestoneName: "M9 - Final TOC", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
    ],
    documentSummary: {
      totalDocuments: 3,
      byCategory: { "TOC-01": 1, "TOC-02": 1, "TOC-03": 1 },
      byWorkflowStatus: { accepted: 0, pendingReview: 3, returned: 0, missing: 0, overdue: 0, rejected: 0 },
      latestSubmissionDate: "2026-07-15T09:00:00Z",
    },
    governanceMetrics: {
      governanceReadiness: 30,
      riskLevel: "High",
      milestones: { complete: 1, total: 9 },
      progress: { planned: null, actual: 30, variance: null },
      ragStatus: "red",
    },
  };

  // Facility 4: No baseline schedule
  const facility4: FacilityGovernanceData = {
    facility: {
      slug: "facility-no-baseline",
      name: "Estate Water Supply",
      shortName: "Estate",
      color: colors[3],
    },
    pppStartDate: null,
    milestones: [
      { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M3", milestoneName: "M3 - Construction Completion", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M4", milestoneName: "M4 - P1 Acceptance", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M5", milestoneName: "M5 - P1 Defects", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M6", milestoneName: "M6 - P2 Acceptance", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M7", milestoneName: "M7 - P2 Defects", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M8", milestoneName: "M8 - TOC Certificate", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
      { milestoneId: "M9", milestoneName: "M9 - Final TOC", weight: 1, plannedDate: null, actualDate: null, actualProgress: null, status: null },
    ],
    documentSummary: {
      totalDocuments: 0,
      byCategory: {},
      byWorkflowStatus: { accepted: 0, pendingReview: 0, returned: 0, missing: 0, overdue: 0, rejected: 0 },
      latestSubmissionDate: null,
    },
    governanceMetrics: {
      governanceReadiness: 0,
      riskLevel: "High",
      milestones: { complete: 0, total: 9 },
      progress: { planned: null, actual: 0, variance: null },
      ragStatus: "gray",
    },
  };

  return [facility1, facility2, facility3, facility4];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(digits)}%`;
}

function statusColor(status: string): string {
  switch (status) {
    case "green": return "#22c55e";
    case "amber": return "#f59e0b";
    case "red": return "#ef4444";
    default: return "#9ca3af";
  }
}

function statusLabel(status: string, hasBaseline: boolean): string {
  if (status === "gray" || !hasBaseline) return "NO BASELINE";
  return status.toUpperCase();
}

function getSlideHeader(reportingDate: string, pageNum: number): TextElement[] {
  const now = new Date();
  const timestamp = now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  
  return [
    {
      type: "text",
      text: `As of ${formatDate(reportingDate)}`,
      x: 0.5,
      y: 0.3,
      w: 4,
      h: 0.3,
      fontSize: 11,
      color: COLORS.mutedText,
    },
    {
      type: "text",
      text: `Generated: ${timestamp}`,
      x: 9,
      y: 0.3,
      w: 3,
      h: 0.3,
      fontSize: 9,
      color: COLORS.mutedText,
      align: "r",
    },
    {
      type: "text",
      text: `${pageNum} / 3`,
      x: 12,
      y: 0.3,
      w: 0.8,
      h: 0.3,
      fontSize: 9,
      color: COLORS.mutedText,
      align: "r",
    },
  ];
}

function buildKpiCard(
  label: string,
  value: string,
  x: number,
  y: number,
  w: number = 2.2,
  h: number = 0.9
): PresentationElement[] {
  const elements: PresentationElement[] = [];
  
  elements.push({
    type: "shape",
    x,
    y,
    w,
    h,
    fill: COLORS.white,
    line: COLORS.border,
  });
  
  elements.push({
    type: "text",
    text: value,
    x: x + 0.1,
    y: y + 0.1,
    w: w - 0.2,
    h: 0.4,
    fontSize: 22,
    bold: true,
    color: COLORS.text,
  });
  
  elements.push({
    type: "text",
    text: label,
    x: x + 0.1,
    y: y + 0.5,
    w: w - 0.2,
    h: 0.3,
    fontSize: 10,
    color: COLORS.mutedText,
  });
  
  return elements;
}

function buildSlide1ExecutiveDashboard(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  
  const elements: PresentationElement[] = [
    {
      type: "text",
      text: "O&M Manual Governance",
      x: 0.5,
      y: 0.7,
      w: 9,
      h: 0.5,
      fontSize: 28,
      bold: true,
      color: COLORS.navy,
    },
    {
      type: "text",
      text: "Executive Onboarding Progress",
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 0.4,
      fontSize: 18,
      color: COLORS.mutedText,
    },
    ...getSlideHeader(report.reportingDate, 1),
  ];
  
  // KPI Cards with proxy terminology
  elements.push(...buildKpiCard("Onboarding Facilities", String(report.portfolio.totalFacilities), 0.5, 1.8));
  elements.push(...buildKpiCard("Portfolio Progress", formatPercent(report.portfolio.overallProgress, 0), 3.0, 1.8));
  elements.push(...buildKpiCard("Submission Coverage Proxy", formatPercent(report.portfolio.submissionCoverageProxy, 0), 5.5, 1.8));
  elements.push(...buildKpiCard("Required Submissions — Proxy", String(report.portfolio.requiredMilestoneSubmissionProxy), 8.0, 1.8));
  elements.push(...buildKpiCard("Total Submitted", String(report.portfolio.totalSubmitted), 0.5, 2.9));
  elements.push(...buildKpiCard("Outstanding — Proxy", String(report.portfolio.outstandingMilestoneSubmissionProxy), 3.0, 2.9));
  
  // Facility summary table with proxy terminology
  const tableHeader = ["Facility", "Progress", "Coverage", "Required", "Submitted", "Outstanding", "Status"];
  const tableRows = report.facilities.map(f => [
    f.facility.shortName,
    formatPercent(f.progress, 0),
    formatPercent(f.submissionCoverageProxy, 0),
    String(f.required),
    String(f.submitted),
    String(f.outstanding),
    statusLabel(f.status, f.hasBaselineSchedule),
  ]);
  
  const finalRows = tableRows.length > 0 ? tableRows : [["No data", "—", "—", "—", "—", "—", "—"]];
  
  elements.push({
    type: "table",
    rows: [tableHeader, ...finalRows],
    x: 0.5,
    y: 4.0,
    w: 12.5,
    h: Math.max(1.5, finalRows.length * 0.35 + 0.5),
    fontSize: 10,
    cellFills: [
      Array(tableHeader.length).fill(COLORS.navy + "20"),
      ...finalRows.map((row) => 
        Array(tableHeader.length).fill(row[row.length - 1] === "RED" ? COLORS.danger + "20" : 
                                       row[row.length - 1] === "AMBER" ? COLORS.warning + "20" : 
                                       row[row.length - 1] === "GREEN" ? COLORS.success + "20" : undefined)
      ),
    ],
  });
  
  // Data quality disclosure
  elements.push({
    type: "text",
    x: 0.5,
    y: 7.2,
    w: 12.5,
    h: 0.3,
    text: DATA_QUALITY_DISCLOSURE,
    fontSize: 8,
    color: COLORS.mutedText,
  });
  
  slides.push({
    elements,
    notes: "Executive dashboard with submission coverage proxy metrics.",
  });
  
  return slides;
}

function buildSlide2SCurves(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  
  const elements: PresentationElement[] = [
    {
      type: "text",
      text: "Facility S-Curve Analysis",
      x: 0.5,
      y: 0.7,
      w: 9,
      h: 0.5,
      fontSize: 24,
      bold: true,
      color: COLORS.navy,
    },
    {
      type: "text",
      text: "Planned vs Actual Progress by Facility",
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 0.4,
      fontSize: 14,
      color: COLORS.mutedText,
    },
    ...getSlideHeader(report.reportingDate, 2),
  ];
  
  // Create 4 facility panels (2x2 grid)
  const facilities = report.facilities.slice(0, 4);
  const panelWidth = 6.0;
  const panelHeight = 2.8;
  
  facilities.forEach((f, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.5 + col * panelWidth;
    const y = 1.8 + row * panelHeight;
    
    // Panel background
    elements.push({
      type: "shape",
      x: x + 0.1,
      y: y + 0.1,
      w: panelWidth - 0.2,
      h: panelHeight - 0.2,
      fill: COLORS.white,
      line: COLORS.border,
    });
    
    // Facility name with status indicator
    const statusColorHex = statusColor(f.status);
    elements.push({
      type: "shape",
      x: x + 0.2,
      y: y + 0.2,
      w: 0.15,
      h: 0.15,
      fill: statusColorHex,
    });
    
    elements.push({
      type: "text",
      text: f.facility.shortName,
      x: x + 0.4,
      y: y + 0.15,
      w: 4,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: COLORS.text,
    });
    
    // Progress stats
    elements.push({
      type: "text",
      text: `Actual: ${formatPercent(f.progress, 0)}`,
      x: x + 0.4,
      y: y + 0.5,
      w: 2,
      h: 0.25,
      fontSize: 10,
      color: COLORS.text,
    });
    
    elements.push({
      type: "text",
      text: `Planned: ${f.scheduleVariance !== null ? formatPercent(f.progress + (f.scheduleVariance || 0), 0) : "N/A"}`,
      x: x + 0.4,
      y: y + 0.75,
      w: 2,
      h: 0.25,
      fontSize: 10,
      color: COLORS.mutedText,
    });
    
    elements.push({
      type: "text",
      text: `Variance: ${f.scheduleVariance !== null ? (f.scheduleVariance > 0 ? "+" : "") + f.scheduleVariance + "%" : "N/A"}`,
      x: x + 0.4,
      y: y + 1.0,
      w: 2,
      h: 0.25,
      fontSize: 10,
      color: f.scheduleVariance !== null && f.scheduleVariance < 0 ? COLORS.danger : COLORS.text,
    });
    
    // S-Curve visualization (simplified bar chart)
    if (f.sCurve.length > 0) {
      const barY = y + 1.5;
      const barHeight = 0.3;
      const maxBarWidth = 2.0;
      
      // Show last 5 data points as mini bars
      const recentPoints = f.sCurve.slice(-5);
      const pointWidth = maxBarWidth / recentPoints.length;
      
      recentPoints.forEach((point, pIdx) => {
        const barWidth = (point.actual || 0) / 100 * pointWidth * 0.8;
        elements.push({
          type: "shape",
          x: x + 0.4 + pIdx * pointWidth,
          y: barY,
          w: Math.max(0.05, barWidth),
          h: barHeight,
          fill: COLORS.navy,
        });
      });
    }
    
    // Submission coverage proxy
    elements.push({
      type: "text",
      text: `Coverage: ${formatPercent(f.submissionCoverageProxy, 0)}`,
      x: x + 3.0,
      y: y + 0.5,
      w: 2.5,
      h: 0.25,
      fontSize: 9,
      color: COLORS.mutedText,
    });
    
    elements.push({
      type: "text",
      text: `${f.submitted}/${f.required} submitted`,
      x: x + 3.0,
      y: y + 0.75,
      w: 2.5,
      h: 0.25,
      fontSize: 9,
      color: COLORS.mutedText,
    });
  });
  
  slides.push({
    elements,
    notes: "S-curve analysis showing planned vs actual progress for each facility.",
  });
  
  return slides;
}

function buildSlide3DeliverablesAndActions(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  
  const elements: PresentationElement[] = [
    {
      type: "text",
      text: "Deliverable Compliance & Executive Actions",
      x: 0.5,
      y: 0.7,
      w: 9,
      h: 0.5,
      fontSize: 24,
      bold: true,
      color: COLORS.navy,
    },
    ...getSlideHeader(report.reportingDate, 3),
  ];
  
  // Deliverable compliance table with proxy terminology
  elements.push({
    type: "text",
    text: "Document Submission Summary",
    x: 0.5,
    y: 1.7,
    w: 5,
    h: 0.3,
    fontSize: 14,
    bold: true,
    color: COLORS.text,
  });
  
  const categoryHeader = ["Category", "Submitted", "Rate"];
  const categoryRows = report.deliverableCompliance.map(row => [
    row.category,
    String(row.submitted),
    formatPercent(row.complianceRate, 0),
  ]);
  
  const finalCategoryRows = categoryRows.length > 0 ? categoryRows : [["No data available", "-", "-"]];
  
  elements.push({
    type: "table",
    rows: [categoryHeader, ...finalCategoryRows],
    x: 0.5,
    y: 2.1,
    w: 5.5,
    h: Math.max(1.5, finalCategoryRows.length * 0.35 + 0.5),
    fontSize: 10,
    cellFills: [
      Array(categoryHeader.length).fill(COLORS.navy + "20"),
      ...finalCategoryRows.map(() => Array(categoryHeader.length).fill(undefined)),
    ],
  });
  
  // Executive Actions
  elements.push({
    type: "text",
    text: "Executive Actions",
    x: 6.5,
    y: 1.7,
    w: 6,
    h: 0.3,
    fontSize: 14,
    bold: true,
    color: COLORS.text,
  });
  
  const actionHeader = ["Priority", "Facility", "Action", "Due"];
  const actionRows = report.executiveActions.slice(0, 6).map(action => [
    action.priority.toUpperCase(),
    action.facility,
    action.action.length > 40 ? action.action.substring(0, 37) + "..." : action.action,
    action.dueDate ? formatDate(action.dueDate) : "No due date",
  ]);
  
  const finalActionRows = actionRows.length > 0 ? actionRows : [["-", "-", "No critical actions required", "-"]];
  
  elements.push({
    type: "table",
    rows: [actionHeader, ...finalActionRows],
    x: 6.5,
    y: 2.1,
    w: 6.5,
    h: Math.max(1.5, finalActionRows.length * 0.35 + 0.5),
    fontSize: 9,
    cellFills: [
      Array(actionHeader.length).fill(COLORS.navy + "20"),
      ...finalActionRows.map(() => Array(actionHeader.length).fill(undefined)),
    ],
    cellBold: [
      Array(actionHeader.length).fill(true),
      ...finalActionRows.map(() => [true, false, false, false]),
    ],
  });
  
  // Portfolio Risk Summary
  const riskY = 5.0;
  elements.push({
    type: "text",
    text: "Portfolio Risk Summary",
    x: 0.5,
    y: riskY,
    w: 6,
    h: 0.3,
    fontSize: 14,
    bold: true,
    color: COLORS.text,
  });
  
  if (report.risks.length > 0) {
    report.risks.forEach((risk, idx) => {
      const riskColor = risk.impact === "high" ? "#dc2626" : risk.impact === "medium" ? "#d97706" : "#6b7280";
      
      elements.push({
        type: "shape",
        x: 0.5,
        y: riskY + 0.4 + idx * 0.8,
        w: 0.2,
        h: 0.2,
        fill: riskColor,
      });
      
      elements.push({
        type: "text",
        text: risk.risk,
        x: 0.8,
        y: riskY + 0.35 + idx * 0.8,
        w: 5,
        h: 0.25,
        fontSize: 10,
        bold: true,
        color: COLORS.text,
      });
      
      elements.push({
        type: "text",
        text: `Mitigation: ${risk.mitigation}`,
        x: 0.8,
        y: riskY + 0.6 + idx * 0.8,
        w: 11,
        h: 0.25,
        fontSize: 9,
        color: COLORS.mutedText,
      });
    });
  } else {
    elements.push({
      type: "text",
      text: "No critical risks identified",
      x: 0.5,
      y: riskY + 0.4,
      w: 6,
      h: 0.3,
      fontSize: 10,
      color: COLORS.mutedText,
    });
  }
  
  // Data quality disclosure in footer
  elements.push({
    type: "text",
    x: 0.5,
    y: 7.2,
    w: 12.5,
    h: 0.3,
    text: DATA_QUALITY_DISCLOSURE,
    fontSize: 8,
    color: COLORS.mutedText,
  });
  
  slides.push({
    elements,
    notes: "Deliverables compliance status and required executive actions.",
  });
  
  return slides;
}

export interface GovernanceGenerationOptions {
  facilities?: FacilityGovernanceData[];
  useTestFixture?: boolean;
  reportingDate?: Date;
}

/**
 * Generate the complete governance presentation
 * Uses live data from the database with reporting date filtering
 */
export async function generateGovernancePresentation(
  context: DeckGenerationContext,
  options?: GovernanceGenerationOptions
): Promise<GeneratedPresentation> {
  const startTime = performance.now();
  
  try {
    // Determine reporting date
    const reportingDate = options?.reportingDate || new Date();
    
    let facilities: FacilityGovernanceData[];
    
    // Use passed facilities, test fixture, or empty array
    if (options?.facilities) {
      facilities = options.facilities;
    } else if (options?.useTestFixture) {
      facilities = createDeterministicTestFixture();
    } else {
      // Data should be fetched by caller and passed via options.facilities
      // For browser compatibility, we don't import the server-only module here
      facilities = [];
    }
    
    // Handle empty state
    if (facilities.length === 0) {
      // Create a minimal report with empty state messaging
      const emptyReport = buildGovernanceReport([], reportingDate);
      
      const slides = [
        ...buildSlide1ExecutiveDashboard(emptyReport),
        ...buildSlide2SCurves(emptyReport),
        ...buildSlide3DeliverablesAndActions(emptyReport),
      ];
      
      const pptxBlob = await createPresentation(slides);
      const dataUrl = await blobToDataUrl(pptxBlob);
      const fileSize = pptxBlob.size;
      
      const dateStr = emptyReport.reportingDate;
      const fileName = `OM-Governance-Onboarding-Progress-${dateStr}.pptx`;
      
      return {
        id: `gov-${Date.now()}`,
        name: fileName,
        title: "O&M Manual Governance - Executive Onboarding Progress (No Data)",
        version: "1.0",
        type: "pptx",
        generatedDate: emptyReport.generatedAt,
        generatedBy: context.generatedBy || "ODM Dashboard",
        size: fileSize,
        dataUrl,
        generatorId: "governance-onboarding",
        generatorName: GOVERNANCE_DECK_TYPE,
        category: "O&M Manual Governance",
        filename: fileName,
        generatedAt: emptyReport.generatedAt,
      };
    }
    
    // Build the report with fetched data
    const report = buildGovernanceReport(facilities, reportingDate);
    
    const slides = [
      ...buildSlide1ExecutiveDashboard(report),
      ...buildSlide2SCurves(report),
      ...buildSlide3DeliverablesAndActions(report),
    ];
    
    const slideBuildTime = performance.now();
    
    const pptxBlob = await createPresentation(slides);
    
    const pptxTime = performance.now();
    
    const dataUrl = await blobToDataUrl(pptxBlob);
    const fileSize = pptxBlob.size;
    
    const endTime = performance.now();
    
    // Log performance metrics
    console.log("[GovernanceGenerator] Performance metrics:", {
      dataTransformMs: Math.round(slideBuildTime - startTime),
      pptxSerializeMs: Math.round(pptxTime - slideBuildTime),
      totalMs: Math.round(endTime - startTime),
      fileSizeBytes: fileSize,
      facilityCount: facilities.length,
      slideCount: slides.length,
    });
    
    const dateStr = report.reportingDate;
    const fileName = `OM-Governance-Onboarding-Progress-${dateStr}.pptx`;
    
    return {
      id: `gov-${Date.now()}`,
      name: fileName,
      title: "O&M Manual Governance - Executive Onboarding Progress",
      version: "1.0",
      type: "pptx",
      generatedDate: report.generatedAt,
      generatedBy: context.generatedBy || "ODM Dashboard",
      size: fileSize,
      dataUrl,
      generatorId: "governance-onboarding",
      generatorName: GOVERNANCE_DECK_TYPE,
      category: "O&M Manual Governance",
      filename: fileName,
      generatedAt: report.generatedAt,
    };
  } catch (error) {
    console.error("[GovernanceGenerator] Failed to generate presentation:", error);
    throw new Error(`Failed to generate governance presentation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generate a deterministic test PPTX for validation
 * Creates: OM-Governance-Onboarding-Progress-TEST.pptx
 */
export async function generateGovernanceTestPresentation(): Promise<Blob> {
  const testDate = new Date("2026-07-25T00:00:00Z"); 
  const facilities = createDeterministicTestFixture();
  
  const report = buildGovernanceReport(facilities, testDate);
  
  const slides = [
    ...buildSlide1ExecutiveDashboard(report),
    ...buildSlide2SCurves(report),
    ...buildSlide3DeliverablesAndActions(report),
  ];
  
  return createPresentation(slides);
}
