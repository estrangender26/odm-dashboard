import { createPresentation } from "./pptxBuilder";

import { GOVERNANCE_SLIDE_MASTER } from "./governanceSlideMaster";
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

const MASTER = GOVERNANCE_SLIDE_MASTER;

export { GOVERNANCE_SOURCE_LABEL };
export const GOVERNANCE_DECK_TITLE = GOVERNANCE_SOURCE_LABEL;

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


// Format helpers
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPercent(value: number | null, decimals: number = 0): string {
  if (value === null || value === undefined) return "N/A";
  return `${value.toFixed(decimals)}%`;
}

function statusLabel(status: string, hasBaseline: boolean): string {
  if (!hasBaseline) return "NO BASELINE";
  const map: Record<string, string> = {
    green: "ON TRACK",
    amber: "AT RISK",
    red: "DELAYED",
  };
  return map[status] || status.toUpperCase();
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    green: MASTER.rag.green,
    amber: MASTER.rag.amber,
    red: MASTER.rag.red,
  };
  return map[status] || "808080";
}

// Build KPI PRES style header bar
function buildHeader(title: string): TextElement[] {
  const elements: TextElement[] = [];
  
  // Navy header bar (using shape as background)
  elements.push({
    type: "shape",
    x: MASTER.header.x,
    y: MASTER.header.y,
    w: MASTER.slide.width,
    h: MASTER.header.height,
    fill: MASTER.header.fill,
  } as unknown as TextElement);
  
  // Header title
  elements.push({
    type: "text",
    text: title,
    x: 0.63,
    y: 0.23,
    w: 10,
    h: 0.5,
    fontSize: MASTER.typography.slideTitle.fontSize,
    bold: MASTER.typography.slideTitle.bold,
    color: MASTER.header.textColor,
  });
  
  return elements;
}

// Build footer with source line
function buildFooter(reportingDate: string, pageNum: number, totalPages: number): TextElement[] {
  const elements: TextElement[] = [];
  
  // Source line
  elements.push({
    type: "text",
    text: `Source: O&M Manual Governance module • ${formatDate(reportingDate)}`,
    x: MASTER.content.x,
    y: MASTER.footer.y,
    w: 10,
    h: MASTER.footer.height,
    fontSize: MASTER.footer.fontSize,
    color: MASTER.footer.textColor,
  });
  
  // Page number
  elements.push({
    type: "text",
    text: `${pageNum} / ${totalPages}`,
    x: MASTER.pageNumber.x,
    y: MASTER.pageNumber.y,
    w: 0.8,
    h: MASTER.footer.height,
    fontSize: MASTER.pageNumber.fontSize,
    color: MASTER.pageNumber.color,
    align: "r",
  });
  
  return elements;
}

// Build executive KPI card
function buildExecutiveKpiCard(
  label: string,
  value: string,
  x: number,
  y: number,
  w: number = 2.8,
  h: number = 1.2
): PresentationElement[] {
  const elements: PresentationElement[] = [];
  
  // Card border/shape
  elements.push({
    type: "shape",
    x,
    y,
    w,
    h,
    fill: MASTER.kpiCard.fill,
    line: MASTER.kpiCard.border,
  });
  
  // Large value
  elements.push({
    type: "text",
    text: value,
    x: x + 0.15,
    y: y + 0.15,
    w: w - 0.3,
    h: 0.6,
    fontSize: MASTER.typography.kpiValue.fontSize,
    bold: MASTER.typography.kpiValue.bold,
    color: MASTER.typography.kpiValue.color,
  });
  
  // Label
  elements.push({
    type: "text",
    text: label,
    x: x + 0.15,
    y: y + 0.75,
    w: w - 0.3,
    h: 0.35,
    fontSize: MASTER.typography.kpiLabel.fontSize,
    color: MASTER.typography.kpiLabel.color,
  });
  
  return elements;
}

// SLIDE 1: Title / Executive Overview
function buildSlide1ExecutiveOverview(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  const elements: PresentationElement[] = [];
  
  // Title area (no header bar on title slide)
  elements.push({
    type: "text",
    text: "New Facilities Onboarding",
    x: 0.9,
    y: 2.17,
    w: 11,
    h: 1.0,
    fontSize: MASTER.typography.title.fontSize,
    bold: MASTER.typography.title.bold,
    color: MASTER.typography.title.color,
  });
  
  // Subtitle with facility list
  const facilityNames = report.facilities.map(f => f.facility.name).join(" • ");
  elements.push({
    type: "text",
    text: facilityNames || "No facilities data",
    x: 0.9,
    y: 3.5,
    w: 11,
    h: 0.5,
    fontSize: MASTER.typography.subtitle.fontSize,
    color: MASTER.typography.subtitle.color,
  });
  
  // Date
  elements.push({
    type: "text",
    text: formatDate(report.reportingDate),
    x: 0.9,
    y: 5.5,
    w: 3,
    h: 0.4,
    fontSize: 14,
    color: "595959",
  });
  
  // Footer (page 1)
  elements.push(...buildFooter(report.reportingDate, 1, 4));
  
  slides.push({
    elements,
    notes: "Executive title slide with facility list and reporting date.",
  });
  
  return slides;
}
// SLIDE 3: Four Facility S-curves

// SLIDE 2: Consolidated Governance S-curve
function buildSlide2ConsolidatedSCurve(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  const elements: PresentationElement[] = [];
  
  // Navy header bar
  elements.push(...buildHeader("Governance Overview"));
  
  // Summary text
  elements.push({
    type: "text",
    text: `${report.facilities.length} facilities • Overall Progress: ${formatPercent(report.portfolio.overallProgress, 0)}`,
    x: MASTER.content.x,
    y: MASTER.content.y,
    w: MASTER.content.width,
    h: 0.4,
    fontSize: 12,
    color: "595959",
  });
  
  // KPI Cards in a row
  const cardY = MASTER.content.y + 0.5;
  const cardWidth = 2.8;
  const cardSpacing = 0.3;
  
  elements.push(...buildExecutiveKpiCard(
    "Portfolio Milestone Progress",
    formatPercent(report.portfolio.overallProgress, 0),
    MASTER.content.x,
    cardY,
    cardWidth
  ));
  
  elements.push(...buildExecutiveKpiCard(
    "Onboarding Facilities",
    String(report.portfolio.totalFacilities),
    MASTER.content.x + cardWidth + cardSpacing,
    cardY,
    cardWidth
  ));
  
  elements.push(...buildExecutiveKpiCard(
    "Approved Documents",
    String(report.portfolio.totalSubmitted),
    MASTER.content.x + (cardWidth + cardSpacing) * 2,
    cardY,
    cardWidth
  ));
  
  elements.push(...buildExecutiveKpiCard(
    "Coverage",
    "N/A",
    MASTER.content.x + (cardWidth + cardSpacing) * 3,
    cardY,
    cardWidth
  ));
  
  // Executive summary table
  const tableY = cardY + 1.8;
  const tableHeader = ["Facility", "Milestone Progress", "Approved Docs", "Status"];
  
  const tableRows = report.facilities.map(f => [
    f.facility.shortName,
    formatPercent(f.progress, 0),
    String(f.submitted),
    statusLabel(f.status, f.hasBaselineSchedule),
  ]);
  
  const finalRows = tableRows.length > 0 ? tableRows : [["No data", "—", "—", "—"]];
  
  // Add RAG color coding for status column
  const cellFills = [
    Array(tableHeader.length).fill(MASTER.table.headerFill),
    ...finalRows.map((row) => {
      const status = row[3];
      const baseFill = "FFFFFF";
      if (status === "DELAYED") return [baseFill, baseFill, baseFill, MASTER.rag.paleRed];
      if (status === "AT RISK") return [baseFill, baseFill, baseFill, MASTER.rag.paleAmber];
      if (status === "ON TRACK") return [baseFill, baseFill, baseFill, MASTER.rag.paleGreen];
      return Array(tableHeader.length).fill(baseFill);
    }),
  ];
  
  elements.push({
    type: "table",
    rows: [tableHeader, ...finalRows],
    x: MASTER.content.x,
    y: tableY,
    w: MASTER.content.width,
    h: Math.max(1.5, finalRows.length * 0.4 + 0.5),
    fontSize: MASTER.table.fontSize,
    cellFills,
  });
  
  // Footer
  elements.push(...buildFooter(report.reportingDate, 2, 4));
  
  slides.push({
    elements,
    notes: "Consolidated governance overview with KPI cards and facility summary table.",
  });
  
  return slides;
}

function buildSlide3FacilitySCurves(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  const elements: PresentationElement[] = [];
  
  // Navy header bar
  elements.push(...buildHeader("Facility S-Curve Analysis"));
  
  // Create 2x2 grid for up to 4 facilities
  const facilities = report.facilities.slice(0, 4);
  const panelWidth = 5.8;
  const panelHeight = 2.6;
  const startY = MASTER.content.y + 0.3;
  
  facilities.forEach((f, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MASTER.content.x + col * (panelWidth + 0.4);
    const y = startY + row * (panelHeight + 0.3);
    
    // Panel background
    elements.push({
      type: "shape",
      x: x,
      y: y,
      w: panelWidth,
      h: panelHeight,
      fill: "FFFFFF",
      line: MASTER.table.borderColor,
    });
    
    // Facility name with RAG indicator
    const statusHex = statusColor(f.status);
    elements.push({
      type: "shape",
      x: x + 0.15,
      y: y + 0.15,
      w: 0.12,
      h: 0.12,
      fill: statusHex,
    });
    
    elements.push({
      type: "text",
      text: f.facility.shortName,
      x: x + 0.35,
      y: y + 0.1,
      w: 4,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: MASTER.typography.title.color,
    });
    
    // Progress stats
    elements.push({
      type: "text",
      text: `Actual: ${formatPercent(f.progress, 0)}`,
      x: x + 0.15,
      y: y + 0.5,
      w: 2,
      h: 0.25,
      fontSize: 10,
      color: "0C0C0C",
    });
    
    const variance = f.scheduleVariance;
    const varianceText = variance !== null 
      ? `${variance >= 0 ? '+' : ''}${variance}%` 
      : "N/A";
    const varianceColor = variance !== null && variance < -10 
      ? MASTER.rag.red 
      : variance !== null && variance < 0 
        ? MASTER.rag.amber 
        : "0C0C0C";
    
    elements.push({
      type: "text",
      text: `Variance: ${varianceText}`,
      x: x + 0.15,
      y: y + 0.8,
      w: 2,
      h: 0.25,
      fontSize: 10,
      color: varianceColor,
    });
    
    // Mini S-curve bars (last 6 data points)
    if (f.sCurve.length > 0) {
      const barY = y + 1.4;
      const barHeight = 0.4;
      const maxBarWidth = 2.5;
      
      const recentPoints = f.sCurve.slice(-6);
      const pointWidth = maxBarWidth / recentPoints.length;
      
      recentPoints.forEach((point, pIdx) => {
        const barWidth = ((point.actual || 0) / 100) * pointWidth * 0.85;
        elements.push({
          type: "shape",
          x: x + 0.15 + pIdx * pointWidth,
          y: barY + (barHeight - (barHeight * (point.actual || 0) / 100)) / 2,
          w: Math.max(0.03, barWidth),
          h: barHeight * (point.actual || 0) / 100,
          fill: MASTER.typography.title.color,
        });
      });
    }
    
    // Documents count
    elements.push({
      type: "text",
      text: `${f.submitted} docs approved`,
      x: x + 3.0,
      y: y + 0.5,
      w: 2.5,
      h: 0.25,
      fontSize: 9,
      color: "595959",
    });
  });
  
  // Footer
  elements.push(...buildFooter(report.reportingDate, 3, 4));
  
  slides.push({
    elements,
    notes: "Four facility S-curve analysis in 2x2 grid layout.",
  });
  
  return slides;
}

// SLIDE 4: Deliverables / Compliance Summary
function buildSlide4DeliverablesSummary(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  const elements: PresentationElement[] = [];
  
  // Navy header bar
  elements.push(...buildHeader("Deliverables Compliance Summary"));
  
  // Left side: Document submission by category
  elements.push({
    type: "text",
    text: "Document Submission by Category",
    x: MASTER.content.x,
    y: MASTER.content.y,
    w: 5.5,
    h: 0.3,
    fontSize: 12,
    bold: true,
    color: "0C0C0C",
  });
  
  const categoryHeader = ["Category", "Submitted", "Rate"];
  const categoryRows = report.deliverableCompliance.map(row => [
    row.category,
    String(row.submitted),
    formatPercent(row.complianceRate, 0),
  ]);
  
  const finalCategoryRows = categoryRows.length > 0 ? categoryRows : [["No data", "—", "—"]];
  
  elements.push({
    type: "table",
    rows: [categoryHeader, ...finalCategoryRows],
    x: MASTER.content.x,
    y: MASTER.content.y + 0.4,
    w: 5.5,
    h: Math.max(1.5, finalCategoryRows.length * 0.35 + 0.5),
    fontSize: MASTER.table.fontSize,
    
  });
  
  // Right side: Executive Actions
  elements.push({
    type: "text",
    text: "Executive Actions",
    x: MASTER.content.x + 6.0,
    y: MASTER.content.y,
    w: 6,
    h: 0.3,
    fontSize: 12,
    bold: true,
    color: "0C0C0C",
  });
  
  const actionHeader = ["Priority", "Facility", "Action"];
  const actionRows = report.executiveActions.slice(0, 5).map(action => [
    action.priority.toUpperCase(),
    action.facility,
    action.action.length > 35 ? action.action.substring(0, 32) + "..." : action.action,
  ]);
  
  const finalActionRows = actionRows.length > 0 ? actionRows : [["—", "—", "No critical actions"]];
  
  // Color code priority column
  const actionCellFills = [
    Array(actionHeader.length).fill(MASTER.table.headerFill),
    ...finalActionRows.map((row) => {
      const priority = row[0];
      const baseFill = "FFFFFF";
      if (priority === "HIGH") return [MASTER.rag.paleRed, baseFill, baseFill];
      if (priority === "MEDIUM") return [MASTER.rag.paleAmber, baseFill, baseFill];
      return Array(actionHeader.length).fill(baseFill);
    }),
  ];
  
  elements.push({
    type: "table",
    rows: [actionHeader, ...finalActionRows],
    x: MASTER.content.x + 6.0,
    y: MASTER.content.y + 0.4,
    w: 6.0,
    h: Math.max(1.5, finalActionRows.length * 0.35 + 0.5),
    fontSize: 9,
    
    cellFills: actionCellFills,
  });
  
  // Data quality disclosure
  elements.push({
    type: "text",
    x: MASTER.content.x,
    y: 6.8,
    w: MASTER.content.width,
    h: 0.3,
    text: DATA_QUALITY_DISCLOSURE,
    fontSize: 8,
    color: "595959",
  });
  
  // Footer
  elements.push(...buildFooter(report.reportingDate, 4, 4));
  
  slides.push({
    elements,
    notes: "Deliverables compliance summary and executive actions.",
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
  context: DeckGenerationContext & { facilities?: FacilityGovernanceData[] },
  options?: GovernanceGenerationOptions
): Promise<GeneratedPresentation> {
  const startTime = performance.now();
  
  try {
    // Determine reporting date
    const reportingDate = options?.reportingDate || new Date();
    
    let facilities: FacilityGovernanceData[];
    
    // Use passed facilities from context (PresentationCenter passes here), options, or empty array
    if (context.facilities) {
      facilities = context.facilities;
    } else if (options?.facilities) {
      facilities = options.facilities;
    } else if (options?.useTestFixture) {
      facilities = createDeterministicTestFixture();
    } else {
      console.warn("[GovernanceGenerator] No facilities data provided. The caller must fetch and supply presentation data via context.facilities or options.facilities.");
      facilities = [];
    }
    
    // Handle empty state
    if (facilities.length === 0) {
      // Create a minimal report with empty state messaging
      const emptyReport = buildGovernanceReport([], reportingDate);
      
      const slides = [
    ...buildSlide1ExecutiveOverview(emptyReport),
    ...buildSlide2ConsolidatedSCurve(emptyReport),
    ...buildSlide3FacilitySCurves(emptyReport),
    ...buildSlide4DeliverablesSummary(emptyReport),
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
    ...buildSlide1ExecutiveOverview(report),
    ...buildSlide2ConsolidatedSCurve(report),
    ...buildSlide3FacilitySCurves(report),
    ...buildSlide4DeliverablesSummary(report),
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
    ...buildSlide1ExecutiveOverview(report),
    ...buildSlide2ConsolidatedSCurve(report),
    ...buildSlide3FacilitySCurves(report),
    ...buildSlide4DeliverablesSummary(report),
  ];
  
  return createPresentation(slides);
}
