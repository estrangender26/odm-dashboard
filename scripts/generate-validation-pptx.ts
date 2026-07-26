/**
 * Generate validation PPTX for PR #307
 * Run with: npx tsx scripts/generate-validation-pptx.ts
 */

import { generateGovernanceTestPresentation } from "../src/modules/presentation-center/governanceGenerator";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Generating validation PPTX...");
  
  try {
    const presentation = await generateGovernanceTestPresentation(new Date("2026-07-25"));
    
    console.log("Presentation generated:");
    console.log(`  ID: ${presentation.id}`);
    console.log(`  Name: ${presentation.name}`);
    console.log(`  Filename: ${presentation.filename}`);
    console.log(`  Size: ${presentation.size} bytes`);
    console.log(`  Type: ${presentation.type}`);
    console.log(`  dataUrl length: ${presentation.dataUrl?.length || 0} chars`);
    
    // Check if dataUrl is base64 data or blob URL
    if (presentation.dataUrl?.startsWith('data:')) {
      const base64Data = presentation.dataUrl.split(',')[1];
      if (base64Data) {
        const buffer = Buffer.from(base64Data, 'base64');
        const outputPath = path.join(process.cwd(), 'validation-artifacts', 'governance-validation.pptx');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, buffer);
        console.log(`✅ Saved to: ${outputPath}`);
        console.log(`   File size: ${(buffer.length / 1024).toFixed(1)} KB`);
      } else {
        console.log("No base64 data found in dataUrl");
      }
    } else {
      console.log("dataUrl format:", presentation.dataUrl?.substring(0, 100));
    }
    
    // Write metadata
    const metaPath = path.join(process.cwd(), 'validation-artifacts', 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      id: presentation.id,
      name: presentation.name,
      filename: presentation.filename,
      title: presentation.title,
      type: presentation.type,
      generatedDate: presentation.generatedDate,
      generatedBy: presentation.generatedBy,
      size: presentation.size,
      generatorName: presentation.generatorName,
    }, null, 2));
    console.log(`✅ Metadata saved to: ${metaPath}`);
    
  } catch (error) {
    console.error("Failed to generate PPTX:", error);
    process.exit(1);
  }
}

main();
