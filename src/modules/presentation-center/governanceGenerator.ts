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
  type FacilityPresentationSummary,
  type SCurvePoint,
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



// Calculate consolidated S-curve from all facilities
function calculateConsolidatedSCurve(facilities: FacilityPresentationSummary[]): SCurvePoint[] {
  if (facilities.length === 0) return [];
  
  const allDates = new Set<string>();
  facilities.forEach(f => {
    f.sCurve.forEach(p => {
      allDates.add(p.date);
    });
  });
  
  const sortedDates = Array.from(allDates).sort();
  
  return sortedDates.map(date => {
    let totalPlanned = 0;
    let totalActual = 0;
    let plannedCount = 0;
    let actualCount = 0;
    
    facilities.forEach(f => {
      const point = f.sCurve.find(p => p.date === date);
      if (point) {
        if (point.planned !== null) {
          totalPlanned += point.planned;
          plannedCount++;
        }
        if (point.actual !== null) {
          totalActual += point.actual;
          actualCount++;
        }
      }
    });
    
    return {
      date,
      planned: plannedCount > 0 ? Math.round(totalPlanned / plannedCount) : null,
      actual: actualCount > 0 ? Math.round(totalActual / actualCount) : null,
      forecast: null,
    };
  });
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
  
  elements.push(...buildHeader("Governance Overview"));
  
  const consolidatedSCurve = calculateConsolidatedSCurve(report.facilities);
  const lastPoint = consolidatedSCurve.length > 0 
    ? consolidatedSCurve[consolidatedSCurve.length - 1] 
    : { planned: null, actual: null };
  const currentPlanned = lastPoint.planned ?? 0;
  const currentActual = lastPoint.actual ?? 0;
  const variance = currentActual - currentPlanned;
  const portfolioRag = report.facilities.length > 0
    ? report.facilities.every(f => f.status === "green") ? "green"
      : report.facilities.some(f => f.status === "red") ? "red" : "amber"
    : "green";
  
  const plannedData = consolidatedSCurve.map(p => p.planned ?? 0);
  const actualData = consolidatedSCurve.map(p => p.actual ?? 0);
  const dateLabels = consolidatedSCurve.map(p => {
    const d = new Date(p.date);
    return `${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`;
  });
  
  elements.push({
    type: "chart",
    chartType: "line",
    data: [
      { name: "Planned", labels: dateLabels, values: plannedData },
      { name: "Actual", labels: dateLabels, values: actualData },
    ],
    x: MASTER.content.x,
    y: MASTER.content.y + 0.2,
    w: MASTER.content.width * 0.7,
    h: 4.2,
    colors: [MASTER.table.headerFill, MASTER.rag.green],
    showLegend: true,
    valAxisMax: 100,
    catAxisLabel: true,
  } as unknown as PresentationElement);
  
  const summaryX = MASTER.content.x + MASTER.content.width * 0.72;
  elements.push({
    type: "text",
    text: "Portfolio Summary",
    x: summaryX,
    y: MASTER.content.y + 0.3,
    w: 3.3,
    h: 0.3,
    fontSize: 12,
    bold: true,
    color: MASTER.typography.title.color,
  });
  elements.push({
    type: "text",
    text: `Facilities: ${report.facilities.length}`,
    x: summaryX,
    y: MASTER.content.y + 0.8,
    w: 3.3,
    h: 0.25,
    fontSize: 10,
    color: "595959",
  });
  elements.push({
    type: "text",
    text: `Planned: ${currentPlanned}%`,
    x: summaryX,
    y: MASTER.content.y + 1.2,
    w: 3.3,
    h: 0.25,
    fontSize: 10,
    color: MASTER.table.headerFill,
  });
  elements.push({
    type: "text",
    text: `Actual: ${currentActual}%`,
    x: summaryX,
    y: MASTER.content.y + 1.55,
    w: 3.3,
    h: 0.25,
    fontSize: 10,
    color: MASTER.rag.green,
  });
  const varianceColor = variance < -10 ? MASTER.rag.red : variance < 0 ? MASTER.rag.amber : MASTER.rag.green;
  elements.push({
    type: "text",
    text: `Variance: ${variance >= 0 ? '+' : ''}${variance}%`,
    x: summaryX,
    y: MASTER.content.y + 1.9,
    w: 3.3,
    h: 0.25,
    fontSize: 10,
    color: varianceColor,
  });
  elements.push({
    type: "shape",
    x: summaryX,
    y: MASTER.content.y + 2.4,
    w: 0.15,
    h: 0.15,
    fill: statusColor(portfolioRag),
  });
  elements.push({
    type: "text",
    text: `Status: ${statusLabel(portfolioRag, true)}`,
    x: summaryX + 0.25,
    y: MASTER.content.y + 2.35,
    w: 3.0,
    h: 0.25,
    fontSize: 10,
    color: "333333",
  });
  
  const tableY = MASTER.content.y + 4.6;
  const tableHeader = ["Facility", "Progress", "Status"];
  const tableRows = report.facilities.map(f => [
    f.facility.shortName,
    formatPercent(f.progress, 0),
    statusLabel(f.status, f.hasBaselineSchedule),
  ]);
  const finalRows = tableRows.length > 0 ? tableRows : [["No data", "—", "—"]];
  const cellFills = [
    Array(tableHeader.length).fill(MASTER.table.headerFill),
    ...finalRows.map((row) => {
      const status = row[2];
      const baseFill = "FFFFFF";
      if (status === "DELAYED") return [baseFill, baseFill, MASTER.rag.paleRed];
      if (status === "AT RISK") return [baseFill, baseFill, MASTER.rag.paleAmber];
      if (status === "ON TRACK") return [baseFill, baseFill, MASTER.rag.paleGreen];
      return Array(tableHeader.length).fill(baseFill);
    }),
  ];
  elements.push({
    type: "table",
    rows: [tableHeader, ...finalRows],
    x: MASTER.content.x,
    y: tableY,
    w: MASTER.content.width,
    h: Math.max(1.0, finalRows.length * 0.35 + 0.4),
    fontSize: 10,
    cellFills,
  });
  
  elements.push(...buildFooter(report.reportingDate, 2, 4));
  
  slides.push({
    elements,
    notes: `Consolidated S-curve showing planned ${currentPlanned}% vs actual ${currentActual}%.`,
  });
  
  return slides;
}

function buildSlide3FacilitySCurves(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  const elements: PresentationElement[] = [];
  
  elements.push(...buildHeader("Facility S-Curve Analysis"));
  
  const facilities = report.facilities.slice(0, 4);
  const panelWidth = 5.8;
  const panelHeight = 3.1;
  const startY = MASTER.content.y + 0.2;
  
  facilities.forEach((f, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MASTER.content.x + col * (panelWidth + 0.4);
    const y = startY + row * (panelHeight + 0.15);
    
    elements.push({
      type: "shape",
      x: x,
      y: y,
      w: panelWidth,
      h: panelHeight,
      fill: "FFFFFF",
      line: MASTER.table.borderColor,
    });
    
    const statusHex = statusColor(f.status);
    elements.push({
      type: "shape",
      x: x + 0.15,
      y: y + 0.12,
      w: 0.12,
      h: 0.12,
      fill: statusHex,
    });
    elements.push({
      type: "text",
      text: f.facility.shortName,
      x: x + 0.35,
      y: y + 0.08,
      w: 4,
      h: 0.28,
      fontSize: 11,
      bold: true,
      color: MASTER.typography.title.color,
    });
    
    const plannedData = f.sCurve.map(p => p.planned ?? 0);
    const actualData = f.sCurve.map(p => p.actual ?? 0);
    const dateLabels = f.sCurve.map(p => {
      const d = new Date(p.date);
      return `${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`;
    });
    
    elements.push({
      type: "chart",
      chartType: "line",
      data: [
        { name: "Planned", labels: dateLabels, values: plannedData },
        { name: "Actual", labels: dateLabels, values: actualData },
      ],
      x: x + 0.15,
      y: y + 0.45,
      w: panelWidth - 0.3,
      h: 1.8,
      colors: [MASTER.table.headerFill, MASTER.rag.green],
      showLegend: index === 0,
      valAxisMax: 100,
      catAxisLabel: false,
    } as unknown as PresentationElement);
    
    const statsY = y + 2.35;
    const lastPoint = f.sCurve.length > 0 
      ? f.sCurve[f.sCurve.length - 1] 
      : { planned: null, actual: null };
    const plannedVal = lastPoint.planned ?? 0;
    const actualVal = lastPoint.actual ?? 0;
    const varVal = actualVal - plannedVal;
    
    elements.push({
      type: "text",
      text: `Planned: ${plannedVal}%`,
      x: x + 0.15,
      y: statsY,
      w: 1.7,
      h: 0.2,
      fontSize: 8,
      color: MASTER.table.headerFill,
    });
    elements.push({
      type: "text",
      text: `Actual: ${actualVal}%`,
      x: x + 1.85,
      y: statsY,
      w: 1.7,
      h: 0.2,
      fontSize: 8,
      color: MASTER.rag.green,
    });
    const varColor = varVal < -10 ? MASTER.rag.red : varVal < 0 ? MASTER.rag.amber : MASTER.rag.green;
    elements.push({
      type: "text",
      text: `Var: ${varVal >= 0 ? '+' : ''}${varVal}%`,
      x: x + 3.55,
      y: statsY,
      w: 1.7,
      h: 0.2,
      fontSize: 8,
      color: varColor,
    });
    elements.push({
      type: "text",
      text: statusLabel(f.status, f.hasBaselineSchedule),
      x: x + 0.15,
      y: statsY + 0.25,
      w: 3,
      h: 0.2,
      fontSize: 8,
      color: "666666",
    });
  });
  
  elements.push(...buildFooter(report.reportingDate, 3, 4));
  
  slides.push({
    elements,
    notes: "Four facility S-curve analysis with planned vs actual comparison.",
  });
  
  return slides;
}

function buildSlide4DeliverablesSummary(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  const elements: PresentationElement[] = [];
  
  elements.push(...buildHeader("Deliverables Compliance Summary"));
  
  elements.push({
    type: "text",
    text: "Facility Deliverables Status",
    x: MASTER.content.x,
    y: MASTER.content.y,
    w: MASTER.content.width,
    h: 0.3,
    fontSize: 12,
    bold: true,
    color: "0C0C0C",
  });
  
  const matrixHeader = ["Facility", "Required", "Submitted", "Approved", "Missing", "Compliance", "Status"];
  const TOTAL_TOC_DELIVERABLES = 14;
  
  const matrixRows = report.facilities.map(f => {
    const required = f.hasRequirementBaseline ? TOTAL_TOC_DELIVERABLES : 0;
    const submitted = Math.min(f.submitted, required);
    const approved = submitted;
    const missing = required > 0 ? required - submitted : 0;
    const compliance = required > 0 
      ? `${Math.round((submitted / required) * 100)}%`
      : "N/A";
    const status = required > 0 
      ? (submitted >= required ? "Complete" : submitted >= required * 0.7 ? "In Progress" : "At Risk")
      : "Not Configured";
    
    return [
      f.facility.shortName,
      required > 0 ? String(required) : "Not configured",
      String(submitted),
      String(approved),
      required > 0 ? String(missing) : "—",
      compliance,
      status,
    ];
  });
  
  const finalRows = matrixRows.length > 0 ? matrixRows : [["No data", "—", "—", "—", "—", "—", "—"]];
  
  const matrixCellFills = [
    Array(matrixHeader.length).fill(MASTER.table.headerFill),
    ...finalRows.map((row) => {
      const status = row[6];
      const baseFill = "FFFFFF";
      if (status === "At Risk") return [...Array(6).fill(baseFill), MASTER.rag.paleRed];
      if (status === "In Progress") return [...Array(6).fill(baseFill), MASTER.rag.paleAmber];
      if (status === "Complete") return [...Array(6).fill(baseFill), MASTER.rag.paleGreen];
      return Array(matrixHeader.length).fill(baseFill);
    }),
  ];
  
  elements.push({
    type: "table",
    rows: [matrixHeader, ...finalRows],
    x: MASTER.content.x,
    y: MASTER.content.y + 0.4,
    w: MASTER.content.width,
    h: Math.max(1.5, finalRows.length * 0.4 + 0.5),
    fontSize: 9,
    cellFills: matrixCellFills,
  });
  
  const catY = MASTER.content.y + 0.4 + Math.max(1.5, finalRows.length * 0.4 + 0.5) + 0.3;
  
  elements.push({
    type: "text",
    text: "Document Submission by Category",
    x: MASTER.content.x,
    y: catY,
    w: 5.5,
    h: 0.25,
    fontSize: 11,
    bold: true,
    color: "0C0C0C",
  });
  
  const catHeader = ["Category", "Submitted"];
  const catRows = report.deliverableCompliance
    .filter(row => row.submitted > 0)
    .map(row => [row.category, String(row.submitted)]);
  const finalCatRows = catRows.length > 0 ? catRows : [["No submissions", "—"]];
  
  elements.push({
    type: "table",
    rows: [catHeader, ...finalCatRows],
    x: MASTER.content.x,
    y: catY + 0.35,
    w: 5.5,
    h: Math.max(1.0, finalCatRows.length * 0.35 + 0.4),
    fontSize: 9,
    cellFills: [
      Array(catHeader.length).fill(MASTER.table.headerFill),
      ...finalCatRows.map(() => Array(catHeader.length).fill("FFFFFF")),
    ],
  });
  
  elements.push({
    type: "text",
    text: "Executive Actions",
    x: MASTER.content.x + 6.0,
    y: catY,
    w: 6,
    h: 0.25,
    fontSize: 11,
    bold: true,
    color: "0C0C0C",
  });
  
  const actionHeader = ["Priority", "Facility", "Action"];
  const actionRows = report.executiveActions.slice(0, 4).map(action => [
    action.priority.toUpperCase(),
    action.facility,
    action.action.length > 35 ? action.action.substring(0, 32) + "..." : action.action,
  ]);
  const finalActionRows = actionRows.length > 0 ? actionRows : [["—", "—", "No critical actions"]];
  
  const actionCellFills = [
    Array(actionHeader.length).fill(MASTER.table.headerFill),
    ...finalActionRows.map((row) => {
      const priority = row[0];
      const baseFill = "FFFFFF";
      if (priority === "HIGH" || priority === "CRITICAL") return [MASTER.rag.paleRed, baseFill, baseFill];
      if (priority === "MEDIUM") return [MASTER.rag.paleAmber, baseFill, baseFill];
      return Array(actionHeader.length).fill(baseFill);
    }),
  ];
  
  elements.push({
    type: "table",
    rows: [actionHeader, ...finalActionRows],
    x: MASTER.content.x + 6.0,
    y: catY + 0.35,
    w: 6.0,
    h: Math.max(1.0, finalActionRows.length * 0.35 + 0.4),
    fontSize: 9,
    cellFills: actionCellFills,
  });
  
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
  
  elements.push(...buildFooter(report.reportingDate, 4, 4));
  
  slides.push({
    elements,
    notes: "Deliverables compliance summary with facility matrix and executive actions.",
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
