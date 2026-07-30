/**
 * Check the fixture milestone dates
 */

import {
  createDeterministicTestFixture,
} from "../src/modules/presentation-center/governanceGenerator";

const reportingDate = new Date("2026-07-25");
const facilities = createDeterministicTestFixture();

console.log("=== MILESTONE ANALYSIS ===\n");

for (const f of facilities) {
  console.log(`${f.facility.shortName}:`);
  console.log("  Planned dates before 2026-07-25:");
  const plannedBefore = f.milestones.filter(m => m.plannedDate && new Date(m.plannedDate) <= reportingDate);
  for (const m of plannedBefore) {
    console.log(`    ${m.milestoneId}: ${m.plannedDate}`);
  }
  console.log(`    Count: ${plannedBefore.length}/9 = ${Math.round(plannedBefore.length/9*100)}%`);
  
  console.log("  Actual dates before 2026-07-25:");
  const actualBefore = f.milestones.filter(m => m.actualDate && new Date(m.actualDate) <= reportingDate);
  for (const m of actualBefore) {
    console.log(`    ${m.milestoneId}: ${m.actualDate}`);
  }
  console.log(`    Count: ${actualBefore.length}/9 = ${Math.round(actualBefore.length/9*100)}%`);
  console.log();
}
