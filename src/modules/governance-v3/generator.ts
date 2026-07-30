/**
 * Governance V3 Presentation Generator
 * Creates exact Manila Water template reproduction using pptxgenjs
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

// Status symbol configuration - exact from template
const STATUS_SYMBOLS: Record<MilestoneStatus, { symbol: string; color: string; bgColor: string }> = {
  achieved: { symbol: "✓", color: MANILA_WATER_COLORS.white, bgColor: "169873" },
  achieved_ahead: { symbol: "✓", color: MANILA_WATER_COLORS.white, bgColor: "007DA7" },
  gap: { symbol: "!", color: MANILA_WATER_COLORS.red, bgColor: "FDECEF" },
  upcoming: { symbol: "", color: MANILA_WATER_COLORS.textGray, bgColor: "EEF2F5" },
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
    text: `${executive.subtitle} | Red marker = TODAY ${formattedDate}`,
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
    
    // Milestone name
    pptx.addText({
      x: x - 0.05, y: milestoneNameY, w: 0.95, h: 0.51,
      text: definition.name.replace(/\s/g, "\n"),
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
  
  // Legend
  const legendY = 6.0;
  pptx.addText({
    x: 2.82, y: legendY, w: 9.72, h: 0.28,
    text: "✓      Achieved as planned                          ✓      Achieved ahead of plan                          !       Planned by now—still open                          ✓      Upcoming milestone",
    fontSize: FONTS.legend.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.legend.face,
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
 * Slide 2: Timeline View
 */
function generateSlide2(pptx: GovernancePPTX, data: GovernanceV3Presentation): void {
  pptx.addSlide();
  
  const { facilities, executive, reportingDate } = data;
  
  // Title
  pptx.addText({
    x: 0.50, y: 0.19, w: 12.33, h: 0.44,
    text: "Today's position is explicit against every facility's PPP start date",
    fontSize: FONTS.slideTitle.size,
    bold: FONTS.slideTitle.bold,
    color: MANILA_WATER_COLORS.navyDark,
    fontFace: FONTS.slideTitle.face,
  });
  
  // Subtitle
  const today = new Date(reportingDate);
  const formattedDate = today.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  pptx.addText({
    x: 0.52, y: 0.62, w: 7.81, h: 0.25,
    text: `Calendar-based phase timeline | ${formattedDate}`,
    fontSize: FONTS.slideSubtitle.size,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: FONTS.slideSubtitle.face,
  });
  
  // Phase headers
  const phaseHeaderY = 1.07;
  const phases = [
    { label: "PRE-PPP", desc: "Commissioning readiness", color: MANILA_WATER_COLORS.rowBlue, textColor: "397DA4" },
    { label: "PPP", desc: "Execution and capability", color: MANILA_WATER_COLORS.rowCyan, textColor: MANILA_WATER_COLORS.cyan },
    { label: "POST-PPP", desc: "Sustainment and BAU", color: MANILA_WATER_COLORS.rowGreen, textColor: MANILA_WATER_COLORS.green },
  ];
  
  phases.forEach((phase, i) => {
    const x = 0.65 + i * 4.06;
    
    pptx.addShape({
      x: x, y: phaseHeaderY, w: 1.46, h: 0.31,
      fillColor: phase.color,
    });
    
    pptx.addText({
      x: x, y: phaseHeaderY + 0.02, w: 1.46, h: 0.27,
      text: phase.label,
      fontSize: 11,
      bold: true,
      color: phase.textColor,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
    
    pptx.addText({
      x: x + 1.41, y: phaseHeaderY + 0.04, w: 2.02, h: 0.27,
      text: phase.desc,
      fontSize: 9,
      color: MANILA_WATER_COLORS.textDark,
      fontFace: "Arial",
      valign: "middle",
    });
  });
  
  // Timeline ticks
  const timelineY = 5.58;
  const tickXStart = 2.38;
  const tickXSpacing = 1.61;
  const ticks = ["JUL 2025", "JAN 2026", "JUL 2026", "JAN 2027", "JUL 2027", "JAN 2028", "MAY 2028"];
  
  ticks.forEach((tick, i) => {
    pptx.addShape({
      x: tickXStart + i * tickXSpacing, y: timelineY, w: 0.88, h: 0.19,
      fillColor: MANILA_WATER_COLORS.border,
    });
    
    pptx.addText({
      x: tickXStart + i * tickXSpacing, y: timelineY, w: 0.88, h: 0.19,
      text: tick,
      fontSize: 8,
      color: MANILA_WATER_COLORS.textGray,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
  });
  
  // Today marker
  const todayX = 5.66; // Approximate position for JUL 2026
  pptx.addShape({
    x: todayX, y: 1.69, w: 1.21, h: 0.25,
    fillColor: MANILA_WATER_COLORS.red,
  });
  
  const todayLabel = `TODAY • ${today.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}`;
  pptx.addText({
    x: todayX, y: 1.69, w: 1.21, h: 0.25,
    text: todayLabel,
    fontSize: 9,
    bold: true,
    color: MANILA_WATER_COLORS.white,
    fontFace: "Arial",
    align: "center",
    valign: "middle",
  });
  
  // Facility timeline rows
  let facilityY = 2.36;
  const facilityRowHeight = 0.84;
  
  facilities.forEach((facility) => {
    // Facility name
    pptx.addText({
      x: 0.50, y: facilityY, w: 2.14, h: 0.25,
      text: facility.shortName.toUpperCase(),
      fontSize: FONTS.facilityName.size,
      bold: FONTS.facilityName.bold,
      color: MANILA_WATER_COLORS.navyDark,
      fontFace: FONTS.facilityName.face,
    });
    
    // Today status
    const todayStatusColor = facility.phaseStatus.includes("RECOVERY") ? MANILA_WATER_COLORS.red :
                              facility.phaseStatus.includes("PPP") ? MANILA_WATER_COLORS.cyan :
                              "397DA4";
    pptx.addText({
      x: 0.50, y: facilityY + 0.28, w: 2.19, h: 0.38,
      text: `TODAY: ${facility.phaseStatus}`,
      fontSize: FONTS.facilityPhase.size,
      color: todayStatusColor,
      fontFace: FONTS.facilityPhase.face,
    });
    
    // PPP Start marker
    const pppDate = new Date(facility.pppStartDate);
    const pppFormatted = pppDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
    
    // Calculate X position based on date (simplified)
    const pppX = facility.pppStartDate.startsWith("2025-03") ? 2.45 :
                   facility.pppStartDate.startsWith("2026-09") ? 6.68 : 4.0;
    
    pptx.addShape({
      x: pppX, y: facilityY - 0.32, w: 2.50, h: 0.25,
      fillColor: MANILA_WATER_COLORS.navyDark,
    });
    
    pptx.addText({
      x: pppX, y: facilityY - 0.32, w: 2.50, h: 0.25,
      text: `PPP START • ${pppFormatted}`,
      fontSize: 9,
      color: MANILA_WATER_COLORS.white,
      fontFace: "Arial",
      align: "center",
      valign: "middle",
    });
    
    // Phase bar (simplified representation)
    const phaseBarColor = facility.currentPhase === "PRE-PPP" ? MANILA_WATER_COLORS.cyan :
                         facility.currentPhase === "PPP" ? MANILA_WATER_COLORS.cyan :
                         MANILA_WATER_COLORS.green;
    
    pptx.addShape({
      x: 2.45, y: facilityY + 0.15, w: 3.0, h: 0.15,
      fillColor: phaseBarColor,
    });
    
    facilityY += facilityRowHeight;
  });
  
  // Gate Implication section
  pptx.addShape({
    x: 0.50, y: 6.25, w: 12.33, h: 0.49,
    fillColor: "FDECEF",
  });
  
  pptx.addText({
    x: 0.69, y: 6.32, w: 1.98, h: 0.29,
    text: "GATE IMPLICATION",
    fontSize: FONTS.calloutLabel.size,
    bold: FONTS.calloutLabel.bold,
    color: MANILA_WATER_COLORS.red,
    fontFace: FONTS.calloutLabel.face,
  });
  
  pptx.addText({
    x: 2.58, y: 6.25, w: 9.75, h: 0.49,
    text: executive.gateImplication,
    fontSize: FONTS.calloutText.size,
    color: MANILA_WATER_COLORS.textDark,
    fontFace: FONTS.calloutText.face,
  });
}

/**
 * Slide 3: Documentation Matrix
 */
function generateSlide3(pptx: GovernancePPTX, data: GovernanceV3Presentation): void {
  pptx.addSlide();
  
  const { facilities, facilityDocumentation, summary, executive } = data;
  
  // Title
  pptx.addText({
    x: 0.62, y: 0.33, w: 11.46, h: 0.48,
    text: executive.documentationHeadline,
    fontSize: FONTS.slideTitle.size,
    bold: FONTS.slideTitle.bold,
    color: "071B3D",
    fontFace: FONTS.slideTitle.face,
  });
  
  // Subtitle
  pptx.addText({
    x: 0.66, y: 0.81, w: 11.67, h: 0.30,
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
  
  // Legend
  pptx.addText({
    x: 0.56, y: 1.12, w: 8.50, h: 0.26,
    text: "✓ Submitted = at least one uploaded document for the TOC row    |    — Missing = no submitted documents",
    fontSize: 9,
    color: MANILA_WATER_COLORS.textGray,
    fontFace: "Arial",
  });
  
  // TOC Matrix table
  const tableY = 1.50;
  const tableRows: Array<Array<{ text: string; options?: Record<string, string | number | boolean | undefined> }>> = [];
  
  // Header row
  const headerRow = [
    { text: "TOC", options: { bold: true, color: "FFFFFF", fill: MANILA_WATER_COLORS.navy } },
    ...facilities.map(f => ({ 
      text: f.shortName.toUpperCase(), 
      options: { bold: true, color: "FFFFFF", fill: MANILA_WATER_COLORS.navy } 
    })),
  ];
  tableRows.push(headerRow);
  
  // TOC rows
  GOVERNANCE_TOC_ITEMS.forEach(tocId => {
    const row = [
      { text: tocId, options: { align: "center" } },
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
  const colWidths = [0.8, ...facilities.map(() => colWidth)];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  
  pptx.addTable({
    x: 0.56, y: tableY, w: tableWidth, h: 3.8,
    rows: tableRows,
    colWidths: colWidths,
    fontSize: 9,
    borderColor: MANILA_WATER_COLORS.border,
    headerFill: MANILA_WATER_COLORS.navy,
  });
  
  // Compliance summary boxes (right side)
  const boxX = 9.31;
  let boxY = 1.48;
  const boxWidth = 3.40;
  const boxHeight = 0.79;
  
  // Portfolio box
  pptx.addShape({
    x: boxX, y: boxY, w: boxWidth, h: boxHeight,
    fillColor: MANILA_WATER_COLORS.rowBlue,
    lineColor: MANILA_WATER_COLORS.border,
  });
  
  pptx.addText({
    x: boxX + 0.1, y: boxY + 0.1, w: boxWidth - 0.2, h: 0.25,
    text: "PORTFOLIO",
    fontSize: 10,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  pptx.addText({
    x: boxX + 0.1, y: boxY + 0.35, w: boxWidth - 0.2, h: 0.35,
    text: `${summary.totalDocumentsSubmitted} / ${summary.totalDocumentsRequired}  •  ${summary.portfolioCompliancePercent}%`,
    fontSize: 14,
    bold: true,
    color: MANILA_WATER_COLORS.navy,
    fontFace: "Arial",
  });
  
  boxY += boxHeight + 0.05;
  
  // Facility boxes
  facilityDocumentation.forEach(doc => {
    const facility = facilities.find(f => f.slug === doc.facilitySlug);
    if (!facility) return;
    
    const color = doc.compliancePercent >= 70 ? MANILA_WATER_COLORS.rowGreen :
                  doc.compliancePercent >= 40 ? MANILA_WATER_COLORS.rowBlue :
                  MANILA_WATER_COLORS.rowRed;
    
    pptx.addShape({
      x: boxX, y: boxY, w: boxWidth, h: 0.64,
      fillColor: color,
      lineColor: MANILA_WATER_COLORS.border,
    });
    
    pptx.addText({
      x: boxX + 0.1, y: boxY + 0.08, w: boxWidth - 0.2, h: 0.20,
      text: facility.shortName.toUpperCase(),
      fontSize: 9,
      bold: true,
      color: MANILA_WATER_COLORS.navy,
      fontFace: "Arial",
    });
    
    pptx.addText({
      x: boxX + 0.1, y: boxY + 0.30, w: boxWidth - 0.2, h: 0.25,
      text: `${doc.submittedCount} / ${doc.requiredCount}  •  ${doc.compliancePercent}%`,
      fontSize: 12,
      bold: true,
      color: MANILA_WATER_COLORS.navy,
      fontFace: "Arial",
    });
    
    boxY += 0.69;
  });
  
  // Executive Observation box
  const obsY = 5.42;
  pptx.addShape({
    x: boxX, y: obsY, w: boxWidth, h: 1.02,
    fillColor: MANILA_WATER_COLORS.rowBlue,
    lineColor: MANILA_WATER_COLORS.border,
  });
  
  pptx.addText({
    x: boxX + 0.1, y: obsY + 0.1, w: boxWidth - 0.2, h: 0.82,
    text: `EXECUTIVE OBSERVATION\n${executive.portfolioObservation}`,
    fontSize: 9,
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
