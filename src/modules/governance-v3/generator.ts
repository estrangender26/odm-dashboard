/**
 * Governance V3 Presentation Generator
 * Generates 3-slide Manila Water branded presentation using pptxBuilder
 */

import { createPresentation } from "../presentation-center/pptxBuilder";
import type { GovernanceV3Presentation } from "./types";
import { MANILA_WATER_COLORS, MILESTONES, GOVERNANCE_TOC_ITEMS } from "./theme";
import type { MilestoneCode } from "./theme";

// Slide element types matching pptxBuilder
type SlideElement =
  | { type: "text"; text: string; x: number; y: number; w: number; h: number; fontSize?: number; fontFace?: string; bold?: boolean; color?: string; fill?: string; align?: "l" | "ctr" | "r" }
  | { type: "shape"; x: number; y: number; w: number; h: number; fill: string; line?: string }
  | { type: "table"; rows: string[][]; cellFills?: (string | undefined)[][]; cellColors?: (string | undefined)[][]; cellBold?: (boolean | undefined)[][]; colWidths?: number[]; rowHeights?: number[]; x: number; y: number; w: number; h: number; fontSize?: number; fontFace?: string };

type Slide = { elements: SlideElement[]; notes?: string };

// Helper to convert hex to pptxBuilder format (without FF prefix)
function hexColor(hex: string): string {
  return hex.startsWith("FF") ? hex.slice(2) : hex;
}

function hexFill(hex: string): string {
  return hex.startsWith("FF") ? hex.slice(2) : hex;
}

function createSlide1(data: GovernanceV3Presentation): Slide {
  const elements: SlideElement[] = [];
  
  // Background color
  elements.push({
    type: "shape",
    x: 0, y: 0, w: 13.33, h: 7.5,
    fill: hexFill(MANILA_WATER_COLORS.bgLighter),
  });
  
  // Title
  elements.push({
    type: "text",
    text: data.executive.headline,
    x: 0.5, y: 0.2, w: 12.33, h: 0.5,
    fontSize: 28, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial",
  });
  
  // Subtitle
  elements.push({
    type: "text",
    text: data.executive.subtitle,
    x: 0.5, y: 0.6, w: 12.33, h: 0.3,
    fontSize: 12, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial",
  });
  
  // Phase headers
  const phaseY = 1.0;
  const phaseWidth = 3.0;
  
  elements.push({ type: "shape", x: 2.9, y: phaseY, w: phaseWidth, h: 0.4, fill: hexFill(MANILA_WATER_COLORS.cyan) });
  elements.push({ type: "text", text: "PRE-PPP  •  Commissioning readiness", x: 2.9, y: phaseY + 0.05, w: phaseWidth, h: 0.3, fontSize: 11, bold: true, color: "FFFFFF", align: "ctr", fontFace: "Arial" });
  
  elements.push({ type: "shape", x: 6.2, y: phaseY, w: phaseWidth, h: 0.4, fill: hexFill(MANILA_WATER_COLORS.navy) });
  elements.push({ type: "text", text: "PPP  •  Execution and capability", x: 6.2, y: phaseY + 0.05, w: phaseWidth, h: 0.3, fontSize: 11, bold: true, color: "FFFFFF", align: "ctr", fontFace: "Arial" });
  
  elements.push({ type: "shape", x: 9.5, y: phaseY, w: phaseWidth, h: 0.4, fill: hexFill(MANILA_WATER_COLORS.green) });
  elements.push({ type: "text", text: "POST-PPP  •  Sustainment and BAU", x: 9.5, y: phaseY + 0.05, w: phaseWidth, h: 0.3, fontSize: 11, bold: true, color: "FFFFFF", align: "ctr", fontFace: "Arial" });
  
  // Milestone headers
  const milestoneX = [2.8, 3.9, 5.0, 6.1, 7.2, 8.3, 9.4, 10.5, 11.6];
  const milestoneCodes: MilestoneCode[] = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"];
  
  milestoneCodes.forEach((code, i) => {
    const x = milestoneX[i];
    const config = MILESTONES[code];
    elements.push({ type: "text", text: code, x: x, y: 1.5, w: 0.8, h: 0.2, fontSize: 10, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), align: "ctr", fontFace: "Arial" });
    const nameParts = config.name.split(" ");
    const mid = Math.ceil(nameParts.length / 2);
    const line1 = nameParts.slice(0, mid).join(" ");
    const line2 = nameParts.slice(mid).join(" ");
    elements.push({ type: "text", text: line1 + "\\n" + line2, x: x - 0.1, y: 1.7, w: 1.0, h: 0.4, fontSize: 8, color: hexColor(MANILA_WATER_COLORS.textGray), align: "ctr", fontFace: "Arial" });
  });
  
  // Facility rows
  let facilityY = 2.4;
  data.facilities.forEach((facility) => {
    elements.push({ type: "text", text: facility.shortName, x: 0.7, y: facilityY, w: 2.0, h: 0.2, fontSize: 11, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
    elements.push({ type: "text", text: facility.phaseStatus, x: 0.7, y: facilityY + 0.2, w: 2.0, h: 0.2, fontSize: 9, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
    const pppDate = new Date(facility.pppStartDate).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
    elements.push({ type: "text", text: "PPP START  " + pppDate, x: 0.7, y: facilityY + 0.4, w: 2.0, h: 0.2, fontSize: 8, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
    
    facility.milestones.forEach((m, mi) => {
      const x = milestoneX[mi];
      let symbol = "";
      let color = "";
      switch (m.status) {
        case "achieved": symbol = "✓"; color = hexColor(MANILA_WATER_COLORS.navy); break;
        case "achieved_ahead": symbol = "✓"; color = hexColor(MANILA_WATER_COLORS.green); break;
        case "gap": symbol = "!"; color = hexColor(MANILA_WATER_COLORS.red); break;
        case "upcoming": symbol = "○"; color = hexColor(MANILA_WATER_COLORS.textGray); break;
      }
      elements.push({ type: "text", text: symbol, x: x, y: facilityY + 0.2, w: 0.8, h: 0.3, fontSize: 8, bold: true, color: color, align: "ctr", fontFace: "Arial" });
    });
    
    elements.push({ type: "text", text: facility.executiveObservation, x: 2.8, y: facilityY + 0.5, w: 9.5, h: 0.2, fontSize: 9, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
    
    facilityY += 0.8;
  });
  
  // Legend
  const legendY = 6.0;
  const legendItems = [
    { symbol: "✓", text: "Achieved as planned", color: hexColor(MANILA_WATER_COLORS.navy) },
    { symbol: "!", text: "Planned by now—still open", color: hexColor(MANILA_WATER_COLORS.red) },
    { symbol: "✓", text: "Achieved ahead of plan", color: hexColor(MANILA_WATER_COLORS.green) },
    { symbol: "○", text: "Upcoming milestone", color: hexColor(MANILA_WATER_COLORS.textGray) },
  ];
  let legendX = 0.7;
  legendItems.forEach((item) => {
    elements.push({ type: "text", text: item.symbol, x: legendX, y: legendY, w: 0.5, h: 0.2, fontSize: 8, bold: true, color: item.color, fontFace: "Arial" });
    elements.push({ type: "text", text: item.text, x: legendX + 0.5, y: legendY, w: 2.0, h: 0.2, fontSize: 9, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
    legendX += 2.8;
  });
  
  // Next Gate
  elements.push({ type: "text", text: "NEXT GATE", x: 0.7, y: 6.7, w: 1.2, h: 0.2, fontSize: 10, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  elements.push({ type: "text", text: data.executive.nextGateAction, x: 1.9, y: 6.6, w: 10, h: 0.4, fontSize: 11, color: hexColor(MANILA_WATER_COLORS.textDark), fontFace: "Arial" });
  
  return { elements };
}

function createSlide2(data: GovernanceV3Presentation): Slide {
  const elements: SlideElement[] = [];
  
  // Background
  elements.push({ type: "shape", x: 0, y: 0, w: 13.33, h: 7.5, fill: hexFill(MANILA_WATER_COLORS.bgLighter) });
  
  // Title
  elements.push({ type: "text", text: "Today's position is explicit against every facility's PPP start", x: 0.5, y: 0.2, w: 12.33, h: 0.5, fontSize: 28, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  elements.push({ type: "text", text: data.executive.timelineSubtitle, x: 0.5, y: 0.6, w: 12.33, h: 0.3, fontSize: 12, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
  
  // Phase legend
  const phaseY = 1.1;
  elements.push({ type: "shape", x: 0.7, y: phaseY, w: 0.4, h: 0.25, fill: hexFill(MANILA_WATER_COLORS.cyan) });
  elements.push({ type: "text", text: "PRE-PPP", x: 1.2, y: phaseY, w: 0.8, h: 0.25, fontSize: 10, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  elements.push({ type: "text", text: "Commissioning readiness", x: 2.1, y: phaseY + 0.05, w: 2.0, h: 0.2, fontSize: 9, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
  
  elements.push({ type: "shape", x: 4.7, y: phaseY, w: 0.4, h: 0.25, fill: hexFill(MANILA_WATER_COLORS.navy) });
  elements.push({ type: "text", text: "PPP", x: 5.2, y: phaseY, w: 0.5, h: 0.25, fontSize: 10, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  elements.push({ type: "text", text: "Execution and capability", x: 6.1, y: phaseY + 0.05, w: 2.0, h: 0.2, fontSize: 9, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
  
  elements.push({ type: "shape", x: 8.8, y: phaseY, w: 0.4, h: 0.25, fill: hexFill(MANILA_WATER_COLORS.green) });
  elements.push({ type: "text", text: "POST-PPP", x: 9.3, y: phaseY, w: 0.8, h: 0.25, fontSize: 10, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  elements.push({ type: "text", text: "Sustainment and BAU", x: 10.2, y: phaseY + 0.05, w: 2.0, h: 0.2, fontSize: 9, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
  
  // Timeline axis
  const timelineY = 5.6;
  const ticks = ["JUL 2025", "JAN 2026", "JUL 2026", "JAN 2027", "JUL 2027", "JAN 2028", "MAY 2028"];
  let tickX = 2.4;
  ticks.forEach((tick) => {
    elements.push({ type: "text", text: tick, x: tickX, y: timelineY, w: 1.0, h: 0.2, fontSize: 8, color: hexColor(MANILA_WATER_COLORS.textGray), align: "ctr", fontFace: "Arial" });
    tickX += 1.6;
  });
  
  // Today marker
  const todayX = 5.7;
  elements.push({ type: "shape", x: todayX, y: 1.7, w: 1.2, h: 0.25, fill: hexFill(MANILA_WATER_COLORS.red) });
  const todayLabel = "TODAY • " + new Date(data.reportingDate).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  elements.push({ type: "text", text: todayLabel, x: todayX, y: 1.75, w: 1.2, h: 0.2, fontSize: 8, bold: true, color: "FFFFFF", align: "ctr", fontFace: "Arial" });
  
  // Facility timeline rows
  let facilityY = 2.4;
  data.facilities.forEach((facility) => {
    elements.push({ type: "text", text: facility.shortName, x: 0.5, y: facilityY, w: 2.0, h: 0.2, fontSize: 11, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
    elements.push({ type: "text", text: "TODAY: " + facility.phaseStatus, x: 0.5, y: facilityY + 0.2, w: 2.5, h: 0.2, fontSize: 9, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
    
    const pppDate = new Date(facility.pppStartDate);
    const pppLabel = "PPP START • " + pppDate.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
    elements.push({ type: "text", text: pppLabel, x: 2.5, y: facilityY - 0.4, w: 1.5, h: 0.2, fontSize: 8, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
    
    facilityY += 0.8;
  });
  
  // Gate Implication
  elements.push({ type: "text", text: "GATE IMPLICATION", x: 0.7, y: 6.3, w: 1.8, h: 0.2, fontSize: 10, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  elements.push({ type: "text", text: data.executive.gateImplication, x: 2.6, y: 6.2, w: 10, h: 0.4, fontSize: 11, color: hexColor(MANILA_WATER_COLORS.textDark), fontFace: "Arial" });
  
  return { elements };
}

function createSlide3(data: GovernanceV3Presentation): Slide {
  const elements: SlideElement[] = [];
  
  // Background
  elements.push({ type: "shape", x: 0, y: 0, w: 13.33, h: 7.5, fill: hexFill(MANILA_WATER_COLORS.bgLighter) });
  
  // Title
  elements.push({ type: "text", text: data.executive.documentationHeadline, x: 0.6, y: 0.3, w: 12, h: 0.5, fontSize: 28, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  elements.push({ type: "text", text: data.executive.documentationSubtitle, x: 0.7, y: 0.8, w: 11, h: 0.3, fontSize: 12, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
  elements.push({ type: "text", text: "✓ Submitted = at least one uploaded document for the TOC row    |    — Missing = no document uploaded", x: 0.6, y: 1.1, w: 11, h: 0.2, fontSize: 9, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
  
  // Documentation matrix table
  const tableRows: string[][] = [];
  const headerRow = ["TOC", ...data.facilities.map(f => f.shortName.split(" ")[0].toUpperCase())];
  tableRows.push(headerRow);
  
  GOVERNANCE_TOC_ITEMS.forEach((tocId: string) => {
    const row = [tocId];
    data.facilityDocumentation.forEach((doc) => {
      const submission = doc.submissions.find(s => s.tocId === tocId);
      row.push(submission?.submitted ? "✓" : "—");
    });
    tableRows.push(row);
  });
  
  elements.push({
    type: "table",
    rows: tableRows,
    x: 0.6, y: 1.4, w: 8.5, h: 4.5,
    fontSize: 9,
    colWidths: [0.8, ...data.facilities.map(() => 1.5)],
    cellFills: tableRows.map((_, ri) => headerRow.map(() => ri === 0 ? hexFill(MANILA_WATER_COLORS.navy) : undefined)),
    cellColors: tableRows.map((_, ri) => headerRow.map(() => ri === 0 ? "FFFFFF" : undefined)),
    cellBold: tableRows.map((_, ri) => headerRow.map(() => ri === 0)),
  });
  
  // Compliance bars on the right
  let complianceY = 1.5;
  const portfolio = data.summary;
  elements.push({ type: "text", text: "PORTFOLIO\\n" + portfolio.totalDocumentsSubmitted + " / " + portfolio.totalDocumentsRequired + "  •  " + portfolio.portfolioCompliancePercent + "%", x: 9.3, y: complianceY, w: 3.5, h: 0.8, fontSize: 11, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  complianceY += 0.9;
  
  data.facilityDocumentation.forEach((doc) => {
    const text = doc.facilityName.toUpperCase() + "\\n" + doc.submittedCount + " / " + doc.requiredCount + "  •  " + doc.compliancePercent + "%";
    elements.push({ type: "text", text: text, x: 9.3, y: complianceY, w: 3.5, h: 0.6, fontSize: 10, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
    complianceY += 0.7;
  });
  
  // Executive Observation
  elements.push({ type: "text", text: "EXECUTIVE OBSERVATION", x: 9.3, y: 5.4, w: 3.5, h: 0.3, fontSize: 10, bold: true, color: hexColor(MANILA_WATER_COLORS.navy), fontFace: "Arial" });
  elements.push({ type: "text", text: data.executive.portfolioObservation, x: 9.3, y: 5.8, w: 3.5, h: 1.2, fontSize: 10, color: hexColor(MANILA_WATER_COLORS.textDark), fontFace: "Arial" });
  
  // Source footer
  const today = new Date(data.reportingDate).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
  elements.push({ type: "text", text: "Sources: O\u0026M Manual Governance module • IOM dated 07 Jan 2026 • " + today, x: 0.6, y: 7.0, w: 12, h: 0.2, fontSize: 8, color: hexColor(MANILA_WATER_COLORS.textGray), fontFace: "Arial" });
  
  return { elements };
}

export async function generateGovernanceV3Presentation(data: GovernanceV3Presentation): Promise<Blob> {
  const slides: Slide[] = [
    createSlide1(data),
    createSlide2(data),
    createSlide3(data),
  ];
  return await createPresentation(slides);
}
