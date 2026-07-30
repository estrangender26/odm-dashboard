/**
 * Generate final validation presentation
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  createDeterministicTestFixture,
  generateGovernancePresentation,
} from "../src/modules/presentation-center/governanceGenerator";
import { buildGovernanceReport } from "../src/modules/presentation-center/governanceTypes";
import { getSCurveValueAtReportingDate } from "../src/modules/presentation-center/governanceTemplateGenerator";

async function main() {
  const outputDir = join(process.cwd(), "validation-artifacts");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const reportingDate = new Date("2026-07-25");
  const facilities = createDeterministicTestFixture();
  const report = buildGovernanceReport(facilities, reportingDate);

  console.log("=== GENERATION REPORT ===");
  console.log("\nReporting Date: 2026-07-25");
  console.log("\nFacility S-Curve Values at Reporting Date:");
  
  for (const f of report.facilities) {
    const planned = getSCurveValueAtReportingDate(f.sCurve, reportingDate, "planned");
    const actual = getSCurveValueAtReportingDate(f.sCurve, reportingDate, "actual");
    
    // Find which point was selected
    const eligiblePoints = f.sCurve
      .filter(p => new Date(p.date) <= reportingDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const selectedPoint = eligiblePoints[eligiblePoints.length - 1];
    
    console.log(`\n${f.facility.shortName}:`);
    console.log(`  Selected Point Date: ${selectedPoint?.date || 'N/A'}`);
    console.log(`  Planned: ${planned}%`);
    console.log(`  Actual: ${actual}%`);
    console.log(`  S-Curve Points: ${f.sCurve.length}`);
    console.log(`  Eligible Points (≤2026-07-25): ${eligiblePoints.length}`);
  }

  // Portfolio calculation
  let totalPlanned = 0;
  let totalActual = 0;
  let count = 0;
  
  for (const f of report.facilities) {
    const planned = getSCurveValueAtReportingDate(f.sCurve, reportingDate, "planned");
    const actual = getSCurveValueAtReportingDate(f.sCurve, reportingDate, "actual");
    
    if (planned !== null && actual !== null) {
      totalPlanned += planned;
      totalActual += actual;
      count++;
    }
  }
  
  const portfolioPlanned = count > 0 ? Math.round(totalPlanned / count) : 0;
  const portfolioActual = count > 0 ? Math.round(totalActual / count) : 0;
  const portfolioVariance = portfolioActual - portfolioPlanned;
  
  console.log("\n=== PORTFOLIO CALCULATION ===");
  console.log(`Facilities Contributing: ${count}`);
  console.log(`Sum of Planned Values: ${totalPlanned}`);
  console.log(`Sum of Actual Values: ${totalActual}`);
  console.log(`Portfolio Planned: ${portfolioPlanned}%`);
  console.log(`Portfolio Actual: ${portfolioActual}%`);
  console.log(`Portfolio Variance: ${portfolioVariance}%`);

  // Slide 4 check
  console.log("\n=== SLIDE 4 DELIVERABLES CHECK ===");
  const hasRequirementMatrix = report.facilities.some(f => f.hasRequirementBaseline);
  console.log(`Has Requirement Matrix: ${hasRequirementMatrix}`);
  console.log(`Mode: ${hasRequirementMatrix ? 'A' : 'B'} (No matrix = Mode B)`);
  
  for (const f of report.facilities) {
    console.log(`\n${f.facility.shortName}:`);
    console.log(`  Required: ${f.required}`);
    console.log(`  Submitted: ${f.submitted}`);
    console.log(`  Has Requirement Baseline: ${f.hasRequirementBaseline}`);
    console.log(`  Compliance Proxy: ${f.submissionCoverageProxy}%`);
  }

  // Generate presentation
  console.log("\n=== GENERATING PRESENTATION ===");
  const blob = await generateGovernancePresentation({
    facilities: facilities,
    reportingDate: reportingDate,
  });

  const outputPath = join(outputDir, "governance-final-validation.pptx");
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  writeFileSync(outputPath, buffer);

  console.log(`\n✅ Presentation saved: ${outputPath}`);
  console.log(`Size: ${(buffer.length / 1024).toFixed(2)} KB`);
  
  // List files in validation-artifacts
  const fs = await import("fs");
  const files = fs.readdirSync(outputDir);
  console.log("\nValidation artifacts:");
  for (const file of files) {
    const stats = fs.statSync(join(outputDir, file));
    console.log(`  ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
  }
}

main().catch(console.error);
