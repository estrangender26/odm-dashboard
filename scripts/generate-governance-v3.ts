/**
 * Governance V3 Presentation Generator Script
 * Generates the Manila Water branded 3-slide presentation
 */

import { generateGovernanceV3 } from "../src/modules/governance-v3/index.server";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=".repeat(70));
  console.log("GOVERNANCE V3 PRESENTATION GENERATOR");
  console.log("=".repeat(70));
  
  const reportingDate = process.argv[2] ? new Date(process.argv[2]) : new Date();
  console.log("\nGenerating presentation for reporting date: " + reportingDate.toISOString().split("T")[0]);
  
  try {
    const { blob, data } = await generateGovernanceV3({ reportingDate });
    
    // Save to file
    const outputDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, "governance-v3.pptx");
    const buffer = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    
    console.log("\n✅ Presentation generated successfully!");
    console.log("   File: " + outputPath);
    console.log("   Size: " + (buffer.length / 1024 / 1024).toFixed(2) + " MB");
    console.log("   Slides: 3");
    console.log("   Facilities: " + data.facilities.length);
    
    console.log("\n📊 SLIDE 1: Executive Headline");
    console.log("   Title: " + data.executive.headline);
    console.log("   Next Gate: " + data.executive.nextGateAction);
    
    console.log("\n📈 SLIDE 2: Timeline");
    console.log("   Gate Implication: " + data.executive.gateImplication);
    
    console.log("\n📋 SLIDE 3: Documentation Readiness");
    console.log("   Headline: " + data.executive.documentationHeadline);
    console.log("   Portfolio: " + data.summary.portfolioCompliancePercent + "%");
    
    console.log("\n🏭 FACILITY STATUS:");
    data.facilities.forEach((f) => {
      const achieved = f.milestones.filter(m => m.status === "achieved" || m.status === "achieved_ahead").length;
      const doc = data.facilityDocumentation.find(d => d.facilitySlug === f.slug);
      console.log("   " + f.shortName + ": " + f.phaseStatus + " | " + achieved + "/9 milestones | " + (doc?.compliancePercent || 0) + "% docs");
    });
    
    // Export data as JSON for inspection
    const dataPath = path.join(outputDir, "governance-v3-data.json");
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    console.log("\n📄 Data exported: " + dataPath);
    
    console.log("\n" + "=".repeat(70));
    console.log("GENERATION COMPLETE");
    console.log("=".repeat(70));
    
  } catch (error) {
    console.error("\n❌ Generation failed:", error);
    process.exit(1);
  }
}

main();
