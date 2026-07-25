/**
 * Script to generate the governance test PPTX
 * Run: npx tsx scripts/generate-governance-test.ts
 */
import { generateGovernanceTestPresentation } from "../src/modules/presentation-center/governanceGenerator";
import { writeFile } from "fs/promises";
import { join } from "path";

async function main() {
  console.log("Generating governance test presentation...");
  
  const blob = await generateGovernanceTestPresentation();
  
  const buffer = Buffer.from(await blob.arrayBuffer());
  const outputPath = join(process.cwd(), "OM-Governance-Onboarding-Progress-TEST.pptx");
  
  await writeFile(outputPath, buffer);
  
  console.log(`Generated: ${outputPath}`);
  console.log(`File size: ${(buffer.length / 1024).toFixed(2)} KB`);
  console.log("Slide count: 3");
  console.log("Facility panels on slide 2: 4");
}

main().catch(console.error);
