/**
 * Governance Presentation Validation Script
 * Generates a deterministic PPTX for visual validation
 */

import { fetchGovernanceDataForPresentation } from "../src/modules/presentation-center/governanceData.server";
import { generateGovernancePresentation } from "../src/modules/presentation-center/governanceGenerator";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

async function generateValidationArtifacts() {
  const reportingDate = new Date("2026-07-25T00:00:00Z");
  
  console.log("Fetching governance data...");
  const { facilities, summary } = await fetchGovernanceDataForPresentation(reportingDate);
  
  console.log(`Found ${facilities.length} facilities`);
  console.log(`Total documents: ${summary.totalDocuments}`);
  
  // Log deliverable summaries
  for (const f of facilities) {
    const ds = f.documentSummary.deliverableSummary;
    console.log(`\n${f.facility.name}:`);
    console.log(`  Deliverables: ${ds?.submitted}/${ds?.required} (${ds?.compliancePercent?.toFixed(1)}%)`);
    console.log(`  Raw uploads: ${f.documentSummary.totalDocuments}`);
  }
  
  console.log("\nGenerating presentation...");
  const pptx = await generateGovernancePresentation(facilities, "2026-07-25");
  
  // Ensure artifacts directory exists
  const artifactsDir = join(process.cwd(), "validation-artifacts");
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }
  
  // Save PPTX
  const pptxPath = join(artifactsDir, "governance-validation.pptx");
  writeFileSync(pptxPath, pptx);
  console.log(`\nGenerated: ${pptxPath}`);
  
  // Write summary JSON
  const summaryPath = join(artifactsDir, "governance-validation-summary.json");
  const validationSummary = {
    generatedAt: new Date().toISOString(),
    reportingDate: "2026-07-25",
    facilities: facilities.map(f => ({
      name: f.facility.name,
      slug: f.facility.slug,
      deliverables: f.documentSummary.deliverableSummary,
      documentCount: f.documentSummary.totalDocuments,
    })),
  };
  writeFileSync(summaryPath, JSON.stringify(validationSummary, null, 2));
  console.log(`Generated: ${summaryPath}`);
  
  console.log("\n✅ Validation artifacts generated successfully");
}

generateValidationArtifacts().catch(err => {
  console.error("Failed to generate artifacts:", err);
  process.exit(1);
});
