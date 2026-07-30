import { fetchGovernanceV3Data } from "../src/modules/governance-v3/adapter.server";
import { generateGovernanceV3Presentation } from "../src/modules/governance-v3/generator";
import { writeFileSync } from "fs";

async function main() {
  const reportingDate = process.argv[2] ? new Date(process.argv[2]) : new Date();
  
  console.log("Fetching governance V3 data for:", reportingDate.toISOString().split("T")[0]);
  
  try {
    const data = await fetchGovernanceV3Data(reportingDate);
    
    console.log("\n=== Presentation Data Summary ===");
    console.log("Reporting Date:", data.reportingDate);
    console.log("Facilities:", data.facilities.length);
    console.log("Headline:", data.executive.headline);
    console.log("Portfolio Compliance:", data.summary.portfolioCompliancePercent + "%");
    
    console.log("\n=== Facility Details ===");
    data.facilities.forEach(f => {
      console.log(`- ${f.shortName}: ${f.phaseStatus}`);
      const completed = f.milestones.filter(m => m.status === "achieved" || m.status === "achieved_ahead").length;
      console.log(`  Milestones: ${completed}/${f.milestones.length} complete`);
    });
    
    console.log("\n=== Documentation Compliance ===");
    data.facilityDocumentation.forEach(d => {
      console.log(`- ${d.facilityName}: ${d.submittedCount}/${d.requiredCount} (${d.compliancePercent}%)`);
    });
    
    console.log("\nGenerating presentation...");
    const blob = await generateGovernanceV3Presentation(data);
    
    const outputPath = `./tmp/governance-v3-${data.reportingDate}.pptx`;
    const arrayBuffer = await blob.arrayBuffer();
    writeFileSync(outputPath, Buffer.from(arrayBuffer));
    
    console.log(`\n✅ Presentation saved to: ${outputPath}`);
    console.log(`Size: ${blob.size} bytes`);
    
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
