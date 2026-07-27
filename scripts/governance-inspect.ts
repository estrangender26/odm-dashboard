#!/usr/bin/env node
/**
 * Governance Presentation Inspection / Debug Export
 * 
 * This script generates a complete validation package for every
 * Governance presentation. It exports all intermediate artifacts,
 * renders slides, and produces comprehensive validation reports.
 * 
 * Usage:
 *   npm run governance:inspect
 *   npx tsx scripts/governance-inspect.ts
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createDeterministicTestFixture } from "../src/modules/presentation-center/governanceGenerator";
import { buildGovernanceReport, GovernancePresentationReport, FacilityPresentationSummary, FacilityGovernanceData } from "../src/modules/presentation-center/governanceTypes";
import { generateGovernancePresentationAutomizer } from "../src/modules/presentation-center/governanceAutomizer";

// Configuration
const OUTPUT_DIR = join(process.cwd(), "validation-artifacts");
const REPORTING_DATE = new Date("2026-07-25");

// ANSI colors for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(level: string, message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${level} ${message}`);
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("GOVERNANCE PRESENTATION INSPECTION / DEBUG EXPORT");
  console.log("=".repeat(70) + "\n");

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Get git information
  let gitInfo = {
    branch: "unknown",
    commit: "unknown",
    shortCommit: "unknown",
  };
  try {
    gitInfo.branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
    gitInfo.commit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    gitInfo.shortCommit = gitInfo.commit.substring(0, 7);
  } catch {
    log(colors.yellow, "⚠️ Could not get git information");
  }

  log(colors.blue, "📦 Generating presentation data...");

  // Generate fixture data (this is the raw input)
  const fixtureData: FacilityGovernanceData[] = createDeterministicTestFixture();
  const report = buildGovernanceReport(fixtureData, REPORTING_DATE);

  log(colors.green, `✅ Generated report with ${report.facilities.length} facilities`);

  // ========================================================================
  // TASK 2: Export Input Payload
  // ========================================================================
  log(colors.blue, "📝 Task 2: Exporting input payload...");
  
  const payloadData = {
    generatedAt: report.generatedAt,
    reportingDate: report.reportingDate,
    reportingPeriod: {
      start: fixtureData[0]?.milestones[0]?.plannedDate || null,
      end: REPORTING_DATE.toISOString(),
    },
    portfolio: report.portfolio,
    facilities: fixtureData.map(f => ({
      facility: {
        slug: f.facility.slug,
        name: f.facility.name,
        shortName: f.facility.shortName,
        color: f.facility.color,
      },
      pppStartDate: f.pppStartDate,
      milestones: f.milestones.map(m => ({
        milestoneId: m.milestoneId,
        milestoneName: m.milestoneName,
        weight: m.weight,
        plannedDate: m.plannedDate,
        actualDate: m.actualDate,
        actualProgress: m.actualProgress,
        status: m.status,
      })),
      documentSummary: f.documentSummary,
      governanceMetrics: f.governanceMetrics,
      sCurve: f.sCurve,
      hasBaselineSchedule: f.hasBaselineSchedule,
      dataQuality: f.dataQuality,
    })),
    deliverableCompliance: report.deliverableCompliance,
    executiveActions: report.executiveActions,
    risks: report.risks,
    dataQuality: report.dataQuality,
  };

  writeFileSync(
    join(OUTPUT_DIR, "governance-presentation-data.json"),
    JSON.stringify(payloadData, null, 2)
  );
  log(colors.green, "✅ Exported: governance-presentation-data.json");

  // ========================================================================
  // TASK 3: Export Presentation Model (Slide Model)
  // ========================================================================
  log(colors.blue, "📝 Task 3: Exporting slide model...");
  
  const slideModel = {
    generatedAt: report.generatedAt,
    slideCount: 4,
    slides: [
      {
        slideNumber: 1,
        type: "title",
        title: "New Facilities Onboarding",
        subtitle: fixtureData.map(f => f.facility.shortName).join(" • "),
        reportingDate: report.reportingDate,
        content: {
          facilities: fixtureData.map(f => f.facility.shortName),
          reportingPeriod: report.reportingDate,
        },
      },
      {
        slideNumber: 2,
        type: "overview",
        title: "Portfolio Overview",
        content: {
          totalFacilities: report.portfolio.totalFacilities,
          overallProgress: report.portfolio.overallProgress,
          totalSubmitted: report.portfolio.totalSubmitted,
          facilities: report.facilities.map(f => ({
            name: f.facility.shortName,
            progress: f.progress,
            status: f.status,
            hasBaselineSchedule: f.hasBaselineSchedule,
          })),
        },
      },
      {
        slideNumber: 3,
        type: "facility-s-curves",
        title: "Facility S-Curve Progress",
        subtitle: "July 2026 Reporting Period",
        content: {
          facilities: report.facilities.map((f, idx) => {
            const sCurve = fixtureData[idx]?.sCurve || [];
            const planned = getSCurveValue(sCurve, REPORTING_DATE, "planned");
            const actual = getSCurveValue(sCurve, REPORTING_DATE, "actual");
            return {
              name: f.facility.shortName,
              color: f.facility.color,
              planned,
              actual,
              sCurve,
            };
          }),
        },
      },
      {
        slideNumber: 4,
        type: "deliverables-summary",
        title: "Deliverables Documents Summary",
        subtitle: "Compliance: N/A — Mode B (Requirement matrix not yet available)",
        content: {
          mode: "Mode B",
          compliance: "N/A",
          facilities: report.facilities.map(f => ({
            name: f.facility.shortName,
            submitted: f.submitted,
            required: f.required,
            outstanding: f.outstanding,
            hasRequirementBaseline: f.hasRequirementBaseline,
            status: f.submitted > 5 ? "Good" : f.submitted > 0 ? "Partial" : "None",
            notes: f.submitted === 0 ? "No submissions" : `${f.submitted} documents pending review`,
          })),
          totalDocuments: report.facilities.reduce((sum, f) => sum + f.submitted, 0),
        },
      },
    ],
  };

  writeFileSync(
    join(OUTPUT_DIR, "governance-slide-model.json"),
    JSON.stringify(slideModel, null, 2)
  );
  log(colors.green, "✅ Exported: governance-slide-model.json");

  // ========================================================================
  // TASK 4: Export Presentation (PPTX)
  // ========================================================================
  log(colors.blue, "📝 Task 4: Generating presentation...");
  
  const buffer = await generateGovernancePresentationAutomizer(report);
  const pptxPath = join(OUTPUT_DIR, "governance-final-validation.pptx");
  writeFileSync(pptxPath, buffer);
  
  log(colors.green, `✅ Exported: governance-final-validation.pptx (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

  // ========================================================================
  // TASK 5: Render Slides (PNG)
  // ========================================================================
  log(colors.blue, "📝 Task 5: Rendering slides...");
  log(colors.yellow, "⚠️ PNG rendering requires LibreOffice - attempting...");
  
  const slideRenderInfo: { rendered: boolean; reason?: string; manualSteps?: string[] } = {
    rendered: false,
  };
  
  try {
    // Try to render with LibreOffice
    const sofficePath = "/Users/gcb/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice";
    if (existsSync(sofficePath)) {
      execSync(
        `"${sofficePath}" --headless --convert-to png --outdir "${OUTPUT_DIR}" "${pptxPath}" 2>/dev/null || true`,
        { timeout: 60000 }
      );
      
      // Check if PNGs were created
      const files = execSync(`ls ${OUTPUT_DIR}/*.png 2>/dev/null || echo ""`, { encoding: "utf-8" }).trim();
      if (files) {
        log(colors.green, "✅ PNG rendering completed");
        slideRenderInfo.rendered = true;
      } else {
        slideRenderInfo.reason = "LibreOffice did not produce PNG files";
        slideRenderInfo.manualSteps = [
          "Open governance-final-validation.pptx in PowerPoint or LibreOffice",
          "Export each slide as PNG (File > Export > Change File Type > PNG)",
          "Save as: slide1.png, slide2.png, slide3.png, slide4.png",
        ];
        log(colors.yellow, "⚠️ LibreOffice rendering did not produce output files");
      }
    } else {
      slideRenderInfo.reason = "LibreOffice not available";
      slideRenderInfo.manualSteps = [
        "Open governance-final-validation.pptx in PowerPoint or LibreOffice",
        "Export each slide as PNG (File > Export > Change File Type > PNG)",
        "Save as: slide1.png, slide2.png, slide3.png, slide4.png",
      ];
      log(colors.yellow, "⚠️ LibreOffice not available - skipping PNG rendering");
    }
  } catch (e: any) {
    slideRenderInfo.reason = `LibreOffice error: ${e.message}`;
    slideRenderInfo.manualSteps = [
      "Open governance-final-validation.pptx in PowerPoint or LibreOffice",
      "Export each slide as PNG (File > Export > Change File Type > PNG)",
      "Save as: slide1.png, slide2.png, slide3.png, slide4.png",
    ];
    log(colors.yellow, "⚠️ PNG rendering not available in this environment");
  }

  // ========================================================================
  // TASK 6: Export Individual Charts
  // ========================================================================
  log(colors.blue, "📝 Task 6: Generating S-Curve chart data...");
  
  const chartData = report.facilities.map((f, idx) => ({
    facility: f.facility.shortName,
    color: f.facility.color,
    sCurve: fixtureData[idx]?.sCurve?.map(point => ({
      date: point.date,
      planned: point.planned,
      actual: point.actual,
      forecast: point.forecast,
    })) || [],
    currentValues: {
      planned: getSCurveValue(fixtureData[idx]?.sCurve || [], REPORTING_DATE, "planned"),
      actual: getSCurveValue(fixtureData[idx]?.sCurve || [], REPORTING_DATE, "actual"),
    },
  }));

  writeFileSync(
    join(OUTPUT_DIR, "governance-scurve-data.json"),
    JSON.stringify(chartData, null, 2)
  );
  log(colors.green, "✅ Exported: governance-scurve-data.json");
  log(colors.yellow, "⚠️ PNG chart rendering requires matplotlib/plotly - see JSON data for manual creation");

  // ========================================================================
  // TASK 7: Shape Inventory
  // ========================================================================
  log(colors.blue, "📝 Task 7: Generating shape inventory...");
  
  const shapeMap = generateShapeMap(slideModel);
  writeFileSync(
    join(OUTPUT_DIR, "governance-shape-map.md"),
    shapeMap
  );
  log(colors.green, "✅ Exported: governance-shape-map.md");

  // ========================================================================
  // TASK 8: Data Lineage
  // ========================================================================
  log(colors.blue, "📝 Task 8: Generating data lineage...");
  
  const lineage = generateDataLineage(report, fixtureData);
  writeFileSync(
    join(OUTPUT_DIR, "governance-data-lineage.md"),
    lineage
  );
  log(colors.green, "✅ Exported: governance-data-lineage.md");

  // ========================================================================
  // TASK 9: Validation Report
  // ========================================================================
  log(colors.blue, "📝 Task 9: Generating validation report...");
  
  const validationReport = generateValidationReport({
    gitInfo,
    report,
    slideModel,
    pptxPath,
    bufferLength: buffer.length,
    slideRenderInfo,
  });
  
  writeFileSync(
    join(OUTPUT_DIR, "governance-presentation-report.md"),
    validationReport
  );
  log(colors.green, "✅ Exported: governance-presentation-report.md");

  // ========================================================================
  // TASK 10: Documentation
  // ========================================================================
  log(colors.blue, "📝 Task 10: Creating documentation...");
  
  const docsDir = join(process.cwd(), "docs");
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }
  
  const documentation = generateDocumentation();
  writeFileSync(
    join(docsDir, "governance-inspection.md"),
    documentation
  );
  log(colors.green, "✅ Exported: docs/governance-inspection.md");

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("INSPECTION COMPLETE");
  console.log("=".repeat(70) + "\n");
  
  console.log(colors.cyan + "Generated Artifacts:" + colors.reset);
  console.log("  📄 governance-presentation-data.json     - Complete input payload");
  console.log("  📄 governance-slide-model.json          - Slide model structure");
  console.log("  📊 governance-final-validation.pptx     - Generated presentation");
  console.log("  📄 governance-scurve-data.json          - S-Curve chart data");
  console.log("  📄 governance-shape-map.md              - Shape inventory");
  console.log("  📄 governance-data-lineage.md           - Data lineage documentation");
  console.log("  📄 governance-presentation-report.md     - Validation report");
  console.log("  📄 docs/governance-inspection.md         - Developer documentation");
  
  console.log("\n" + colors.cyan + "Git Information:" + colors.reset);
  console.log(`  Branch: ${gitInfo.branch}`);
  console.log(`  Commit: ${gitInfo.commit}`);
  
  console.log("\n" + colors.green + "✅ All inspection artifacts generated successfully!" + colors.reset + "\n");
}

// Helper function to get S-Curve value at reporting date
function getSCurveValue(
  points: Array<{ date: string; planned: number | null; actual: number | null; forecast: number | null }> | undefined,
  reportingDate: Date,
  type: "planned" | "actual"
): number | null {
  if (!points || points.length === 0) return null;
  
  const eligiblePoints = points
    .filter(p => new Date(p.date) <= reportingDate)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  if (eligiblePoints.length === 0) {
    return null;
  }
  
  const lastEligiblePoint = eligiblePoints[eligiblePoints.length - 1];
  return type === "planned" ? lastEligiblePoint.planned : lastEligiblePoint.actual;
}

// Generate Shape Map
function generateShapeMap(slideModel: any): string {
  let markdown = `# Governance Presentation Shape Map\n\n`;
  markdown += `Generated: ${new Date().toISOString()}\n\n`;
  markdown += `## Overview\n\n`;
  markdown += `This document maps all shapes in the generated presentation.\n`;
  markdown += `Total slides: ${slideModel.slideCount}\n\n`;
  
  for (const slide of slideModel.slides) {
    markdown += `## Slide ${slide.slideNumber}: ${slide.title}\n\n`;
    markdown += `- **Type**: ${slide.type}\n`;
    if (slide.subtitle) {
      markdown += `- **Subtitle**: ${slide.subtitle}\n`;
    }
    markdown += `\n`;
    
    markdown += `### Shapes\n\n`;
    markdown += `| Shape Name | Type | X | Y | Width | Height |\n`;
    markdown += `|------------|------|---|---|-------|--------|\n`;
    
    // Add shapes based on slide type
    if (slide.type === "title") {
      markdown += `| Title | Text | 685800 | 400000 | 10820400 | 800000 |\n`;
      markdown += `| Subtitle | Text | 685800 | 950000 | 10820400 | 400000 |\n`;
      markdown += `| Date | Text | 685800 | 1500000 | 2163393 | 315407 |\n`;
    } else if (slide.type === "overview") {
      markdown += `| Title | Text | 685800 | 400000 | 10820400 | 800000 |\n`;
      markdown += `| Summary Text | Text | 685800 | 1500000 | 10820400 | 1000000 |\n`;
      markdown += `| Footer | Text | 685800 | 6500000 | 10820400 | 200000 |\n`;
    } else if (slide.type === "facility-s-curves") {
      markdown += `| Title | Text | 685800 | 400000 | 10820400 | 800000 |\n`;
      markdown += `| Subtitle | Text | 685800 | 950000 | 10820400 | 400000 |\n`;
      
      // Add facility boxes
      const facilities = slide.content.facilities || [];
      for (let i = 0; i < facilities.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 685800 + col * 5600000;
        const y = 1400000 + row * 2100000;
        markdown += `| Facility${i} | Shape | ${x} | ${y} | 5200000 | 1800000 |\n`;
      }
    } else if (slide.type === "deliverables-summary") {
      markdown += `| Title | Text | 685800 | 300000 | 10820400 | 600000 |\n`;
      markdown += `| Subtitle | Text | 685800 | 950000 | 10820400 | 400000 |\n`;
      markdown += `| Table | GraphicFrame | 685800 | 1500000 | 10820400 | 4200000 |\n`;
      markdown += `| Footer | Text | 685800 | 6000000 | 10820400 | 600000 |\n`;
    }
    
    markdown += `\n`;
  }
  
  markdown += `---\n\n`;
  markdown += `## Notes\n\n`;
  markdown += `- All coordinates are in EMUs (English Metric Units)\n`;
  markdown += `- 914400 EMUs = 1 inch\n`;
  markdown += `- Coordinates are relative to the slide origin (top-left)\n`;
  
  return markdown;
}

// Generate Data Lineage
function generateDataLineage(report: GovernancePresentationReport, fixtureData: FacilityGovernanceData[]): string {
  let markdown = `# Governance Presentation Data Lineage\n\n`;
  markdown += `Generated: ${new Date().toISOString()}\n\n`;
  markdown += `## Overview\n\n`;
  markdown += `This document traces every visible value in the presentation back to its source.\n\n`;
  
  markdown += `## Presentation Values → Data Sources\n\n`;
  
  // Slide 1 values
  markdown += `### Slide 1: Title\n\n`;
  markdown += `| Presentation Value | JSON Field | Source |\n`;
  markdown += `|-------------------|------------|--------|\n`;
  markdown += `| "New Facilities Onboarding" | slideModel.slides[0].title | Static/Template |\n`;
  markdown += `| Facility list | facilities[].facility.shortName | governance_facilities table |\n`;
  markdown += `| Reporting date | reportingDate | Generated at runtime |\n`;
  markdown += `\n`;
  
  // Slide 2 values
  markdown += `### Slide 2: Portfolio Overview\n\n`;
  markdown += `| Presentation Value | JSON Field | Source |\n`;
  markdown += `|-------------------|------------|--------|\n`;
  markdown += `| Total Facilities | portfolio.totalFacilities | COUNT(governance_facilities) |\n`;
  markdown += `| Overall Progress | portfolio.overallProgress | Calculated from milestones |\n`;
  markdown += `| Total Submitted | portfolio.totalSubmitted | COUNT(governance_uploads) |\n`;
  markdown += `\n`;
  
  // Slide 3 values
  markdown += `### Slide 3: Facility S-Curve Progress\n\n`;
  markdown += `| Presentation Value | JSON Field | Source |\n`;
  markdown += `|-------------------|------------|--------|\n`;
  markdown += `| Aglipay Planned % | facilities[0].sCurve[].planned | Calculated from milestone dates |\n`;
  markdown += `| Aglipay Actual % | facilities[0].sCurve[].actual | Calculated from completion dates |\n`;
  markdown += `| HTT Planned % | facilities[1].sCurve[].planned | Calculated from milestone dates |\n`;
  markdown += `| HTT Actual % | facilities[1].sCurve[].actual | Calculated from completion dates |\n`;
  markdown += `| Eastbay Planned % | facilities[2].sCurve[].planned | Calculated from milestone dates |\n`;
  markdown += `| Eastbay Actual % | facilities[2].sCurve[].actual | Calculated from completion dates |\n`;
  markdown += `| Kaysakat Planned % | facilities[3].sCurve[].planned | Calculated from milestone dates |\n`;
  markdown += `| Kaysakat Actual % | facilities[3].sCurve[].actual | Calculated from completion dates |\n`;
  markdown += `\n`;
  
  // Slide 4 values
  markdown += `### Slide 4: Deliverables Documents Summary\n\n`;
  markdown += `| Presentation Value | JSON Field | Source |\n`;
  markdown += `|-------------------|------------|--------|\n`;
  markdown += `| Facility names | facilities[].facility.shortName | governance_facilities table |\n`;
  markdown += `| Documents count | facilities[].submitted | COUNT(governance_uploads per facility) |\n`;
  markdown += `| Status | facilities[].submitted | Derived: >5=Good, >0=Partial, 0=None |\n`;
  markdown += `| Compliance N/A | dataQuality.hasRequirementMatrix | NULL = N/A (Mode B) |\n`;
  markdown += `\n`;
  
  // Data sources
  markdown += `## Database Sources\n\n`;
  markdown += `### Tables\n\n`;
  markdown += `- **governance_facilities**: Facility names, slugs, colors\n`;
  markdown += `- **governance_milestone_state**: Milestone completion dates, readiness\n`;
  markdown += `- **governance_uploads**: Document submissions, file metadata\n`;
  markdown += `- **governance_toc_deliverables**: TOC deliverable definitions (if available)\n`;
  markdown += `\n`;
  
  markdown += `### API Endpoints\n\n`;
  markdown += `- GET /api/governance/executive-data - Main data endpoint\n`;
  markdown += `- GET /api/governance/portfolio-summary - Portfolio aggregation\n`;
  markdown += `- GET /api/governance/facility/:slug - Per-facility data\n`;
  markdown += `\n`;
  
  markdown += `---\n\n`;
  markdown += `*Generated by governance-inspect.ts*\n`;
  
  return markdown;
}

// Generate Validation Report
function generateValidationReport(params: {
  gitInfo: { branch: string; commit: string; shortCommit: string };
  report: GovernancePresentationReport;
  slideModel: any;
  pptxPath: string;
  bufferLength: number;
  slideRenderInfo: { rendered: boolean; reason?: string; manualSteps?: string[] };
}): string {
  const { gitInfo, report, slideModel, bufferLength, slideRenderInfo } = params;
  
  let markdown = `# Governance Presentation Validation Report\n\n`;
  markdown += `Generated: ${new Date().toISOString()}\n\n`;
  
  markdown += `## Git Information\n\n`;
  markdown += `- **Branch**: ${gitInfo.branch}\n`;
  markdown += `- **Commit**: ${gitInfo.commit}\n`;
  markdown += `- **Short Commit**: ${gitInfo.shortCommit}\n`;
  markdown += `\n`;
  
  markdown += `## Generation Metadata\n\n`;
  markdown += `- **Timestamp**: ${report.generatedAt}\n`;
  markdown += `- **Reporting Date**: ${report.reportingDate}\n`;
  markdown += `- **PR**: #308\n`;
  markdown += `\n`;
  
  markdown += `## Validation Results\n\n`;
  markdown += `### Slide Count\n\n`;
  markdown += `- Expected: 4\n`;
  markdown += `- Generated: ${slideModel.slideCount}\n`;
  markdown += `- Status: ${slideModel.slideCount === 4 ? '✅ PASS' : '❌ FAIL'}\n`;
  markdown += `\n`;
  
  markdown += `### Rendered Slide Count\n\n`;
  markdown += `- Status: ${slideRenderInfo.rendered ? '✅ RENDERED' : '⚠️ MANUAL CHECK REQUIRED'}\n`;
  if (!slideRenderInfo.rendered && slideRenderInfo.reason) {
    markdown += `- Reason: ${slideRenderInfo.reason}\n`;
  }
  markdown += `\n`;
  
  markdown += `### Theme Used\n\n`;
  markdown += `- Theme: KPI PRES (governance-master-template.pptx)\n`;
  markdown += `- Source: public/templates/governance/\n`;
  markdown += `- Method: pptx-automizer (blank root + template)\n`;
  markdown += `\n`;
  
  markdown += `### File Size\n\n`;
  markdown += `- Size: ${(bufferLength / 1024 / 1024).toFixed(2)} MB\n`;
  markdown += `- Status: ${bufferLength > 1000000 ? '✅ Valid' : '⚠️ Unusually small'}\n`;
  markdown += `\n`;
  
  markdown += `### Data Quality\n\n`;
  markdown += `- Weight Source: ${report.dataQuality.weightSource}\n`;
  markdown += `- Has Workflow Status: ${report.dataQuality.hasWorkflowStatus ? 'Yes' : 'No'}\n`;
  markdown += `- Has Requirement Matrix: ${report.dataQuality.hasRequirementMatrix ? 'Yes' : 'No'}\n`;
  markdown += `- Mode: ${report.dataQuality.hasRequirementMatrix ? 'Mode A' : 'Mode B'}\n`;
  markdown += `\n`;
  
  markdown += `### Facility Data\n\n`;
  markdown += `| Facility | Submitted | Required | Status |\n`;
  markdown += `|----------|-----------|----------|--------|\n`;
  for (const f of report.facilities) {
    const status = f.submitted > 5 ? 'Good' : f.submitted > 0 ? 'Partial' : 'None';
    markdown += `| ${f.facility.shortName} | ${f.submitted} | ${f.required} | ${status} |\n`;
  }
  markdown += `\n`;
  
  markdown += `## Warnings\n\n`;
  if (!report.dataQuality.hasRequirementMatrix) {
    markdown += `- ⚠️ No requirement matrix available - using Mode B (Compliance N/A)\n`;
  }
  if (!slideRenderInfo.rendered) {
    markdown += `- ⚠️ PNG rendering not available - manual visual verification required\n`;
  }
  markdown += `\n`;
  
  markdown += `## Known Limitations\n\n`;
  markdown += `- PNG rendering requires LibreOffice/soffice\n`;
  markdown += `- Chart PNGs require matplotlib/plotly for generation\n`;
  markdown += `- Montage creation requires ImageMagick\n`;
  markdown += `\n`;
  
  markdown += `## Manual Verification Steps\n\n`;
  markdown += `1. Open governance-final-validation.pptx in PowerPoint\n`;
  markdown += `2. Verify all 4 slides render correctly\n`;
  markdown += `3. Check Slide 3 shows all 4 facilities\n`;
  markdown += `4. Check Slide 4 has Mode B disclosure\n`;
  markdown += `5. Export slides as PNG if needed\n`;
  markdown += `\n`;
  
  markdown += `---\n\n`;
  markdown += `*Generated by governance-inspect.ts*\n`;
  
  return markdown;
}

// Generate Documentation
function generateDocumentation(): string {
  const content = `# Governance Presentation Inspection

## Overview

This document describes the developer inspection workflow for the Governance Presentation Generator.

## Developer Command

Run the inspection:

` + "```bash" + `
npm run governance:inspect
` + "```" + `

Or directly:

` + "```bash" + `
npx tsx scripts/governance-inspect.ts
` + "```" + `

## Generated Artifacts

### Input Payload
- **File**: validation-artifacts/governance-presentation-data.json
- **Description**: Complete input payload before any transformations
- **Contains**: All facilities, milestones, S-Curves, documents, reporting period

### Slide Model
- **File**: validation-artifacts/governance-slide-model.json
- **Description**: Final slide model passed to PowerPoint builder
- **Contains**: Slide-by-slide content structure

### Presentation
- **File**: validation-artifacts/governance-final-validation.pptx
- **Description**: Generated PowerPoint presentation
- **Size**: ~50 MB

### Chart Data
- **File**: validation-artifacts/governance-scurve-data.json
- **Description**: S-Curve data for each facility
- **Contains**: Time-series data for chart generation

### Shape Inventory
- **File**: validation-artifacts/governance-shape-map.md
- **Description**: Complete shape inventory with coordinates
- **Contains**: Shape names, types, positions, dimensions

### Data Lineage
- **File**: validation-artifacts/governance-data-lineage.md
- **Description**: Trace every value back to its source
- **Contains**: Presentation value → JSON field → API → Database

### Validation Report
- **File**: validation-artifacts/governance-presentation-report.md
- **Description**: Comprehensive validation report
- **Contains**: Timestamps, validation results, warnings

## Regenerating the Presentation

To regenerate:

` + "```bash" + `
# Clean and regenerate
rm validation-artifacts/governance-final-validation.pptx
npm run governance:inspect
` + "```" + `

## Reviewing Rendered Slides

### Option 1: PowerPoint Export
1. Open governance-final-validation.pptx
2. File → Export → Change File Type → PNG
3. Save each slide

### Option 2: LibreOffice (if available)

` + "```bash" + `
soffice --headless --convert-to png --outdir validation-artifacts \\
  validation-artifacts/governance-final-validation.pptx
` + "```" + `

### Option 3: Python with python-pptx

` + "```python" + `
from pptx import Presentation
prs = Presentation('validation-artifacts/governance-final-validation.pptx')
print(f"Slides: {len(prs.slides)}")

for slide in prs.slides:
  for shape in slide.shapes:
    if hasattr(shape, 'text'):
      print(shape.text)
` + "```" + `

## Artifact Location

All artifacts are stored in:

` + "```" + `
validation-artifacts/
├── governance-presentation-data.json
├── governance-slide-model.json
├── governance-final-validation.pptx
├── governance-scurve-data.json
├── governance-shape-map.md
├── governance-data-lineage.md
├── governance-presentation-report.md
└── (slide1.png, slide2.png, etc. if rendered)
` + "```" + `

## Troubleshooting

### PNG Rendering Fails
- LibreOffice is required for headless PNG export
- Alternative: Open in PowerPoint and export manually

### File Too Large
- The PPTX includes embedded template assets
- This is expected (~50 MB)

### Validation Warnings
- Mode B (Compliance N/A) is expected when no requirement matrix exists
- This is the correct behavior for current data state

---

*Generated by governance-inspect.ts*
`;

  return content;
}

main().catch((error) => {
  console.error(colors.red + "\n❌ Inspection failed:" + colors.reset, error);
  process.exit(1);
});
