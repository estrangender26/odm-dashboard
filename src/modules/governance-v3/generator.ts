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
  const today = new Date(reportingDate);
  const formattedDate = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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
    // Phase band background
    pptx.addShape({
      x: phaseStartX[i], y: phaseBandY, w: phaseBandWidth, h: phaseBandHeight,
      fillColor: phase.color,
    });
    
    // Phase label
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
    
    // Milestone code (M1, M2, etc.)
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
    
    // Milestone name - single line for executive clarity
    pptx.addText({
      x: x - 0.05, y: milestoneNameY, w: 0.95, h: 0.35,
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
    // Row background (alternating)
    const rowBg = facilityY % 1.76 > 1.0 ? MANILA_WATER_COLORS.rowBlue : undefined;
    if (rowBg) {
      pptx.addShape({
        x: 0.50, y: facilityY - 0.1, w: 12.33, h: facilityRowHeight,
        fillColor: rowBg,
      });
    }
    
    // Phase indicator column
    const phaseColor = facility.currentPhase === "PRE-PPP" ? MANILA_WATER_COLORS.cyan :
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
    const phaseStatusColor = facility.phaseStatus.includes("RECOVERY") ? MANILA_WATER_COLORS.red :
                              facility.phaseStatus.includes("PPP") ? MANILA_WATER_COLORS.cyan :
                              "397DA4";
    pptx.addText({
      x: 0.65, y: facilityY + 0.21, w: 2.19, h: 0.18,
      text: facility.phaseStatus,
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
      
      // Status circle background
      if (status.bgColor) {
        pptx.addShape({
          x: x + 0.35, y: facilityY + 0.22, w: 0.23, h: 0.25,
          fillColor: status.bgColor,
        });
      }
      
      // Status symbol
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
  
  // Executive Legend - Compact graphical indicators
  const legendY = 6.0;
  const legendItems = [
    { symbol: "✓", color: "169873", label: "Completed" },
    { symbol: "✓", color: "007DA7", label: "Ahead" },
    { symbol: "⚠", color: MANILA_WATER_COLORS.red, label: "Delayed" },
    { symbol: "○", color: MANILA_WATER_COLORS.textGray, label: "Upcoming" },
  ];
  
  let legendX = 2.82;
  legendItems.forEach((item) => {
    // Symbol background
    const bgColor = item.label === "Completed" ? "169873" : 
                    item.label === "Ahead" ? "007DA7" : 
                    item.label === "Delayed" ? "FDECEF" : "EEF2F5";
    pptx.addShape({
      x: legendX, y: legendY + 0.02, w: 0.20, h: 0.20,
      fillColor: bgColor,
    });
    
    // Symbol
    const symbolColor = item.label === "Delayed" ? MANILA_WATER_COLORS.red : MANILA_WATER_COLORS.white;
    pptx.addText({
      x: legendX, y: legendY + 0.02, w: 0.20, h: 0.20,
      text: item.symbol,
      fontSize: 10,
      bold: true,
      color: symbolColor,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
    
    // Label
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pptx.addSlide();
  
  const { facilities, reportingDate } = data;
  
  // Title - Executive focus
  pptx.addText({
    x: 0.50, y: 0.19, w: 12.33, h: 0.44,
    text: "Current PPP Position by Facility",
    fontSize: FONTS.slideTitle.size,
    bold: FONTS.slideTitle.bold,
    color: MANILA_WATER_COLORS.navyDark,
    fontFace: FONTS.slideTitle.face,
  });
  
  // Subtitle
  const today = new Date(reportingDate);
  const formattedDate = today.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
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
      fontSize: 11,
      bold: true,
      color: phase.textColor,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
    
    pptx.addText({
      x: x + 1.35, y: phaseHeaderY + 0.04, w: 1.80, h: 0.27,
      text: phase.desc,
      fontSize: 9,
      color: MANILA_WATER_COLORS.textDark,
      fontFace: "Arial",
      valign: "middle",
    });
  });
  
  // Timeline axis
  const timelineY = 5.8;
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
    
    // Tick mark
    pptx.addShape({
      x: x, y: timelineY - 0.05, w: 0.02, h: 0.12,
      fillColor: MANILA_WATER_COLORS.textGray,
    });
    
    // Tick label
    pptx.addText({
      x: x - 0.44, y: timelineY + 0.08, w: 0.88, h: 0.19,
      text: tick,
      fontSize: 8,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
  });
  
  // TODAY marker - prominent red indicator
  const todayX = tickXStart + 2 * tickXSpacing; // Position at JUL 2026
  pptx.addShape({
    x: todayX - 0.05, y: 1.5, w: 0.10, h: 4.4,
    fillColor: MANILA_WATER_COLORS.red,
  });
  
  const todayLabel = `TODAY ${today.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`;
  pptx.addText({
    x: todayX - 0.50, y: 1.5, w: 1.0, h: 0.22,
    text: todayLabel,
    fontSize: 9,
    bold: true,
    color: MANILA_WATER_COLORS.red,
    fontFace: "Arial",
    align: "center",
  });
  
  // Facility timeline rows
  let facilityY = 2.0;
  const facilityRowHeight = 0.95;
  
  facilities.forEach((facility) => {
    // Timeline bar background (light gray)
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
    
    // PPP Start marker
    const pppDate = new Date(facility.pppStartDate);
    const monthsSince2025 = (pppDate.getFullYear() - 2025) * 12 + pppDate.getMonth();
    const pppOffset = Math.max(0, monthsSince2025 - 6) / 6; // Approximate positioning
    const pppX = tickXStart + pppOffset * tickXSpacing;
    
    // PPP Start label
    const pppFormatted = pppDate.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase();
    pptx.addText({
      x: 0.50, y: facilityY + 0.28, w: 2.19, h: 0.20,
      text: `PPP: ${pppFormatted}`,
      fontSize: 9,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: "Arial",
    });
    
    // PPP Start marker (triangle)
    pptx.addShape({
      x: pppX - 0.08, y: facilityY + 0.22, w: 0.16, h: 0.20,
      fillColor: MANILA_WATER_COLORS.navyDark,
    });
    
    // Progress bar from PPP Start to Today
    const progressWidth = todayX - pppX;
    if (progressWidth > 0) {
      const progressColor = facility.phaseStatus.includes("RECOVERY") ? MANILA_WATER_COLORS.red :
                            facility.phaseStatus.includes("PPP") ? MANILA_WATER_COLORS.cyan :
                            MANILA_WATER_COLORS.green;
      
      pptx.addShape({
        x: pppX, y: facilityY + 0.25, w: progressWidth, h: 0.15,
        fillColor: progressColor,
      });
    }
    
    // Current status label
    const statusColor = facility.phaseStatus.includes("RECOVERY") ? MANILA_WATER_COLORS.red :
                        facility.phaseStatus.includes("PPP") ? MANILA_WATER_COLORS.cyan :
                        "397DA4";
    pptx.addText({
      x: todayX + 0.15, y: facilityY + 0.20, w: 2.50, h: 0.25,
      text: facility.phaseStatus,
      fontSize: 9,
      bold: true,
      color: statusColor,
      fontFace: "Arial",
    });
    
    // Milestone count indicator
    const completedMilestones = facility.milestones.filter(m => 
      m.status === "achieved" || m.status === "achieved_ahead"
    ).length;
    pptx.addText({
      x: todayX + 0.15, y: facilityY + 0.45, w: 2.50, h: 0.20,
      text: `${completedMilestones}/9 milestones`,
      fontSize: 8,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: "Arial",
    });
    
    facilityY += facilityRowHeight;
  });
  
  // Source note
  pptx.addText({
    x: 0.60, y: 7.05, w: 7.00, h: 0.18,
    text: `Sources: O&M Manual Governance module`,
    fontSize: FONTS.sourceNote.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.sourceNote.face,
  });
}


/**
 * Slide 3: Documentation Readiness
 * Portfolio compliance as primary visual focus
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
  const today = new Date();
  pptx.addText({
    x: 0.60, y: 7.05, w: 7.00, h: 0.18,
    text: `Sources: O&M Manual Governance module • IOM dated ${today.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" })}`,
    fontSize: FONTS.sourceNote.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.sourceNote.face,
  });
  
  // Portfolio Readiness - PRIMARY VISUAL FOCUS (large left side)
  const portfolioX = 0.56;
  const portfolioY = 1.2;
  const portfolioWidth = 4.5;
  const portfolioHeight = 2.8;
  
  // Portfolio box with prominence
  pptx.addShape({
    x: portfolioX, y: portfolioY, w: portfolioWidth, h: portfolioHeight,
    fillColor: MANILA_WATER_COLORS.rowBlue,
    lineColor: MANILA_WATER_COLORS.navy,
    lineWidth: 2,
  });
  
  // PORTFOLIO READINESS label
  pptx.addText({
    x: portfolioX + 0.2, y: portfolioY + 0.2, w: portfolioWidth - 0.4, h: 0.35,
    text: "PORTFOLIO READINESS",
    fontSize: FONTS.portfolioLabel.size,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  // Large percentage
  pptx.addText({
    x: portfolioX, y: portfolioY + 0.6, w: portfolioWidth, h: 1.2,
    text: `${summary.portfolioCompliancePercent}%`,
    fontSize: FONTS.portfolioPercent.size,
    bold: FONTS.portfolioPercent.bold,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
    align: "center",
    valign: "middle",
  });
  
  // Submitted count
  pptx.addText({
    x: portfolioX, y: portfolioY + 1.9, w: portfolioWidth, h: 0.35,
    text: `${summary.totalDocumentsSubmitted} of ${summary.totalDocumentsRequired} Deliverables Complete`,
    fontSize: 11,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: "Arial",
    align: "center",
  });
  
  // Legend
  pptx.addText({
    x: portfolioX, y: portfolioY + 2.4, w: portfolioWidth, h: 0.25,
    text: "✓ Submitted    |    — Missing",
    fontSize: 9,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: "Arial",
    align: "center",
  });
  
  // TOC Matrix table - reduced visual dominance (right side, smaller)
  const tableX = 5.5;
  const tableY = 1.2;
  const tableWidth = 7.3;
  
  // Legend above table
  pptx.addText({
    x: tableX, y: tableY - 0.3, w: tableWidth, h: 0.25,
    text: "Governance TOC Submission Matrix",
    fontSize: 10,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  const tableRows: Array<Array<{ text: string; options?: Record<string, string | number | boolean | undefined> }>> = [];
  
  // Header row
  const headerRow = [
    { text: "TOC", options: { bold: true, color: "FFFFFF", fill: MANILA_WATER_COLORS.navy, align: "center" } },
    ...facilities.map(f => ({ 
      text: f.shortName.toUpperCase().replace(" SEWAGE TREATMENT PLANT", "").replace(" TREATMENT PLANT", "").substring(0, 8), 
      options: { bold: true, color: "FFFFFF", fill: MANILA_WATER_COLORS.navy, align: "center" } 
    })),
  ];
  tableRows.push(headerRow);
  
  // TOC rows - show first 8 only for cleaner view
  GOVERNANCE_TOC_ITEMS.slice(0, 8).forEach(tocId => {
    const row = [
      { text: tocId, options: { align: "center", bold: true } },
      ...facilities.map(f => {
        const doc = facilityDocumentation.find(d => d.facilitySlug === f.slug);
        const submitted = doc?.submissions.find(s => s.tocId === tocId)?.submitted ?? false;
        return { 
          text: submitted ? "✓" : "—", 
          options: { 
            align: "center",
            color: submitted ? MANILA_WATER_COLORS.green : MANILA_WATER_COLORS.textGray,
            bold: submitted,
          } 
        };
      }),
    ];
    tableRows.push(row);
  });
  
  // Calculate column widths
  const colWidth = 1.2;
  const colWidths = [0.7, ...facilities.map(() => colWidth)];
  
  pptx.addTable({
    x: tableX, y: tableY, w: tableWidth, h: 3.5,
    rows: tableRows,
    colWidths: colWidths,
    fontSize: 10,
    borderColor: MANILA_WATER_COLORS.border,
    headerFill: MANILA_WATER_COLORS.navy,
  });
  
  // Facility compliance boxes (below portfolio, right side)
  const boxX = 5.5;
  let boxY = 4.8;
  const boxWidth = 1.75;
  const boxHeight = 0.60;
  
  // Header for facility compliance
  pptx.addText({
    x: boxX, y: boxY - 0.35, w: 4.0, h: 0.25,
    text: "Facility Compliance",
    fontSize: 10,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  // Facility boxes - 2x2 grid
  facilityDocumentation.forEach((doc, index) => {
    const facility = facilities.find(f => f.slug === doc.facilitySlug);
    if (!facility) return;
    
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = boxX + col * (boxWidth + 0.1);
    const y = boxY + row * (boxHeight + 0.1);
    
    const color = doc.compliancePercent >= 70 ? MANILA_WATER_COLORS.rowGreen :
                  doc.compliancePercent >= 40 ? MANILA_WATER_COLORS.rowBlue :
                  MANILA_WATER_COLORS.rowRed;
    
    pptx.addShape({
      x: x, y: y, w: boxWidth, h: boxHeight,
      fillColor: color,
      lineColor: MANILA_WATER_COLORS.border,
    });
    
    pptx.addText({
      x: x + 0.08, y: y + 0.06, w: boxWidth - 0.16, h: 0.18,
      text: facility.shortName.toUpperCase().replace(" SEWAGE TREATMENT PLANT", "").substring(0, 12),
      fontSize: 8,
      bold: true,
      color: MANILA_WATER_COLORS.navy,
      fontFace: "Arial",
    });
    
    pptx.addText({
      x: x + 0.08, y: y + 0.28, w: boxWidth - 0.16, h: 0.22,
      text: `${doc.compliancePercent}%`,
      fontSize: 14,
      bold: true,
      color: MANILA_WATER_COLORS.navy,
      fontFace: "Arial",
    });
  });
  
  // Executive Observation box - full width below
  const obsY = 6.0;
  const obsWidth = 12.3;
  
  pptx.addShape({
    x: portfolioX, y: obsY, w: obsWidth, h: 0.85,
    fillColor: MANILA_WATER_COLORS.rowBlue,
    lineColor: MANILA_WATER_COLORS.border,
  });
  
  pptx.addText({
    x: portfolioX + 0.12, y: obsY + 0.08, w: obsWidth - 0.24, h: 0.20,
    text: "EXECUTIVE OBSERVATION",
    fontSize: 9,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  pptx.addText({
    x: portfolioX + 0.12, y: obsY + 0.32, w: obsWidth - 0.24, h: 0.45,
    text: executive.portfolioObservation,
    fontSize: 10,
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
