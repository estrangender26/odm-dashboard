/**
 * Governance Presentation Slide Master Design
 * Based on KPI PRES.pptx reference style
 */

export const GOVERNANCE_SLIDE_MASTER = {
  slide: {
    width: 13.333,  // inches (16:9 aspect ratio)
    height: 7.5,
  },
  // Dark navy header bar matching KPI PRES
  header: {
    height: 0.72,  // inches
    fill: "081C3D",  // Dark navy from KPI PRES
    textColor: "FFFFFF",
    fontSize: 18,
    fontBold: true,
    x: 0,
    y: 0,
  },
  // Clean white content area
  content: {
    x: 0.63,  // left margin
    y: 0.84,  // below header + spacing
    width: 12.07,  // 13.333 - 0.63 - 0.63
    height: 6.15,  // 7.5 - 0.72 - 0.21 (footer) - spacing
  },
  // Footer with source line
  footer: {
    height: 0.21,
    y: 7.19,  // near bottom
    textColor: "595959",
    fontSize: 9,
    lineColor: "CCD2D8",
  },
  // Page number
  pageNumber: {
    x: 12.5,
    y: 7.19,
    fontSize: 9,
    color: "595959",
  },
  // Typography
  typography: {
    title: {
      fontSize: 32,
      color: "081C3D",
      bold: true,
    },
    subtitle: {
      fontSize: 14,
      color: "595959",
    },
    slideTitle: {
      fontSize: 28,
      color: "FFFFFF",  // White text on navy header
      bold: true,
    },
    body: {
      fontSize: 11,
      color: "0C0C0C",
    },
    kpiValue: {
      fontSize: 36,
      color: "081C3D",
      bold: true,
    },
    kpiLabel: {
      fontSize: 10,
      color: "595959",
    },
  },
  // RAG Colors
  rag: {
    green: "00B050",
    amber: "FFC000",
    red: "C00000",
    paleGreen: "EAF5E2",
    paleAmber: "FFF2CC",
    paleRed: "FCE4D6",
  },
  // Executive table style
  table: {
    headerFill: "081C3D",  // Dark navy header
    headerTextColor: "FFFFFF",
    rowFill: "FFFFFF",
    alternateRowFill: "F7F9FC",
    borderColor: "CCD2D8",
    fontSize: 10,
    headerFontSize: 10,
  },
  // KPI Cards
  kpiCard: {
    fill: "FFFFFF",
    border: "CCD2D8",
    shadow: true,
  },
} as const;

export type GovernanceSlideMaster = typeof GOVERNANCE_SLIDE_MASTER;
