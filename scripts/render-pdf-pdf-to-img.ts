/**
 * Script to render PDF pages to PNG images using pdf-to-img
 * Run: npx tsx scripts/render-pdf-pdf-to-img.ts
 */
import { pdf } from "pdf-to-img";
import { writeFile } from "fs/promises";
import { join } from "path";
import { mkdir } from "fs/promises";

async function main() {
  const pdfPath = "artifacts/governance-presentation-validation/OM-Governance-Onboarding-Progress-TEST.pdf";
  const outputDir = "artifacts/governance-presentation-validation";
  
  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });
  
  console.log("Rendering PDF to PNG images...");
  
  const document = await pdf(pdfPath, { scale: 1.5 });
  let pageNum = 1;
  
  for await (const image of document) {
    const outputPath = join(outputDir, `slide-${pageNum}.png`);
    await writeFile(outputPath, image);
    console.log(`  Slide ${pageNum}: ${outputPath}`);
    pageNum++;
  }
  
  console.log(`\nRendered ${pageNum - 1} slides successfully.`);
}

main().catch(console.error);
