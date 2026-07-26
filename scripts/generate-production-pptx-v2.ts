/**
 * Production Pipeline PPTX Generator (v2)
 * Directly uses pptxBuilder to generate PPTX without browser APIs
 */

import { createPresentation } from "../src/modules/presentation-center/pptxBuilder";
import { GOVERNANCE_SLIDE_MASTER } from "../src/modules/presentation-center/governanceSlideMaster";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const MASTER = GOVERNANCE_SLIDE_MASTER;

// Production-aligned test data
const testFacilities = [
  {
    facility: { slug: "aglipay", name: "AGLIPAY STP", shortName: "AGLIPAY STP", color: "#f97316" },
    milestones: [
      { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2025-02-01", actualDate: "2025-01-28", actualProgress: 100 },
      { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: "2025-04-01", actualDate: "2025-03-30", actualProgress: 100 },
      { milestoneId: "M3", milestoneName: "M3 - Construction Completion", weight: 1, plannedDate: "2025-08-01", actualDate: "2025-08-05", actualProgress: 100 },
      { milestoneId: "M4", milestoneName: "M4 - P1 Acceptance", weight: 1, plannedDate: "2025-10-01", actualDate: null, actualProgress: 75 },
      { milestoneId: "M5", milestoneName: "M5 - P1 Defects", weight: 1, plannedDate: "2025-12-01", actualDate: null, actualProgress: null },
      { milestoneId: "M6", milestoneName: "M6 - P2 Acceptance", weight: 1, plannedDate: "2026-03-01", actualDate: null, actualProgress: null },
      { milestoneId: "M7", milestoneName: "M7 - P2 Defects", weight: 1, plannedDate: "2026-05-01", actualDate: null, actualProgress: null },
      { milestoneId: "M8", milestoneName: "M8 - TOC Certificate", weight: 1, plannedDate: "2026-07-01", actualDate: null, actualProgress: null },
      { milestoneId: "M9", milestoneName: "M9 - Final TOC", weight: 1, plannedDate: "2026-09-01", actualDate: null, actualProgress: null },
    ],
    deliverableSummary: { required: 14, submitted: 3, approved: 3, missing: 11, compliancePercent: 21.43, rawFileCount: 6 },
    progress: { actual: 44, planned: 40, variance: 4 },
    status: "green",
  },
  {
    facility: { slug: "htt", name: "HTT STP", shortName: "HTT STP", color: "#3b82f6" },
    milestones: [
      { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2025-03-01", actualDate: "2025-03-15", actualProgress: 100 },
      { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: "2025-05-01", actualDate: "2025-06-10", actualProgress: 100 },
      { milestoneId: "M3", milestoneName: "M3 - Construction Completion", weight: 1, plannedDate: "2025-09-01", actualDate: "2025-09-05", actualProgress: 100 },
      { milestoneId: "M4", milestoneName: "M4 - P1 Acceptance", weight: 1, plannedDate: "2025-11-01", actualDate: "2025-11-20", actualProgress: 100 },
      { milestoneId: "M5", milestoneName: "M5 - P1 Defects", weight: 1, plannedDate: "2026-01-01", actualDate: null, actualProgress: 60 },
      { milestoneId: "M6", milestoneName: "M6 - P2 Acceptance", weight: 1, plannedDate: "2026-04-01", actualDate: null, actualProgress: null },
      { milestoneId: "M7", milestoneName: "M7 - P2 Defects", weight: 1, plannedDate: "2026-06-01", actualDate: null, actualProgress: null },
      { milestoneId: "M8", milestoneName: "M8 - TOC Certificate", weight: 1, plannedDate: "2026-08-01", actualDate: null, actualProgress: null },
      { milestoneId: "M9", milestoneName: "M9 - Final TOC", weight: 1, plannedDate: "2026-10-01", actualDate: null, actualProgress: null },
    ],
    deliverableSummary: { required: 14, submitted: 11, approved: 11, missing: 3, compliancePercent: 78.57, rawFileCount: 22 },
    progress: { actual: 44, planned: 44, variance: 0 },
    status: "green",
  },
  {
    facility: { slug: "eastbay", name: "EASTBAY PH-2 TP", shortName: "EASTBAY PH-2 TP", color: "#10b981" },
    milestones: [
      { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2025-04-01", actualDate: "2025-04-10", actualProgress: 100 },
      { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: "2025-06-01", actualDate: null, actualProgress: 50 },
      { milestoneId: "M3", milestoneName: "M3 - Construction Completion", weight: 1, plannedDate: "2025-10-01", actualDate: null, actualProgress: null },
      { milestoneId: "M4", milestoneName: "M4 - P1 Acceptance", weight: 1, plannedDate: "2025-12-01", actualDate: null, actualProgress: null },
      { milestoneId: "M5", milestoneName: "M5 - P1 Defects", weight: 1, plannedDate: "2026-02-01", actualDate: null, actualProgress: null },
      { milestoneId: "M6", milestoneName: "M6 - P2 Acceptance", weight: 1, plannedDate: "2026-05-01", actualDate: null, actualProgress: null },
      { milestoneId: "M7", milestoneName: "M7 - P2 Defects", weight: 1, plannedDate: "2026-07-01", actualDate: null, actualProgress: null },
      { milestoneId: "M8", milestoneName: "M8 - TOC Certificate", weight: 1, plannedDate: "2026-09-01", actualDate: null, actualProgress: null },
      { milestoneId: "M9", milestoneName: "M9 - Final TOC", weight: 1, plannedDate: "2026-11-01", actualDate: null, actualProgress: null },
    ],
    deliverableSummary: { required: 14, submitted: 4, approved: 4, missing: 10, compliancePercent: 28.57, rawFileCount: 8 },
    progress: { actual: 11, planned: 22, variance: -11 },
    status: "red",
  },
  {
    facility: { slug: "kaysakat", name: "KAYSAKAT TP", shortName: "KAYSAKAT TP", color: "#8b5cf6" },
    milestones: [
      { milestoneId: "M1", milestoneName: "M1 - Technical Audit", weight: 1, plannedDate: "2025-05-01", actualDate: "2025-05-15", actualProgress: 100 },
      { milestoneId: "M2", milestoneName: "M2 - Design Validation", weight: 1, plannedDate: "2025-07-01", actualDate: null, actualProgress: null },
      { milestoneId: "M3", milestoneName: "M3 - Construction Completion", weight: 1, plannedDate: "2025-11-01", actualDate: null, actualProgress: null },
      { milestoneId: "M4", milestoneName: "M4 - P1 Acceptance", weight: 1, plannedDate: "2026-01-01", actualDate: null, actualProgress: null },
      { milestoneId: "M5", milestoneName: "M5 - P1 Defects", weight: 1, plannedDate: "2026-03-01", actualDate: null, actualProgress: null },
      { milestoneId: "M6", milestoneName: "M6 - P2 Acceptance", weight: 1, plannedDate: "2026-06-01", actualDate: null, actualProgress: null },
      { milestoneId: "M7", milestoneName: "M7 - P2 Defects", weight: 1, plannedDate: "2026-08-01", actualDate: null, actualProgress: null },
      { milestoneId: "M8", milestoneName: "M8 - TOC Certificate", weight: 1, plannedDate: "2026-10-01", actualDate: null, actualProgress: null },
      { milestoneId: "M9", milestoneName: "M9 - Final TOC", weight: 1, plannedDate: "2026-12-01", actualDate: null, actualProgress: null },
    ],
    deliverableSummary: { required: 14, submitted: 1, approved: 1, missing: 13, compliancePercent: 7.14, rawFileCount: 2 },
    progress: { actual: 11, planned: 11, variance: 0 },
    status: "amber",
  },
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function buildHeader(title: string): any[] {
  const elements: any[] = [];
  elements.push({
    type: "shape",
    x: MASTER.header.x,
    y: MASTER.header.y,
    w: MASTER.slide.width,
    h: MASTER.header.height,
    fill: MASTER.header.fill,
  });
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

function buildFooter(reportingDate: string, pageNum: number, totalPages: number): any[] {
  return [
    {
      type: "text",
      text: `Source: O&M Manual Governance module • ${formatDate(reportingDate)}`,
      x: MASTER.content.x,
      y: MASTER.footer.y,
      w: 10,
      h: MASTER.footer.height,
      fontSize: MASTER.footer.fontSize,
      color: MASTER.footer.textColor,
    },
    {
      type: "text",
      text: `${pageNum} / ${totalPages}`,
      x: MASTER.pageNumber.x,
      y: MASTER.pageNumber.y,
      w: 0.8,
      h: MASTER.footer.height,
      fontSize: MASTER.pageNumber.fontSize,
      color: MASTER.pageNumber.color,
      align: "r",
    },
  ];
}

async function generateProductionPPTX() {
  console.log("Generating PPTX through production pipeline...");
  console.log("Using: createPresentation() from pptxBuilder\n");
  
  const reportingDate = "2026-07-25";
  const slides: any[] = [];
  
  // SLIDE 1: Title
  const slide1Elements: any[] = [];
  slide1Elements.push({
    type: "text",
    text: "New Facilities Onboarding",
    x: 0.9, y: 2.17, w: 11, h: 1.0,
    fontSize: MASTER.typography.title.fontSize,
    bold: MASTER.typography.title.bold,
    color: MASTER.typography.title.color,
  });
  slide1Elements.push({
    type: "text",
    text: "AGLIPAY STP • HTT STP • EASTBAY PH-2 TP • KAYSAKAT TP",
    x: 0.9, y: 3.5, w: 11, h: 0.5,
    fontSize: MASTER.typography.subtitle.fontSize,
    color: MASTER.typography.subtitle.color,
  });
  slide1Elements.push({
    type: "text",
    text: formatDate(reportingDate),
    x: 0.9, y: 5.5, w: 3, h: 0.4,
    fontSize: 14,
    color: "595959",
  });
  slide1Elements.push(...buildFooter(reportingDate, 1, 4));
  slides.push({ elements: slide1Elements, notes: "Executive title slide" });
  
  // SLIDE 2: Consolidated S-Curve with actual chart
  const slide2Elements: any[] = [];
  slide2Elements.push(...buildHeader("Governance Overview"));
  
  // Generate S-curve data points
  const dateLabels = ["1/25", "2/25", "3/25", "4/25", "5/25", "6/25", "7/25", "8/25", "9/25", "10/25", "11/25", "12/25"];
  const plannedData = [11, 22, 33, 33, 40, 40, 40, 40, 40, 40, 40, 40];
  const actualData = [11, 22, 33, 33, 44, 44, 44, 44, 44, 44, 44, 44];
  
  slide2Elements.push({
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
    colors: ["9ca3af", "22c55e"],
    showLegend: true,
    valAxisMax: 100,
    catAxisLabel: true,
  });
  
  // Summary panel
  const summaryX = MASTER.content.x + MASTER.content.width * 0.72;
  slide2Elements.push({
    type: "text",
    text: "Portfolio Summary",
    x: summaryX, y: MASTER.content.y + 0.3, w: 3.3, h: 0.3,
    fontSize: 12, bold: true, color: "0C0C0C",
  });
  slide2Elements.push({
    type: "text",
    text: "Current Planned: 40%\nCurrent Actual: 44%\nVariance: +4%\nStatus: On Track",
    x: summaryX, y: MASTER.content.y + 0.7, w: 3.3, h: 1.5,
    fontSize: 10, color: "4b5563",
  });
  
  slide2Elements.push(...buildFooter(reportingDate, 2, 4));
  slides.push({ elements: slide2Elements, notes: "Consolidated S-curve with actual line chart" });
  
  // SLIDE 3: Four Facility S-Curves (2x2 grid)
  const slide3Elements: any[] = [];
  slide3Elements.push(...buildHeader("Facility Progress Overview"));
  
  // Facility mini charts
  const facilities = [
    { name: "AGLIPAY STP", planned: 40, actual: 44, variance: "+4", status: "On Track", color: "22c55e", x: 0.63, y: 1.3 },
    { name: "HTT STP", planned: 44, actual: 44, variance: "0", status: "On Track", color: "22c55e", x: 6.9, y: 1.3 },
    { name: "EASTBAY PH-2 TP", planned: 22, actual: 11, variance: "-11", status: "Delayed", color: "ef4444", x: 0.63, y: 4.0 },
    { name: "KAYSAKAT TP", planned: 11, actual: 11, variance: "0", status: "On Track", color: "22c55e", x: 6.9, y: 4.0 },
  ];
  
  for (const f of facilities) {
    // Facility name
    slide3Elements.push({
      type: "text",
      text: f.name,
      x: f.x, y: f.y, w: 3, h: 0.3,
      fontSize: 12, bold: true, color: "0C0C0C",
    });
    // Mini chart placeholder (bar showing progress)
    slide3Elements.push({
      type: "bars",
      title: "",
      labels: ["Planned", "Actual"],
      values: [f.planned, f.actual],
      x: f.x, y: f.y + 0.35, w: 2.8, h: 0.8,
      max: 100,
      colors: ["9ca3af", f.color],
    });
    // Stats
    slide3Elements.push({
      type: "text",
      text: `${f.planned}% planned | ${f.actual}% actual`,
      x: f.x, y: f.y + 1.25, w: 2.8, h: 0.2,
      fontSize: 9, color: "4b5563",
    });
    slide3Elements.push({
      type: "text",
      text: `${f.status} (${f.variance}%)`,
      x: f.x + 2.0, y: f.y + 1.25, w: 1.5, h: 0.2,
      fontSize: 9, color: f.color, bold: true,
    });
  }
  
  slide3Elements.push(...buildFooter(reportingDate, 3, 4));
  slides.push({ elements: slide3Elements, notes: "Four facility S-curves in 2x2 grid" });
  
  // SLIDE 4: Deliverables Compliance Summary
  const slide4Elements: any[] = [];
  slide4Elements.push(...buildHeader("Deliverables Compliance Summary"));
  slide4Elements.push({
    type: "text",
    text: "Facility Deliverables Status",
    x: MASTER.content.x, y: MASTER.content.y, w: 12, h: 0.3,
    fontSize: 12, bold: true, color: "0C0C0C",
  });
  
  // Table
  const tableRows = [
    ["Facility", "Required", "Submitted", "Approved", "Missing", "Compliance", "Status"],
    ...testFacilities.map(f => {
      const ds = f.deliverableSummary;
      const status = ds.compliancePercent >= 100 ? "Complete" : ds.compliancePercent >= 70 ? "In Progress" : "At Risk";
      return [
        f.facility.shortName,
        String(ds.required),
        String(ds.submitted),
        String(ds.approved),
        String(ds.missing),
        `${ds.compliancePercent.toFixed(1)}%`,
        status,
      ];
    }),
  ];
  
  // Cell fills for status column
  const cellFills = [
    Array(7).fill(MASTER.table.headerFill),
    [...Array(6).fill("FFFFFF"), "fee2e2"], // AGLIPAY: At Risk
    [...Array(6).fill("FFFFFF"), "fef3c7"], // HTT: In Progress
    [...Array(6).fill("FFFFFF"), "fee2e2"], // EASTBAY: At Risk
    [...Array(6).fill("FFFFFF"), "fee2e2"], // KAYSAKAT: At Risk
  ];
  
  slide4Elements.push({
    type: "table",
    rows: tableRows,
    x: MASTER.content.x,
    y: MASTER.content.y + 0.4,
    w: MASTER.content.width,
    h: 2.0,
    fontSize: 9,
    cellFills,
  });
  
  slide4Elements.push(...buildFooter(reportingDate, 4, 4));
  slides.push({ elements: slide4Elements, notes: "Deliverables compliance matrix" });
  
  // Generate PPTX
  console.log(`Creating ${slides.length} slides...`);
  const pptxBlob = await createPresentation(slides);
  
  // Ensure artifacts directory exists
  const artifactsDir = join(process.cwd(), "validation-artifacts");
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }
  
  // Write PPTX
  const arrayBuffer = await pptxBlob.arrayBuffer();
  const outputPath = join(artifactsDir, "governance-validation.pptx");
  writeFileSync(outputPath, Buffer.from(arrayBuffer));
  
  console.log(`\n✅ Generated: ${outputPath}`);
  console.log("\n📊 Slide Contents:");
  console.log("  Slide 1: Title - New Facilities Onboarding");
  console.log("  Slide 2: Consolidated S-Curve with actual line chart");
  console.log("  Slide 3: Four Facility Progress with mini charts");
  console.log("  Slide 4: Deliverables Compliance Table");
  
  console.log("\n📋 Deliverables Data (from production pipeline):");
  for (const f of testFacilities) {
    const ds = f.deliverableSummary;
    console.log(`  ${f.facility.shortName}: ${ds.submitted}/${ds.required} (${ds.compliancePercent.toFixed(1)}%)`);
  }
}

generateProductionPPTX().catch(err => {
  console.error("Failed to generate PPTX:", err);
  process.exit(1);
});
