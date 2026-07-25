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
  type GovernancePresentationReport,
  type FacilityPresentationSummary,
  type FacilityGovernanceData,
} from "./governanceTypes";
import { DATA_QUALITY_DISCLOSURE } from "./governanceTypes";

type PresentationSlide = Parameters<typeof createPresentation>[0][number];
type PresentationElement = PresentationSlide["elements"][number];
type TextElement = Extract<PresentationElement, { type: "text" }>;

const DESIGN = MONTHLY_KPI_DECK_DESIGN;
const COLORS = DESIGN.colors;

export { GOVERNANCE_SOURCE_LABEL };
export const GOVERNANCE_DECK_TITLE = GOVERNANCE_SOURCE_LABEL;

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
  
  elements.push(...buildKpiCard("Onboarding Facilities", String(report.portfolio.totalFacilities), 0.5, 1.8));
  elements.push(...buildKpiCard("Portfolio Progress", formatPercent(report.portfolio.overallProgress, 0), 3.0, 1.8));
  elements.push(...buildKpiCard("Deliverables Compliance", formatPercent(report.portfolio.overallCompliance, 0), 5.5, 1.8));
  elements.push(...buildKpiCard("Total Required", String(report.portfolio.requiredMilestoneSubmissionProxy), 8.0, 1.8));
  elements.push(...buildKpiCard("Total Approved", String(report.portfolio.totalApproved), 10.5, 1.8));
  elements.push(...buildKpiCard("Total Submitted", String(report.portfolio.totalSubmitted), 0.5, 2.9));
  elements.push(...buildKpiCard("Outstanding", String(report.portfolio.outstandingMilestoneSubmissionProxy), 3.0, 2.9));
  
  const tableHeader = ["Facility", "Progress", "Compliance", "Required", "Submitted", "Approved", "Outstanding", "Status"];
  const tableRows = report.facilities.map(f => [
    f.facility.shortName,
    formatPercent(f.progress, 0),
    formatPercent(f.deliverablesCompliance, 0),
    String(f.required),
    String(f.submitted),
    String(f.approved),
    String(f.outstanding),
    statusLabel(f.status, f.hasBaselineSchedule),
  ]);
  
  elements.push({
    type: "table",
    rows: [tableHeader, ...tableRows],
    x: 0.5,
    y: 4.1,
    w: 12.5,
    h: 2.5,
    fontSize: 10,
    cellFills: [
      Array(tableHeader.length).fill(COLORS.navy + "20"),
      ...tableRows.map(() => Array(tableHeader.length).fill(undefined)),
    ],
    cellColors: [
      Array(tableHeader.length).fill(COLORS.white),
      ...tableRows.map((row) =>
        row.map((_, colIdx) => {
          if (colIdx === 7) {
            const status = row[colIdx];
            return status === "GREEN" ? "#22c55e" : 
                   status === "AMBER" ? "#f59e0b" : 
                   status === "RED" ? "#ef4444" : "#9ca3af";
          }
          return COLORS.text;
        })
      ),
    ],
    cellBold: [
      Array(tableHeader.length).fill(true),
      ...tableRows.map(() => [true, false, false, false, false, false, false, true]),
    ],
  });
  
  // Data quality disclosure
  elements.push({
    type: "text",
    x: 0.5,
    y: 6.8,
    w: 12.5,
    h: 0.5,
    text: DATA_QUALITY_DISCLOSURE,
    fontSize: 8,
    color: COLORS.mutedText,
  });
  
  // Data quality indicator
  elements.push({
    type: "shape",
    x: 0.5,
    y: 7.0,
    w: 0.2,
    h: 0.15,
    fill: "#f59e0b", // Amber for proxy metrics
  });
  
  elements.push({
    type: "text",
    text: "DATA QUALITY: PROXY METRICS",
    x: 0.8,
    y: 6.95,
    w: 5,
    h: 0.25,
    fontSize: 9,
    color: "#f59e0b",
    bold: true,
  });
  
  slides.push({
    elements,
    notes: "Executive summary of O&M Manual Governance onboarding progress across all facilities.",
  });
  
  return slides;
}

function buildSCurvePanel(
  facility: FacilityPresentationSummary,
  x: number,
  y: number,
  w: number,
  h: number
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
    text: facility.facility.shortName,
    x: x + 0.1,
    y: y + 0.1,
    w: w - 0.2,
    h: 0.3,
    fontSize: 12,
    bold: true,
    color: facility.facility.color,
  });
  
  elements.push({
    type: "shape",
    x: x + w - 0.6,
    y: y + 0.1,
    w: 0.4,
    h: 0.25,
    fill: statusColor(facility.status),
  });
  
  const chartX = x + 0.3;
  const chartY = y + 0.5;
  const chartW = w - 0.6;
  const chartH = h - 1.0;
  
  elements.push({
    type: "shape",
    x: chartX,
    y: chartY,
    w: chartW,
    h: chartH,
    fill: "#f9fafb",
  });
  
  for (let i = 0; i <= 4; i++) {
    const gridY = chartY + (chartH * i) / 4;
    elements.push({
      type: "shape",
      x: chartX,
      y: gridY,
      w: chartW,
      h: 0.01,
      fill: "#e5e7eb",
    });
  }
  
  for (let i = 0; i <= 4; i++) {
    const pct = 100 - i * 25;
    const labelY = chartY + (chartH * i) / 4;
    elements.push({
      type: "text",
      text: `${pct}%`,
      x: x + 0.05,
      y: labelY - 0.08,
      w: 0.5,
      h: 0.15,
      fontSize: 7,
      color: COLORS.mutedText,
    });
  }
  
  const sCurve = facility.sCurve;
  
  // Check if baseline is available
  if (!facility.hasBaselineSchedule) {
    elements.push({
      type: "text",
      text: "Baseline schedule unavailable",
      x: chartX + chartW / 2 - 1.5,
      y: chartY + chartH / 2 - 0.2,
      w: 3,
      h: 0.4,
      fontSize: 10,
      color: COLORS.mutedText,
      align: "ctr",
    });
  } else if (sCurve.length > 0) {
    // Plot planned line (if available)
    const plannedPoints = sCurve
      .filter(p => p.planned !== null)
      .map((point, idx) => {
        const px = chartX + (chartW * (idx + 1)) / sCurve.length;
        const py = chartY + chartH - (chartH * (point.planned ?? 0)) / 100;
        return { x: px, y: py };
      });
    
    if (plannedPoints.length > 1) {
      for (let i = 0; i < plannedPoints.length - 1; i++) {
        const p1 = plannedPoints[i];
        const p2 = plannedPoints[i + 1];
        elements.push({
          type: "shape",
          x: p1.x,
          y: p1.y,
          w: p2.x - p1.x,
          h: 0.02,
          fill: "#9ca3af",
        });
      }
    }
    
    // Plot actual line
    const actualPoints = sCurve
      .filter(p => p.actual !== null)
      .map((point, idx) => {
        const px = chartX + (chartW * (idx + 1)) / sCurve.length;
        const py = chartY + chartH - (chartH * (point.actual ?? 0)) / 100;
        return { x: px, y: py, value: point.actual };
      });
    
    if (actualPoints.length > 1) {
      for (let i = 0; i < actualPoints.length - 1; i++) {
        const p1 = actualPoints[i];
        const p2 = actualPoints[i + 1];
        elements.push({
          type: "shape",
          x: p1.x,
          y: p1.y,
          w: p2.x - p1.x,
          h: 0.03,
          fill: facility.facility.color,
        });
      }
    }
    
    // Plot actual points
    actualPoints.forEach((p) => {
      elements.push({
        type: "shape",
        x: p.x - 0.04,
        y: p.y - 0.04,
        w: 0.08,
        h: 0.08,
        fill: facility.facility.color,
      });
    });
    
    // Plot forecast line (if available)
    const forecastPoints = sCurve
      .filter(p => p.forecast !== null)
      .map((point, idx) => {
        const px = chartX + (chartW * (idx + 1)) / sCurve.length;
        const py = chartY + chartH - (chartH * (point.forecast ?? 0)) / 100;
        return { x: px, y: py };
      });
    
    if (forecastPoints.length > 1) {
      for (let i = 0; i < forecastPoints.length - 1; i++) {
        const p1 = forecastPoints[i];
        const p2 = forecastPoints[i + 1];
        elements.push({
          type: "shape",
          x: p1.x,
          y: p1.y,
          w: p2.x - p1.x,
          h: 0.02,
          fill: "#d97706", // Amber for forecast
        });
      }
    }
  }
  
  const legendY = y + h - 0.35;
  
  // Only show legend items that have data
  let legendX = x + 0.3;
  
  // Actual legend
  elements.push({
    type: "shape",
    x: legendX,
    y: legendY,
    w: 0.3,
    h: 0.1,
    fill: facility.facility.color,
  });
  elements.push({
    type: "text",
    text: "Actual",
    x: legendX + 0.35,
    y: legendY - 0.02,
    w: 0.8,
    h: 0.15,
    fontSize: 8,
    color: COLORS.mutedText,
  });
  legendX += 1.2;
  
  // Forecast legend (only if forecast exists)
  const hasForecast = sCurve.some(p => p.forecast !== null);
  if (hasForecast) {
    elements.push({
      type: "shape",
      x: legendX,
      y: legendY,
      w: 0.3,
      h: 0.1,
      fill: "#d97706",
    });
    elements.push({
      type: "text",
      text: "Forecast",
      x: legendX + 0.35,
      y: legendY - 0.02,
      w: 0.8,
      h: 0.15,
      fontSize: 8,
      color: COLORS.mutedText,
    });
    legendX += 1.2;
  }
  
  // Progress text
  elements.push({
    type: "text",
    text: `Progress: ${formatPercent(facility.progress, 0)}`,
    x: x + w - 2,
    y: y + h - 0.35,
    w: 1.7,
    h: 0.2,
    fontSize: 9,
    color: COLORS.text,
    align: "r",
  });
  
  return elements;
}

function buildSlide2SCurves(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  
  const elements: PresentationElement[] = [
    {
      type: "text",
      text: "S-Curve Analysis by Facility",
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
      text: "Progress Tracking vs Planned Milestones",
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 0.4,
      fontSize: 18,
      color: COLORS.mutedText,
    },
    ...getSlideHeader(report.reportingDate, 2),
  ];
  
  const panelW = 6.0;
  const panelH = 3.2;
  
  report.facilities.forEach((facility, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const px = 0.5 + col * 6.3;
    const py = 1.8 + row * 3.4;
    
    elements.push(...buildSCurvePanel(facility, px, py, panelW, panelH));
  });
  
  slides.push({
    elements,
    notes: "S-curve analysis showing actual vs planned progress for each facility.",
  });
  
  return slides;
}

function buildSlide3DeliverablesAndActions(report: GovernancePresentationReport): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  
  const elements: PresentationElement[] = [
    {
      type: "text",
      text: "Deliverables Compliance & Executive Actions",
      x: 0.5,
      y: 0.7,
      w: 12,
      h: 0.5,
      fontSize: 28,
      bold: true,
      color: COLORS.navy,
    },
    {
      type: "text",
      text: "Document Status and Required Actions",
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 0.4,
      fontSize: 18,
      color: COLORS.mutedText,
    },
    ...getSlideHeader(report.reportingDate, 3),
  ];
  
  elements.push({
    type: "text",
    text: "Compliance by Document Category",
    x: 0.5,
    y: 1.7,
    w: 5,
    h: 0.3,
    fontSize: 14,
    bold: true,
    color: COLORS.text,
  });
  
  const categoryHeader = ["Category", "Required", "Approved", "Rate"];
  const categoryRows = report.deliverableCompliance.map(row => [
    row.category,
    String(row.required),
    String(row.approved),
    formatPercent(row.complianceRate, 0),
  ]);
  
  const finalCategoryRows = categoryRows.length > 0 ? categoryRows : [["No data available", "-", "-", "-"]];
  
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

/**
 * Generate the complete governance presentation
 */
export async function generateGovernancePresentation(
  context: DeckGenerationContext
): Promise<GeneratedPresentation> {
  // TODO: Fetch real data from API/trpc
  // For now, use empty data - the actual data fetching should happen
  // via an API call that returns FacilityGovernanceData[]
  const mockFacilities: FacilityGovernanceData[] = [];
  const report = buildGovernanceReport(mockFacilities);
  
  const slides = [
    ...buildSlide1ExecutiveDashboard(report),
    ...buildSlide2SCurves(report),
    ...buildSlide3DeliverablesAndActions(report),
  ];
  
  const pptxBlob = await createPresentation(slides);
  
  const dataUrl = await blobToDataUrl(pptxBlob);
  const fileSize = pptxBlob.size;
  
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
}
