/**
 * Governance V3 Presentation Generator
 * Creates exact Manila Water template reproduction using pptxgenjs
 * EXECUTIVE POLISH VERSION - Final Board Quality
 */

import { GovernancePPTX } from "./pptxWrapper";
import { 
  MANILA_WATER_COLORS, 
  FONTS,
  MILESTONES,
  PHASES,
  MILESTONE_X_POSITIONS,
  GOVERNANCE_TOC_ITEMS,
} from "./theme";
import type { 
  GovernanceV3Presentation,
  MilestoneStatus,
} from "./types";

// Status symbol configuration - executive compact style
const STATUS_SYMBOLS: Record<MilestoneStatus, { symbol: string; color: string; bgColor: string; label: string }> = {
  achieved: { symbol: "✓", color: MANILA_WATER_COLORS.white, bgColor: "169873", label: "Completed" },
  achieved_ahead: { symbol: "✓", color: MANILA_WATER_COLORS.white, bgColor: "007DA7", label: "Ahead" },
  gap: { symbol: "⚠", color: MANILA_WATER_COLORS.red, bgColor: "FDECEF", label: "Delayed" },
  upcoming: { symbol: "○", color: MANILA_WATER_COLORS.textGray, bgColor: "EEF2F5", label: "Upcoming" },
};

// Format date as "DD MMM YYYY"
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

/**
 * Slide 1: Executive Dashboard with Milestone Matrix
 */
function generateSlide1(pptx: GovernancePPTX, data: GovernanceV3Presentation): void {
  pptx.addSlide();
  
  const { facilities, executive, reportingDate } = data;
  const reportingDateObj = new Date(reportingDate);
  
  // Title
  pptx.addText({
    x: 0.50, y: 0.19, w: 12.33, h: 0.44,
    text: executive.headline,
    fontSize: FONTS.slideTitle.size,
    bold: FONTS.slideTitle.bold,
    color: MANILA_WATER_COLORS.navyDark,
    fontFace: FONTS.slideTitle.face,
  });
  
  // Subtitle
  const formattedDate = reportingDateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  pptx.addText({
    x: 0.52, y: 0.62, w: 11.56, h: 0.25,
    text: `${executive.subtitle} | ${formattedDate}`,
    fontSize: FONTS.slideSubtitle.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.slideSubtitle.face,
  });
  
  // Phase bands
  const phaseBandY = 1.0;
  const phaseBandHeight = 0.26;
  const phaseBandWidth = 2.99;
  const phaseStartX = [2.86, 6.19, 9.47];
  
  const phases = [PHASES.PRE_PPP, PHASES.PPP, PHASES.POST_PPP];
  phases.forEach((phase, i) => {
    pptx.addShape({
      x: phaseStartX[i], y: phaseBandY, w: phaseBandWidth, h: phaseBandHeight,
      fillColor: phase.color,
    });
    
    pptx.addText({
      x: phaseStartX[i], y: phaseBandY, w: phaseBandWidth, h: phaseBandHeight,
      text: `${phase.label}  •  ${phase.description}`,
      fontSize: FONTS.phaseHeader.size,
      bold: FONTS.phaseHeader.bold,
      color: MANILA_WATER_COLORS.white,
      fontFace: FONTS.phaseHeader.face,
      align: "center",
      valign: "middle",
    });
  });
  
  // Milestone headers
  const milestoneY = 1.46;
  const milestoneNameY = 1.68;
  
  Object.entries(MILESTONES).forEach(([code, definition], i) => {
    const x = MILESTONE_X_POSITIONS[i];
    const phaseColor = definition.phase === "PRE-PPP" ? "397DA4" : 
                       definition.phase === "PPP" ? "00A9C5" : "169873";
    
    pptx.addText({
      x: x, y: milestoneY, w: 0.93, h: 0.21,
      text: code,
      fontSize: FONTS.milestoneCode.size,
      bold: FONTS.milestoneCode.bold,
      color: phaseColor,
      fontFace: FONTS.milestoneCode.face,
      align: "center",
    });
    
    // Milestone name - single line, no wrapping
    pptx.addText({
      x: x - 0.05, y: milestoneNameY, w: 0.95, h: 0.25,
      text: definition.name,
      fontSize: FONTS.milestoneName.size,
      color: MANILA_WATER_COLORS.textDark,
      fontFace: FONTS.milestoneName.face,
      align: "center",
      valign: "top",
    });
  });
  
  // Facility rows
  let facilityY = 2.36;
  const facilityRowHeight = 0.88;
  
  facilities.forEach((facility) => {
    // Check if PPP start is in the future
    const pppStart = new Date(facility.pppStartDate);
    const isFuturePpp = pppStart > reportingDateObj;
    const effectiveStatus = isFuturePpp ? "PRE-PPP • IN PROGRESS" : facility.phaseStatus;
    
    // Row background
    const rowBg = facilityY % 1.76 > 1.0 ? MANILA_WATER_COLORS.rowBlue : undefined;
    if (rowBg) {
      pptx.addShape({
        x: 0.50, y: facilityY - 0.1, w: 12.33, h: facilityRowHeight,
        fillColor: rowBg,
      });
    }
    
    // Phase indicator
    const phaseColor = isFuturePpp ? MANILA_WATER_COLORS.cyan :
                       facility.currentPhase === "PRE-PPP" ? MANILA_WATER_COLORS.cyan :
                       facility.currentPhase === "PPP" ? MANILA_WATER_COLORS.cyan :
                       MANILA_WATER_COLORS.green;
    
    pptx.addShape({
      x: 0.50, y: facilityY - 0.1, w: 0.15, h: facilityRowHeight,
      fillColor: phaseColor,
    });
    
    // Facility name
    pptx.addText({
      x: 0.65, y: facilityY, w: 2.19, h: 0.22,
      text: facility.shortName.toUpperCase(),
      fontSize: FONTS.facilityName.size,
      bold: FONTS.facilityName.bold,
      color: MANILA_WATER_COLORS.navyDark,
      fontFace: FONTS.facilityName.face,
    });
    
    // Phase status
    const phaseStatusColor = effectiveStatus.includes("RECOVERY") ? MANILA_WATER_COLORS.red :
                              effectiveStatus.includes("PPP") ? MANILA_WATER_COLORS.cyan :
                              "397DA4";
    pptx.addText({
      x: 0.65, y: facilityY + 0.21, w: 2.19, h: 0.18,
      text: effectiveStatus,
      fontSize: FONTS.facilityPhase.size,
      color: phaseStatusColor,
      fontFace: FONTS.facilityPhase.face,
    });
    
    // PPP start date
    const pppDate = formatDate(facility.pppStartDate);
    pptx.addText({
      x: 0.65, y: facilityY + 0.39, w: 2.19, h: 0.18,
      text: `PPP START  ${pppDate}`,
      fontSize: FONTS.facilityDetail.size,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: FONTS.facilityDetail.face,
    });
    
    // Milestone status symbols
    facility.milestones.forEach((milestone, i) => {
      const x = MILESTONE_X_POSITIONS[i];
      const status = STATUS_SYMBOLS[milestone.status];
      
      if (status.bgColor) {
        pptx.addShape({
          x: x + 0.35, y: facilityY + 0.22, w: 0.23, h: 0.25,
          fillColor: status.bgColor,
        });
      }
      
      if (status.symbol) {
        pptx.addText({
          x: x + 0.35, y: facilityY + 0.22, w: 0.23, h: 0.25,
          text: status.symbol,
          fontSize: FONTS.statusSymbol.size,
          bold: FONTS.statusSymbol.bold,
          color: status.color,
          fontFace: FONTS.statusSymbol.face,
          align: "center",
          valign: "middle",
        });
      }
    });
    
    // Executive observation
    if (facility.executiveObservation) {
      pptx.addText({
        x: 2.82, y: facilityY + 0.60, w: 9.72, h: 0.23,
        text: facility.executiveObservation,
        fontSize: FONTS.observation.size,
        color: MANILA_WATER_COLORS.textDark,
        fontFace: FONTS.observation.face,
      });
    }
    
    facilityY += facilityRowHeight;
  });
  
  // Executive Legend
  const legendY = 6.0;
  const legendItems = [
    { symbol: "✓", color: "169873", label: "Completed" },
    { symbol: "✓", color: "007DA7", label: "Ahead" },
    { symbol: "⚠", color: MANILA_WATER_COLORS.red, label: "Delayed" },
    { symbol: "○", color: MANILA_WATER_COLORS.textGray, label: "Upcoming" },
  ];
  
  let legendX = 2.82;
  legendItems.forEach((item) => {
    const bgColor = item.label === "Completed" ? "169873" : 
                    item.label === "Ahead" ? "007DA7" : 
                    item.label === "Delayed" ? "FDECEF" : "EEF2F5";
    pptx.addShape({
      x: legendX, y: legendY + 0.02, w: 0.20, h: 0.20,
      fillColor: bgColor,
    });
    
    const symbolColor = item.label === "Delayed" ? MANILA_WATER_COLORS.red : MANILA_WATER_COLORS.white;
    pptx.addText({
      x: legendX, y: legendY + 0.02, w: 0.20, h: 0.20,
      text: item.symbol,
      fontSize: 11,
      bold: true,
      color: symbolColor,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
    
    pptx.addText({
      x: legendX + 0.25, y: legendY, w: 1.0, h: 0.25,
      text: item.label,
      fontSize: FONTS.legend.size,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: FONTS.legend.face,
    });
    
    legendX += 1.5;
  });
  
  // Next Gate section
  pptx.addShape({
    x: 0.50, y: 6.59, w: 12.33, h: 0.36,
    fillColor: "FDECEF",
  });
  
  pptx.addText({
    x: 0.67, y: 6.66, w: 1.35, h: 0.23,
    text: "NEXT GATE",
    fontSize: FONTS.calloutLabel.size,
    bold: FONTS.calloutLabel.bold,
    color: MANILA_WATER_COLORS.red,
    fontFace: FONTS.calloutLabel.face,
  });
  
  pptx.addText({
    x: 1.94, y: 6.59, w: 10.46, h: 0.36,
    text: executive.nextGateAction,
    fontSize: FONTS.calloutText.size,
    color: MANILA_WATER_COLORS.textDark,
    fontFace: FONTS.calloutText.face,
  });
}


/**
 * Slide 2: Current PPP Position by Facility
 * Executive timeline showing progress from PPP Start to Today
 */
function generateSlide2(pptx: GovernancePPTX, data: GovernanceV3Presentation): void {
  pptx.addSlide();
  
  const { facilities, executive, reportingDate } = data;
  const reportingDateObj = new Date(reportingDate);
  
  // Title
  pptx.addText({
    x: 0.50, y: 0.19, w: 12.33, h: 0.44,
    text: "Current PPP Position by Facility",
    fontSize: FONTS.slideTitle.size,
    bold: FONTS.slideTitle.bold,
    color: MANILA_WATER_COLORS.navyDark,
    fontFace: FONTS.slideTitle.face,
  });
  
  // Subtitle
  const formattedDate = reportingDateObj.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  pptx.addText({
    x: 0.52, y: 0.62, w: 11.56, h: 0.25,
    text: `PPP Progress from Start Date to Today | ${formattedDate}`,
    fontSize: FONTS.slideSubtitle.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.slideSubtitle.face,
  });
  
  // Phase headers
  const phaseHeaderY = 1.07;
  const phases = [
    { label: "PRE-PPP", desc: "Commissioning", color: MANILA_WATER_COLORS.rowBlue, textColor: "397DA4" },
    { label: "PPP", desc: "Execution", color: MANILA_WATER_COLORS.rowCyan, textColor: MANILA_WATER_COLORS.cyan },
    { label: "POST-PPP", desc: "Sustainment", color: MANILA_WATER_COLORS.rowGreen, textColor: MANILA_WATER_COLORS.green },
  ];
  
  phases.forEach((phase, i) => {
    const x = 0.65 + i * 4.06;
    
    pptx.addShape({
      x: x, y: phaseHeaderY, w: 1.30, h: 0.31,
      fillColor: phase.color,
    });
    
    pptx.addText({
      x: x, y: phaseHeaderY + 0.02, w: 1.30, h: 0.27,
      text: phase.label,
      fontSize: 12,
      bold: true,
      color: phase.textColor,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
    
    pptx.addText({
      x: x + 1.35, y: phaseHeaderY + 0.04, w: 1.80, h: 0.27,
      text: phase.desc,
      fontSize: 12,
      color: MANILA_WATER_COLORS.textDark,
      fontFace: "Arial",
      valign: "middle",
    });
  });
  
  // Timeline axis
  const timelineY = 5.5;
  const tickXStart = 2.38;
  const tickXSpacing = 1.61;
  const ticks = ["JUL 2025", "JAN 2026", "JUL 2026", "JAN 2027", "JUL 2027", "JAN 2028", "MAY 2028"];
  
  // Timeline line
  pptx.addShape({
    x: tickXStart, y: timelineY, w: tickXSpacing * 6, h: 0.02,
    fillColor: MANILA_WATER_COLORS.border,
  });
  
  ticks.forEach((tick, i) => {
    const x = tickXStart + i * tickXSpacing;
    
    pptx.addShape({
      x: x, y: timelineY - 0.05, w: 0.02, h: 0.12,
      fillColor: MANILA_WATER_COLORS.textGray,
    });
    
    pptx.addText({
      x: x - 0.44, y: timelineY + 0.08, w: 0.88, h: 0.19,
      text: tick,
      fontSize: 11,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
  });
  
  // TODAY marker
  const todayX = tickXStart + 2 * tickXSpacing; // Position at JUL 2026
  pptx.addShape({
    x: todayX - 0.02, y: 1.5, w: 0.04, h: 4.0,
    fillColor: MANILA_WATER_COLORS.red,
  });
  
  const todayLabel = `TODAY ${reportingDateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`;
  pptx.addText({
    x: todayX - 0.60, y: 1.5, w: 1.2, h: 0.22,
    text: todayLabel,
    fontSize: 11,
    bold: true,
    color: MANILA_WATER_COLORS.red,
    fontFace: "Arial",
    align: "center",
  });
  
  // Legend for timeline
  const legendY = 1.55;
  pptx.addShape({
    x: 10.5, y: legendY, w: 0.25, h: 0.15,
    fillColor: MANILA_WATER_COLORS.cyan,
  });
  pptx.addText({
    x: 10.8, y: legendY, w: 2.0, h: 0.15,
    text: "= PPP Period",
    fontSize: 11,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: "Arial",
  });
  
  pptx.addShape({
    x: 10.5, y: legendY + 0.20, w: 0.25, h: 0.15,
    fillColor: MANILA_WATER_COLORS.navyDark,
  });
  pptx.addText({
    x: 10.8, y: legendY + 0.20, w: 2.0, h: 0.15,
    text: "= PPP Start",
    fontSize: 11,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: "Arial",
  });
  
  // Facility timeline rows
  let facilityY = 2.0;
  const facilityRowHeight = 0.95;
  
  facilities.forEach((facility) => {
    const pppDate = new Date(facility.pppStartDate);
    const isFuturePpp = pppDate > reportingDateObj;
    
    // Timeline bar background
    pptx.addShape({
      x: tickXStart, y: facilityY + 0.25, w: tickXSpacing * 6, h: 0.15,
      fillColor: "EEF2F5",
    });
    
    // Facility name
    pptx.addText({
      x: 0.50, y: facilityY, w: 2.14, h: 0.25,
      text: facility.shortName.toUpperCase(),
      fontSize: FONTS.facilityName.size,
      bold: FONTS.facilityName.bold,
      color: MANILA_WATER_COLORS.navyDark,
      fontFace: FONTS.facilityName.face,
    });
    
    // PPP Start label
    const pppFormatted = pppDate.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase();
    pptx.addText({
      x: 0.50, y: facilityY + 0.28, w: 2.19, h: 0.20,
      text: `PPP: ${pppFormatted}`,
      fontSize: 12,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: "Arial",
    });
    
    // Calculate X position based on date
    // Base: July 2025 = tickXStart, then each 6 months = tickXSpacing
    const monthsSinceJuly2025 = (pppDate.getFullYear() - 2025) * 12 + (pppDate.getMonth() - 6);
    const pppX = tickXStart + (monthsSinceJuly2025 / 6) * tickXSpacing;
    const clampedPppX = Math.max(tickXStart, Math.min(pppX, tickXStart + tickXSpacing * 6));
    
    // PPP Start marker (triangle shape simulation with rect)
    pptx.addShape({
      x: clampedPppX - 0.08, y: facilityY + 0.20, w: 0.16, h: 0.25,
      fillColor: MANILA_WATER_COLORS.navyDark,
    });
    
    // Draw PPP period bar (from PPP start to PPP end - 12 months later)
    const pppEnd = new Date(pppDate);
    pppEnd.setMonth(pppEnd.getMonth() + 12);
    const monthsDuration = 12;
    const barWidth = (monthsDuration / 6) * tickXSpacing;
    
    // Only show bar up to today if PPP has started, or just planned bar if future
    if (!isFuturePpp) {
      // Progress bar from PPP start to today (or full year if completed)
      const endX = Math.min(todayX, clampedPppX + barWidth);
      const progressWidth = endX - clampedPppX;
      
      if (progressWidth > 0) {
        const progressColor = facility.phaseStatus.includes("RECOVERY") ? MANILA_WATER_COLORS.red :
                              facility.phaseStatus.includes("PPP") ? MANILA_WATER_COLORS.cyan :
                              MANILA_WATER_COLORS.green;
        
        pptx.addShape({
          x: clampedPppX, y: facilityY + 0.25, w: progressWidth, h: 0.15,
          fillColor: progressColor,
        });
      }
      
      // Status label
      const statusColor = facility.phaseStatus.includes("RECOVERY") ? MANILA_WATER_COLORS.red :
                          facility.phaseStatus.includes("PPP") ? MANILA_WATER_COLORS.cyan :
                          "397DA4";
      pptx.addText({
        x: todayX + 0.15, y: facilityY + 0.20, w: 2.50, h: 0.25,
        text: facility.phaseStatus,
        fontSize: 12,
        bold: true,
        color: statusColor,
        fontFace: "Arial",
      });
    } else {
      // Future PPP - show planned period as outline/faded
      pptx.addShape({
        x: clampedPppX, y: facilityY + 0.25, w: barWidth, h: 0.15,
        fillColor: "D3DEE8",
      });
      
      // Status label for future
      pptx.addText({
        x: todayX + 0.15, y: facilityY + 0.20, w: 2.50, h: 0.25,
        text: "PRE-PPP IN PROGRESS",
        fontSize: 12,
        bold: true,
        color: "397DA4",
        fontFace: "Arial",
      });
    }
    
    // Milestone count
    const completedMilestones = facility.milestones.filter(m => 
      m.status === "achieved" || m.status === "achieved_ahead"
    ).length;
    pptx.addText({
      x: todayX + 0.15, y: facilityY + 0.45, w: 2.50, h: 0.20,
      text: `${completedMilestones}/9 milestones`,
      fontSize: 11,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: "Arial",
    });
    
    facilityY += facilityRowHeight;
  });
  
  // Executive implication at bottom
  pptx.addShape({
    x: 0.50, y: 6.5, w: 12.33, h: 0.40,
    fillColor: MANILA_WATER_COLORS.rowBlue,
    lineColor: MANILA_WATER_COLORS.border,
  });
  
  pptx.addText({
    x: 0.65, y: 6.55, w: 12.0, h: 0.35,
    text: executive.gateImplication,
    fontSize: 12,
    color: MANILA_WATER_COLORS.textDark,
    fontFace: "Arial",
  });
  
  // Source note
  pptx.addText({
    x: 0.60, y: 7.05, w: 7.00, h: 0.18,
    text: "Sources: O&M Manual Governance module",
    fontSize: FONTS.sourceNote.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.sourceNote.face,
  });
}


/**
 * Slide 3: Documentation Readiness
 * Portfolio compliance as primary visual focus - FIXED LAYOUT
 */
function generateSlide3(pptx: GovernancePPTX, data: GovernanceV3Presentation): void {
  pptx.addSlide();
  
  const { facilities, summary, facilityDocumentation, executive } = data;
  
  // Title
  pptx.addText({
    x: 0.50, y: 0.19, w: 12.33, h: 0.44,
    text: "Documentation Readiness",
    fontSize: FONTS.slideTitle.size,
    bold: FONTS.slideTitle.bold,
    color: MANILA_WATER_COLORS.navyDark,
    fontFace: FONTS.slideTitle.face,
  });
  
  // Subtitle
  pptx.addText({
    x: 0.52, y: 0.62, w: 11.56, h: 0.25,
    text: executive.documentationSubtitle,
    fontSize: FONTS.slideSubtitle.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.slideSubtitle.face,
  });
  
  // Source note
  pptx.addText({
    x: 0.60, y: 7.05, w: 7.00, h: 0.18,
    text: `Sources: O&M Manual Governance module`,
    fontSize: FONTS.sourceNote.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.sourceNote.face,
  });
  
  // LEFT SIDE: Portfolio Readiness (primary focus) + Facility Compliance
  const leftPanelX = 0.56;
  const leftPanelWidth = 4.2;
  
  // Portfolio Readiness box
  const portfolioY = 1.1;
  const portfolioHeight = 2.4;
  
  pptx.addShape({
    x: leftPanelX, y: portfolioY, w: leftPanelWidth, h: portfolioHeight,
    fillColor: MANILA_WATER_COLORS.rowBlue,
    lineColor: MANILA_WATER_COLORS.navy,
    lineWidth: 2,
  });
  
  pptx.addText({
    x: leftPanelX + 0.15, y: portfolioY + 0.15, w: leftPanelWidth - 0.3, h: 0.30,
    text: "PORTFOLIO READINESS",
    fontSize: FONTS.portfolioLabel.size,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  pptx.addText({
    x: leftPanelX, y: portfolioY + 0.55, w: leftPanelWidth, h: 1.0,
    text: `${summary.portfolioCompliancePercent}%`,
    fontSize: FONTS.portfolioPercent.size,
    bold: FONTS.portfolioPercent.bold,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
    align: "center",
    valign: "middle",
  });
  
  pptx.addText({
    x: leftPanelX, y: portfolioY + 1.6, w: leftPanelWidth, h: 0.30,
    text: `${summary.totalDocumentsSubmitted} of ${summary.totalDocumentsRequired} Deliverables Complete`,
    fontSize: 13,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: "Arial",
    align: "center",
  });
  
  // Legend below portfolio
  pptx.addText({
    x: leftPanelX + 0.2, y: portfolioY + 2.0, w: leftPanelWidth - 0.4, h: 0.25,
    text: "✓ Submitted    |    — Missing",
    fontSize: 12,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: "Arial",
    align: "center",
  });
  
  // Facility Compliance section (moved below portfolio, not overlapping)
  const complianceY = portfolioY + portfolioHeight + 0.25;
  
  pptx.addText({
    x: leftPanelX, y: complianceY, w: leftPanelWidth, h: 0.25,
    text: "Facility Compliance",
    fontSize: 13,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  // Facility boxes - 2x2 grid
  const boxWidth = 1.95;
  const boxHeight = 0.60;
  const boxSpacing = 0.08;
  
  facilityDocumentation.forEach((doc, index) => {
    const facility = facilities.find(f => f.slug === doc.facilitySlug);
    if (!facility) return;
    
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = leftPanelX + col * (boxWidth + boxSpacing);
    const y = complianceY + 0.35 + row * (boxHeight + boxSpacing);
    
    const color = doc.compliancePercent >= 70 ? MANILA_WATER_COLORS.rowGreen :
                  doc.compliancePercent >= 40 ? MANILA_WATER_COLORS.rowBlue :
                  MANILA_WATER_COLORS.rowRed;
    
    pptx.addShape({
      x: x, y: y, w: boxWidth, h: boxHeight,
      fillColor: color,
      lineColor: MANILA_WATER_COLORS.border,
    });
    
    // Facility short name (truncated)
    const shortFacilityName = facility.shortName
      .replace(" Sewage Treatment Plant", "")
      .replace(" Treatment Plant", "")
      .substring(0, 10);
    
    pptx.addText({
      x: x + 0.08, y: y + 0.06, w: boxWidth - 0.16, h: 0.20,
      text: shortFacilityName.toUpperCase(),
      fontSize: 10,
      bold: true,
      color: MANILA_WATER_COLORS.navy,
      fontFace: "Arial",
    });
    
    pptx.addText({
      x: x + 0.08, y: y + 0.30, w: boxWidth - 0.16, h: 0.22,
      text: `${doc.compliancePercent}%`,
      fontSize: 16,
      bold: true,
      color: MANILA_WATER_COLORS.navy,
      fontFace: "Arial",
    });
  });
  
  // RIGHT SIDE: TOC Matrix (smaller, showing actual data)
  const tableX = 5.2;
  const tableY = 1.1;
  const tableWidth = 7.6;
  
  pptx.addText({
    x: tableX, y: tableY - 0.05, w: tableWidth, h: 0.25,
    text: "Governance TOC Submission Matrix",
    fontSize: 13,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  const tableRows: Array<Array<{ text: string; options?: Record<string, string | number | boolean | undefined> }>> = [];
  
  // Header row
  const headerRow = [
    { text: "TOC", options: { bold: true, color: "FFFFFF", fill: MANILA_WATER_COLORS.navy, align: "center" } },
    ...facilities.map(f => ({ 
      text: f.shortName
        .replace(" Sewage Treatment Plant", "")
        .replace(" Treatment Plant", "")
        .substring(0, 6), 
      options: { bold: true, color: "FFFFFF", fill: MANILA_WATER_COLORS.navy, align: "center" } 
    })),
  ];
  tableRows.push(headerRow);
  
  // TOC rows - show first 10 items with actual data
  GOVERNANCE_TOC_ITEMS.slice(0, 10).forEach(tocId => {
    const row = [
      { text: tocId, options: { align: "center", bold: true } },
      ...facilities.map(f => {
        const doc = facilityDocumentation.find(d => d.facilitySlug === f.slug);
        const submission = doc?.submissions.find(s => s.tocId === tocId);
        const submitted = submission?.submitted ?? false;
        // const docCount = submission?.documentCount ?? 0;
        
        // Show checkmark if submitted, dash if not
        // Show partial indicator if some documents exist
        let symbol = submitted ? "✓" : "—";
        let color = submitted ? MANILA_WATER_COLORS.green : MANILA_WATER_COLORS.textGray;
        
        return { 
          text: symbol, 
          options: { 
            align: "center",
            color: color,
            bold: submitted,
          } 
        };
      }),
    ];
    tableRows.push(row);
  });
  
  const colWidth = 1.15;
  const colWidths = [0.7, ...facilities.map(() => colWidth)];
  
  pptx.addTable({
    x: tableX, y: tableY + 0.25, w: tableWidth, h: 4.0,
    rows: tableRows,
    colWidths: colWidths,
    fontSize: 12,
    borderColor: MANILA_WATER_COLORS.border,
    headerFill: MANILA_WATER_COLORS.navy,
  });
  
  // Executive Observation box - FULL WIDTH at bottom
  const obsY = 6.0;
  const obsWidth = 12.3;
  
  pptx.addShape({
    x: leftPanelX, y: obsY, w: obsWidth, h: 0.90,
    fillColor: MANILA_WATER_COLORS.rowBlue,
    lineColor: MANILA_WATER_COLORS.border,
  });
  
  pptx.addText({
    x: leftPanelX + 0.12, y: obsY + 0.10, w: obsWidth - 0.24, h: 0.22,
    text: "EXECUTIVE OBSERVATION",
    fontSize: 12,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  pptx.addText({
    x: leftPanelX + 0.12, y: obsY + 0.35, w: obsWidth - 0.24, h: 0.50,
    text: executive.portfolioObservation,
    fontSize: 12,
    color: MANILA_WATER_COLORS.textDark,
    fontFace: "Arial",
  });
}

/**
 * Generate complete Governance V3 presentation
 */
export async function generateGovernanceV3Presentation(
  data: GovernanceV3Presentation
): Promise<Blob> {
  const pptx = new GovernancePPTX();
  
  // Generate all three slides
  generateSlide1(pptx, data);
  generateSlide2(pptx, data);
  generateSlide3(pptx, data);
  
  return await pptx.generateBlob();
}
