export const MANILA_WATER_COLORS = {
  navy: "17324F",
  navyDark: "08264C",
  navyDarker: "071B3D",
  red: "E63950",
  green: "169873",
  cyan: "00A9C5",
  bgLight: "EEF2F5",
  bgLighter: "F4F7F9",
  rowBlue: "DDEBF4",
  rowCyan: "DDF5F9",
  rowGreen: "DFF3EC",
  rowRed: "FDECEF",
  rowYellow: "FFF6DF",
  textDark: "17324F",
  textGray: "60758A",
  textLight: "66758A",
  white: "FFFFFF",
  border: "D3DEE8",
} as const;

export const SLIDE_DIMENSIONS = { width: 13.33, height: 7.5 } as const;

export const FONTS = {
  title: { size: 28, bold: true, color: MANILA_WATER_COLORS.navy },
  subtitle: { size: 12, color: MANILA_WATER_COLORS.textGray },
  phase: { size: 11, bold: true },
  milestoneCode: { size: 10, bold: true },
  milestoneName: { size: 8, color: MANILA_WATER_COLORS.textGray },
  facilityName: { size: 11, bold: true },
  facilityPhase: { size: 9 },
  facilityDetail: { size: 8, color: MANILA_WATER_COLORS.textGray },
  legend: { size: 9, color: MANILA_WATER_COLORS.textGray },
  body: { size: 12, color: MANILA_WATER_COLORS.textDark },
} as const;

export const MILESTONES = {
  M1: { name: "T&C check sheets complete", phase: "PRE-PPP" },
  M2: { name: "Wet/dry commissioning passed", phase: "PRE-PPP" },
  M3: { name: "Defects and punchlist closed", phase: "PRE-PPP" },
  M4: { name: "PM task lists in SAP-PM", phase: "PPP" },
  M5: { name: "PM/PdM execution started", phase: "PPP" },
  M6: { name: "Training completed", phase: "PPP" },
  M7: { name: "Plan refined using PPP learnings", phase: "POST-PPP" },
  M8: { name: "Contracts and SLAs activated", phase: "POST-PPP" },
  M9: { name: "BAU governance established", phase: "POST-PPP" },
} as const;

export type MilestoneCode = keyof typeof MILESTONES;

export const PHASES = {
  PRE_PPP: { label: "PRE-PPP", description: "Commissioning readiness", color: MANILA_WATER_COLORS.cyan },
  PPP: { label: "PPP", description: "Execution and capability", color: MANILA_WATER_COLORS.navy },
  POST_PPP: { label: "POST-PPP", description: "Sustainment and BAU", color: MANILA_WATER_COLORS.green },
} as const;

export const GOVERNANCE_TOC_ITEMS = [
  "1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"
] as const;

export const LAYOUT = {
  margin: { left: 0.5, right: 0.5, top: 0.2, bottom: 0.3 },
  header: { height: 0.8 },
  facilityRow: { height: 0.8 },
} as const;
