/**
 * Governance Presentation Generator using pptx-automizer
 * 
 * This script generates the governance presentation using the fixed
 * automizer-based generator with correct July 2026 fixture values.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  createDeterministicTestFixture,
} from "../src/modules/presentation-center/governanceGenerator";
import { buildGovernanceReport } from "../src/modules/presentation-center/governanceTypes";
import { generateGovernancePresentationAutomizer } from "../src/modules/presentation-center/governanceAutomizer";

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

  // Generate presentation using automizer
  console.log("\nGenerating presentation with pptx-automizer...");
  const buffer = await generateGovernancePresentationAutomizer(report);

  const outputPath = join(outputDir, "governance-final-validation.pptx");
  writeFileSync(outputPath, buffer);

  console.log(`\n✅ Presentation saved to: ${outputPath}`);
  console.log(`   Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
  console.log("\n✅ Validation complete!");
}

main().catch(console.error);
