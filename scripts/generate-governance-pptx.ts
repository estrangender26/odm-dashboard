/**
 * Governance PPTX Generator for Validation
 * Generates actual PPTX file using pptxgenjs directly
 */

import pptxgenjs from "pptxgenjs";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const PptxGenConstructor =
  typeof pptxgenjs === "function"
    ? pptxgenjs
    : (pptxgenjs as unknown as { default: typeof pptxgenjs }).default;

// GOVERNANCE_SLIDE_MASTER constants
const MASTER = {
  slide: { width: 13.333, height: 7.5 },
  header: { x: 0, y: 0, height: 0.7, fill: "1e3a5f", textColor: "FFFFFF" },
  content: { x: 0.63, y: 1.0, width: 12.073, height: 5.8 },
  footer: { y: 6.8, height: 0.4, fontSize: 9, textColor: "666666" },
  pageNumber: { x: 12.0, y: 6.8, fontSize: 9, color: "666666" },
  typography: {
    title: { fontSize: 36, bold: true, color: "1e3a5f" },
    subtitle: { fontSize: 18, color: "4b5563" },
    slideTitle: { fontSize: 24, bold: true },
  },
  table: { headerFill: "e5e7eb" },
  rag: {
    green: "22c55e",
    amber: "f59e0b",
    red: "ef4444",
    paleGreen: "dcfce7",
    paleAmber: "fef3c7",
    paleRed: "fee2e2",
  },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Production-aligned deliverable data
const FACILITY_DATA = [
  { name: "AGLIPAY STP", required: 14, submitted: 3, approved: 3, missing: 11, compliance: 21.4, status: "At Risk" },
  { name: "HTT STP", required: 14, submitted: 11, approved: 11, missing: 3, compliance: 78.6, status: "In Progress" },
  { name: "EASTBAY PH-2 TP", required: 14, submitted: 4, approved: 4, missing: 10, compliance: 28.6, status: "At Risk" },
  { name: "KAYSAKAT TP", required: 14, submitted: 1, approved: 1, missing: 13, compliance: 7.1, status: "At Risk" },
];

async function generatePPTX() {
  console.log("Generating Governance Presentation PPTX...");
  
  const pptx = new PptxGenConstructor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "ODM Dashboard";
  pptx.company = "ODM Dashboard";
  pptx.subject = "Governance Onboarding Progress";
  pptx.title = "New Facilities Onboarding";
  
  // SLIDE 1: Title Slide
  const slide1 = pptx.addSlide();
  slide1.background = { color: "FFFFFF" };
  slide1.addText("New Facilities Onboarding", {
    x: 0.9, y: 2.17, w: 11, h: 1.0,
    fontSize: MASTER.typography.title.fontSize,
    bold: true,
    color: MASTER.typography.title.color,
  });
  slide1.addText("AGLIPAY STP • HTT STP • EASTBAY PH-2 TP • KAYSAKAT TP", {
    x: 0.9, y: 3.5, w: 11, h: 0.5,
    fontSize: MASTER.typography.subtitle.fontSize,
    color: MASTER.typography.subtitle.color,
  });
  slide1.addText(formatDate("2026-07-25"), {
    x: 0.9, y: 5.5, w: 3, h: 0.4,
    fontSize: 14,
    color: "595959",
  });
  slide1.addText("Source: O&M Manual Governance module • July 25, 2026", {
    x: 0.63, y: 6.8, w: 10, h: 0.4,
    fontSize: 9,
    color: "666666",
  });
  slide1.addText("1 / 4", {
    x: 12.0, y: 6.8, w: 0.8, h: 0.4,
    fontSize: 9,
    color: "666666",
    align: "right",
  });
  
  // SLIDE 2: Consolidated S-Curve
  const slide2 = pptx.addSlide();
  slide2.background = { color: "FFFFFF" };
  // Header bar
  slide2.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.7, fill: "1e3a5f" });
  slide2.addText("Governance Overview", {
    x: 0.63, y: 0.23, w: 10, h: 0.5,
    fontSize: 24,
    bold: true,
    color: "FFFFFF",
  });
  // S-curve placeholder text
  slide2.addText("Consolidated Planned vs Actual S-Curve", {
    x: 0.63, y: 1.2, w: 10, h: 0.4,
    fontSize: 14,
    bold: true,
    color: "0C0C0C",
  });
  slide2.addText("Current Planned: 40% | Current Actual: 44% | Variance: +4% | Status: On Track", {
    x: 0.63, y: 1.7, w: 12, h: 0.3,
    fontSize: 11,
    color: "4b5563",
  });
  // Footer
  slide2.addText("Source: O&M Manual Governance module • July 25, 2026", {
    x: 0.63, y: 6.8, w: 10, h: 0.4,
    fontSize: 9,
    color: "666666",
  });
  slide2.addText("2 / 4", {
    x: 12.0, y: 6.8, w: 0.8, h: 0.4,
    fontSize: 9,
    color: "666666",
    align: "right",
  });
  
  // SLIDE 3: Four Facility S-Curves
  const slide3 = pptx.addSlide();
  slide3.background = { color: "FFFFFF" };
  // Header bar
  slide3.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.7, fill: "1e3a5f" });
  slide3.addText("Facility Progress Overview", {
    x: 0.63, y: 0.23, w: 10, h: 0.5,
    fontSize: 24,
    bold: true,
    color: "FFFFFF",
  });
  // Facility boxes
  const facilities = [
    { name: "AGLIPAY STP", planned: 40, actual: 44, variance: "+4", status: "On Track", color: "22c55e" },
    { name: "HTT STP", planned: 44, actual: 44, variance: "0", status: "On Track", color: "22c55e" },
    { name: "EASTBAY PH-2 TP", planned: 22, actual: 11, variance: "-11", status: "Delayed", color: "ef4444" },
    { name: "KAYSAKAT TP", planned: 11, actual: 11, variance: "0", status: "On Track", color: "22c55e" },
  ];
  let yPos = 1.3;
  for (const f of facilities) {
    slide3.addText(`${f.name}`, {
      x: 0.63, y: yPos, w: 3, h: 0.3,
      fontSize: 12,
      bold: true,
      color: "0C0C0C",
    });
    slide3.addText(`Planned: ${f.planned}% | Actual: ${f.actual}% | Variance: ${f.variance}%`, {
      x: 4, y: yPos, w: 6, h: 0.3,
      fontSize: 10,
      color: "4b5563",
    });
    slide3.addText(f.status, {
      x: 10.5, y: yPos, w: 2, h: 0.3,
      fontSize: 10,
      color: f.color,
      bold: true,
    });
    yPos += 0.6;
  }
  // Footer
  slide3.addText("Source: O&M Manual Governance module • July 25, 2026", {
    x: 0.63, y: 6.8, w: 10, h: 0.4,
    fontSize: 9,
    color: "666666",
  });
  slide3.addText("3 / 4", {
    x: 12.0, y: 6.8, w: 0.8, h: 0.4,
    fontSize: 9,
    color: "666666",
    align: "right",
  });
  
  // SLIDE 4: Deliverables Compliance Summary
  const slide4 = pptx.addSlide();
  slide4.background = { color: "FFFFFF" };
  // Header bar
  slide4.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.7, fill: "1e3a5f" });
  slide4.addText("Deliverables Compliance Summary", {
    x: 0.63, y: 0.23, w: 10, h: 0.5,
    fontSize: 24,
    bold: true,
    color: "FFFFFF",
  });
  slide4.addText("Facility Deliverables Status", {
    x: 0.63, y: 1.0, w: 12, h: 0.3,
    fontSize: 12,
    bold: true,
    color: "0C0C0C",
  });
  
  // Table
  const tableData = [
    ["Facility", "Required", "Submitted", "Approved", "Missing", "Compliance", "Status"],
    ...FACILITY_DATA.map(f => [
      f.name,
      String(f.required),
      String(f.submitted),
      String(f.approved),
      String(f.missing),
      `${f.compliance.toFixed(1)}%`,
      f.status,
    ]),
  ];
  
  slide4.addTable(tableData, {
    x: 0.63, y: 1.4, w: 12.073, h: 2.5,
    fontSize: 9,
    border: { type: "solid", color: "E5E7EB", pt: 0.5 },
    fill: { color: "FFFFFF" },
    colW: [3, 1.5, 1.5, 1.5, 1.5, 1.8, 1.8],
  });
  
  // Footer
  slide4.addText("Source: O&M Manual Governance module • July 25, 2026", {
    x: 0.63, y: 6.8, w: 10, h: 0.4,
    fontSize: 9,
    color: "666666",
  });
  slide4.addText("4 / 4", {
    x: 12.0, y: 6.8, w: 0.8, h: 0.4,
    fontSize: 9,
    color: "666666",
    align: "right",
  });
  
  // Ensure artifacts directory exists
  const artifactsDir = join(process.cwd(), "validation-artifacts");
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }
  
  // Write PPTX
  const outputPath = join(artifactsDir, "governance-validation.pptx");
  await pptx.writeFile({ fileName: outputPath });
  
  console.log(`\n✅ Generated: ${outputPath}`);
  console.log("\n📊 Slide Contents:");
  console.log("  Slide 1: Title - New Facilities Onboarding");
  console.log("  Slide 2: Consolidated S-Curve Overview");
  console.log("  Slide 3: Four Facility Progress Summary");
  console.log("  Slide 4: Deliverables Compliance Table");
  console.log("\n📋 Deliverables Table:");
  for (const f of FACILITY_DATA) {
    console.log(`  ${f.name}: ${f.submitted}/${f.required} (${f.compliance.toFixed(1)}%) - ${f.status}`);
  }
}

generatePPTX().catch(err => {
  console.error("Failed to generate PPTX:", err);
  process.exit(1);
});
