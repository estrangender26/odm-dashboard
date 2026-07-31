/**
 * Manila Water Theme Specification
 * Extracted from Onboarding Status.pptx
 * EXECUTIVE POLISH: Minimum 12pt body text
 */

// Color Palette - exact hex values from reference
export const MANILA_WATER_COLORS = {
  // Primary Brand Colors
  navy: "17324F",
  navyDark: "08264C",
  navyDarker: "071B3D",
  red: "E63950",
  green: "169873",
  cyan: "00A9C5",
  
  // Background Colors
  bgLight: "EEF2F5",
  bgLighter: "F4F7F9",
  
  // Table Row Colors
  rowBlue: "DDEBF4",
  rowCyan: "DDF5F9",
  rowGreen: "DFF3EC",
  rowRed: "FDECEF",
  rowYellow: "FFF6DF",
  
  // Text Colors
  textDark: "17324F",
  textGray: "60758A",
  textLight: "66758A",
  
  // Utility
  white: "FFFFFF",
  border: "D3DEE8",
} as const;

// Slide Dimensions - exact from reference: 13.33 x 7.5 inches
export const SLIDE_DIMENSIONS = {
  width: 13.33,
  height: 7.5,
} as const;

// Font Configuration - EXECUTIVE: Minimum 12pt for body content
export const FONTS = {
  slideTitle: { size: 28, bold: true, color: MANILA_WATER_COLORS.navy, face: "Arial" },
  slideSubtitle: { size: 14, color: MANILA_WATER_COLORS.textGray, face: "Arial" },
  phaseHeader: { size: 12, bold: true, color: MANILA_WATER_COLORS.white, face: "Arial" },
  milestoneCode: { size: 12, bold: true, color: MANILA_WATER_COLORS.navy, face: "Arial" },
  milestoneName: { size: 11, color: MANILA_WATER_COLORS.textDark, face: "Arial" },
  facilityName: { size: 13, bold: true, color: MANILA_WATER_COLORS.navy, face: "Arial" },
  facilityPhase: { size: 12, color: MANILA_WATER_COLORS.textGray, face: "Arial" },
  facilityDetail: { size: 11, color: MANILA_WATER_COLORS.textGray, face: "Arial" },
  statusSymbol: { size: 14, bold: true, face: "Arial" },
  observation: { size: 11, color: MANILA_WATER_COLORS.textDark, face: "Arial" },
  legend: { size: 12, color: MANILA_WATER_COLORS.textGray, face: "Arial" },
  calloutLabel: { size: 12, bold: true, color: MANILA_WATER_COLORS.navy, face: "Arial" },
  calloutText: { size: 12, color: MANILA_WATER_COLORS.textDark, face: "Arial" },
  tableHeader: { size: 12, bold: true, color: MANILA_WATER_COLORS.white, face: "Arial" },
  tableCell: { size: 12, color: MANILA_WATER_COLORS.textDark, face: "Arial" },
  sourceNote: { size: 10, color: MANILA_WATER_COLORS.textGray, face: "Arial" },
  portfolioPercent: { size: 48, bold: true, color: MANILA_WATER_COLORS.navy, face: "Arial" },
  portfolioLabel: { size: 14, color: MANILA_WATER_COLORS.textGray, face: "Arial" },
} as const;

// Layout Spacing
export const LAYOUT = {
  margin: { left: 0.5, right: 0.5, top: 0.2, bottom: 0.3 },
  header: { height: 0.8 },
  facilityRow: { height: 1.0 },
  phaseBand: { y: 1.0, height: 0.4 },
  milestoneY: 1.5,
  milestoneNameY: 1.7,
  firstFacilityY: 2.4,
  legendY: 6.0,
  nextGateY: 6.7,
} as const;

// Phase Configuration
export const PHASES = {
  PRE_PPP: { 
    label: "PRE-PPP", 
    description: "Commissioning",
    color: MANILA_WATER_COLORS.cyan,
  },
  PPP: { 
    label: "PPP", 
    description: "Execution",
    color: MANILA_WATER_COLORS.navy,
  },
  POST_PPP: { 
    label: "POST-PPP", 
    description: "Sustainment",
    color: MANILA_WATER_COLORS.green,
  },
} as const;

// Milestone Definitions - as requested for no wrapping
export const MILESTONES = {
  M1: { name: "T&C Complete", phase: "PRE-PPP" },
  M2: { name: "Commissioning", phase: "PRE-PPP" },
  M3: { name: "Punchlist Closed", phase: "PRE-PPP" },
  M4: { name: "PM Setup", phase: "PPP" },
  M5: { name: "PM Execution", phase: "PPP" },
  M6: { name: "Training", phase: "PPP" },
  M7: { name: "Optimization", phase: "POST-PPP" },
  M8: { name: "SLA Active", phase: "POST-PPP" },
  M9: { name: "BAU Ready", phase: "POST-PPP" },
} as const;

export type MilestoneCode = keyof typeof MILESTONES;

// Milestone X positions - wider spacing
export const MILESTONE_X_POSITIONS = [2.75, 3.85, 4.95, 6.05, 7.15, 8.25, 9.35, 10.45, 11.55];

// TOC Items for Documentation Matrix
export const GOVERNANCE_TOC_ITEMS = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14",
] as const;

// Timeline Configuration
export const TIMELINE = {
  y: 5.6,
  ticks: ["JUL 2025", "JAN 2026", "JUL 2026", "JAN 2027", "JUL 2027", "JAN 2028", "MAY 2028"],
  tickXStart: 2.4,
  tickXSpacing: 1.6,
} as const;

/**
 * Facility color rotation based on index
 */
export function getFacilityColor(index: number): string {
  const colors = [
    "f97316", // orange
    "3b82f6", // blue
    "10b981", // green
    "8b5cf6", // purple
  ];
  return colors[index % colors.length];
}
