/**
 * Governance Presentation Validation Script
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  createDeterministicTestFixture,
  generateGovernancePresentation,
} from "../src/modules/presentation-center/governanceGenerator";
import { buildGovernanceReport } from "../src/modules/presentation-center/governanceTypes";

async function main() {
  const outputDir = join(process.cwd(), "validation-artifacts");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Generate using the July 2026 fixture
  const reportingDate = new Date("2026-07-25");
  const facilities = createDeterministicTestFixture();
  const report = buildGovernanceReport(facilities, reportingDate);

  console.log("Generating governance presentation for July 25, 2026...");
  console.log("\nReport Summary:");
  console.log(`  Reporting Date: ${report.reportingDate}`);
  console.log(`  Facilities: ${report.facilities.length}`);
  console.log(`  Portfolio Progress: ${report.portfolio.overallProgress}%`);

  console.log("\nFacility Values at Reporting Date:");
  for (const f of report.facilities) {
    const sCurveAtDate = f.sCurve
      .filter(p => new Date(p.date) <= reportingDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const lastPoint = sCurveAtDate[sCurveAtDate.length - 1];
    console.log(`  ${f.facility.shortName}: planned=${lastPoint?.planned ?? 'N/A'}%, actual=${lastPoint?.actual ?? 'N/A'}%`);
  }

  // Generate presentation
  const blob = await generateGovernancePresentation({
    facilities: facilities,
    reportingDate: reportingDate,
  });

  const outputPath = join(outputDir, "governance-validation-corrected.pptx");
  
  // Convert blob to buffer and save
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  writeFileSync(outputPath, buffer);

  console.log(`\nPresentation saved to: ${outputPath}`);
  console.log(`Size: ${(buffer.length / 1024).toFixed(2)} KB`);
  console.log("\nValidation complete!");
}

main().catch(console.error);
