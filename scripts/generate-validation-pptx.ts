#!/usr/bin/env node
/**
 * Generate final validation PPTX for PR #308
 * 
 * Usage: npx tsx scripts/generate-validation-pptx.ts
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  createDeterministicTestFixture,
} from "../src/modules/presentation-center/governanceGenerator";
import { buildGovernanceReport } from "../src/modules/presentation-center/governanceTypes";
import { getSCurveValueAtReportingDate } from "../src/modules/presentation-center/governanceTemplateGenerator";
import { generateGovernancePresentationAutomizer } from "../src/modules/presentation-center/governanceAutomizer";

const OUTPUT_DIR = join(process.cwd(), "validation-artifacts");
const REPORTING_DATE = new Date("2026-07-25T00:00:00Z");

async function main() {
  console.log("=== GOVERNANCE VALIDATION GENERATOR ===\n");
  
  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Create fixture
  console.log("1. Creating deterministic fixture...");
  const facilities = createDeterministicTestFixture();
  console.log(`   Facilities: ${facilities.length}`);
  
  // Build report
  console.log("\n2. Building governance report...");
  const report = buildGovernanceReport(facilities, REPORTING_DATE);
  console.log(`   Reporting Date: ${report.reportingDate}`);
  
  // Verify fixture values
  console.log("\n3. Verifying fixture values at 2026-07-25:");
  let allCorrect = true;
  
  const expected = [
    { slug: "aglipay", name: "AGLIPAY STP", planned: 44, actual: 44 },
    { slug: "htt", name: "HTT STP", planned: 44, actual: 44 },
    { slug: "eastbay", name: "EASTBAY PH-2 TP", planned: 22, actual: 11 },
    { slug: "kaysakat", name: "KAYSAKAT TP", planned: 33, actual: 0 },
  ];
  
  for (const exp of expected) {
    const f = report.facilities.find(fac => fac.facility.slug === exp.slug);
    const planned = getSCurveValueAtReportingDate(f!.sCurve, REPORTING_DATE, "planned");
    const actual = getSCurveValueAtReportingDate(f!.sCurve, REPORTING_DATE, "actual");
    
    const plannedOk = planned === exp.planned;
    const actualOk = actual === exp.actual;
    
    console.log(`   ${exp.name}:`);
    console.log(`     Planned: ${planned}% (expected ${exp.planned}%) ${plannedOk ? "✓" : "✗"}`);
    console.log(`     Actual: ${actual}% (expected ${exp.actual}%) ${actualOk ? "✓" : "✗"}`);
    
    if (!plannedOk || !actualOk) allCorrect = false;
  }
  
  if (!allCorrect) {
    console.error("\n❌ Fixture values are incorrect!");
    process.exitCode = 1;
    return;
  }
  
  console.log("\n✅ All fixture values correct!");
  
  // Check Slide 4 mode
  console.log("\n4. Verifying Slide 4 Mode B:");
  const hasRequirementMatrix = report.facilities.some(f => f.hasRequirementBaseline);
  console.log(`   Has Requirement Matrix: ${hasRequirementMatrix}`);
  console.log(`   Mode: ${hasRequirementMatrix ? "A" : "B"} ✓`);
  
  // Generate presentation using template
  console.log("\n5. Generating presentation from template...");
  try {
    const buffer = await generateGovernancePresentationAutomizer(report);
    
    const outputPath = join(OUTPUT_DIR, "governance-final-validation.pptx");
    writeFileSync(outputPath, buffer);
    
    console.log(`   ✅ Presentation saved: ${outputPath}`);
    console.log(`   Size: ${(buffer.length / 1024).toFixed(2)} KB`);
    
    // Verify file exists
    if (!existsSync(outputPath)) {
      console.error("   ❌ File was not created!");
      process.exitCode = 1;
      return;
    }
    
    console.log("\n=== VALIDATION COMPLETE ===");
    console.log("Output:");
    console.log(`  ${outputPath}`);
    
  } catch (error) {
    console.error("\n❌ Failed to generate presentation:");
    console.error(error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
