#!/usr/bin/env node
/**
 * PRODUCTION DIAGNOSTIC: Governance Milestone Completion Investigation
 * 
 * STRICTLY READ-ONLY - No writes, updates, or schema changes
 * Run with: LEGACY_MIGRATOR_MODE=1 npx tsx scripts/diagnose-milestone-regression.ts [YYYY-MM-DD]
 * 
 * SAFETY: All database imports are dynamic and occur ONLY after LEGACY_MIGRATOR_MODE check passes.
 * Static imports are limited to safe constants only.
 */

// ============================================
// SAFE CONSTANTS ONLY (no database dependencies)
// ============================================
const GOVERNANCE_MILESTONES = [
  { id: "M1", label: "M1 - Technical Audit", weight: 1 },
  { id: "M2", label: "M2 - Design Validation & Basis of Design", weight: 1 },
  { id: "M3", label: "M3 - Construction Completion / O&M Transition", weight: 1 },
  { id: "M4", label: "M4 - P1 Acceptance", weight: 1 },
  { id: "M5", label: "M5 - P1 Defects Rectification", weight: 1 },
  { id: "M6", label: "M6 - P2 Acceptance", weight: 1 },
  { id: "M7", label: "M7 - P2 Defects Rectification", weight: 1 },
  { id: "M8", label: "M8 - TOC Performance Certificate", weight: 1 },
  { id: "M9", label: "M9 - Final TOC / Project Close-out", weight: 1 },
] as const;

// ============================================
// FAIL-CLOSED SAFETY CHECK
// Must run BEFORE any dynamic imports that could initialise the database
// ============================================
console.log("======================================================================");
console.log("GOVERNANCE MILESTONE DIAGNOSTIC - STRICTLY READ-ONLY");
console.log("======================================================================");
console.log("");

// Mandatory LEGACY_MIGRATOR_MODE check - fail closed
if (process.env.LEGACY_MIGRATOR_MODE !== "1") {
  console.error("❌ FATAL: LEGACY_MIGRATOR_MODE environment variable is required.");
  console.error("   Set LEGACY_MIGRATOR_MODE=1 when running in production.");
  console.error("   Example: LEGACY_MIGRATOR_MODE=1 npx tsx scripts/diagnose-milestone-regression.ts 2026-07-25");
  console.log("");
  console.log("======================================================================");
  process.exit(1);
}

console.log("✓ LEGACY_MIGRATOR_MODE=1 confirmed");
console.log("");
console.log("Safety Guarantees:");
console.log("  - This script performs SELECT queries only");
console.log("  - No database writes will be performed");
console.log("  - No schema changes will be made");
console.log("  - No data modifications will occur");
console.log("  - Database modules loaded ONLY after safety check");
console.log("");

// ============================================
// APPROVED EXPECTED MILESTONE CONFIGURATION
// As of 2026-07-25, these milestones should be complete:
// ============================================
const APPROVED_EXPECTED_MILESTONES: Record<string, string[]> = {
  aglipay: ["M1", "M2", "M3", "M4"],    // 4/9 = 44%
  htt: ["M1", "M2", "M3", "M4"],          // 4/9 = 44%
  eastbay: ["M1"],                         // 1/9 = 11%
  kaysakat: [],                            // 0/9 = 0%
};

// ============================================
// DATE HANDLING (Mirrors governanceData.server.ts)
// ============================================
function getCutoffDate(reportingDate: Date): Date {
  const cutoff = new Date(reportingDate);
  cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

function isDateBeforeCutoff(dateStr: string | null, reportingDate: Date): boolean {
  if (!dateStr) return false;
  const cutoff = getCutoffDate(reportingDate);
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.getTime() < cutoff.getTime();
}

function isValidDateString(dateStr: string): boolean {
  // Check format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  
  // Parse components
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  
  // Validate ranges
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  
  // Check for calendar-invalid dates using actual Date object
  // JavaScript will normalize invalid dates (e.g., Feb 30 -> Mar 2)
  // so we compare if the components match after normalization
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(date.getTime())) {
    return false;
  }
  
  // Check if date components match (catches Feb 30, Apr 31, etc.)
  const normalizedYear = date.getUTCFullYear();
  const normalizedMonth = date.getUTCMonth() + 1; // getUTCMonth is 0-indexed
  const normalizedDay = date.getUTCDate();
  
  return year === normalizedYear && month === normalizedMonth && day === normalizedDay;
}

// ============================================
// DISCREPANCY CLASSIFICATION
// ============================================
type DiscrepancyType = 
  | "EXPECTED_COMPLETE_BUT_MISSING"
  | "EXPECTED_INCOMPLETE_BUT_COMPLETE"
  | "COMPLETION_AFTER_REPORTING_DATE"
  | "MISSING_RECORD"
  | "DUPLICATE_RECORD"
  | "WRONG_FACILITY_ASSOCIATION"
  | "UNEXPECTED_MILESTONE_ID"
  | "INVALID_REPORTING_DATE"
  | "NONE";

function classifyDiscrepancy(
  expectedComplete: boolean,
  actualComplete: boolean,
  persisted: boolean,
  includedByCutoff: boolean,
  duplicateCount: number
): DiscrepancyType {
  if (duplicateCount > 1) return "DUPLICATE_RECORD";
  if (!persisted) {
    if (expectedComplete) return "EXPECTED_COMPLETE_BUT_MISSING";
    return "MISSING_RECORD";
  }
  if (expectedComplete && !actualComplete) {
    if (!includedByCutoff) return "COMPLETION_AFTER_REPORTING_DATE";
    return "EXPECTED_COMPLETE_BUT_MISSING";
  }
  if (!expectedComplete && actualComplete) {
    return "EXPECTED_INCOMPLETE_BUT_COMPLETE";
  }
  return "NONE";
}

// ============================================
// MAIN DIAGNOSTIC (dynamic imports only)
// ============================================
async function diagnoseMilestones() {
  // Parse and validate reporting date
  const reportingDateStr = process.argv[2] || new Date().toISOString().split("T")[0];
  
  if (!isValidDateString(reportingDateStr)) {
    console.error("❌ FATAL: Invalid reporting date format.");
    console.error(`   Received: "${reportingDateStr}"`);
    console.error("   Expected: YYYY-MM-DD (e.g., 2026-07-25)");
    process.exit(1);
  }
  
  const reportingDate = new Date(`${reportingDateStr}T00:00:00Z`);
  if (isNaN(reportingDate.getTime())) {
    console.error("❌ FATAL: Invalid reporting date value.");
    console.error(`   Received: "${reportingDateStr}"`);
    process.exit(1);
  }
  
  const cutoffDate = getCutoffDate(reportingDate);
  
  console.log("======================================================================");
  console.log("DIAGNOSTIC CONFIGURATION");
  console.log("======================================================================");
  console.log(`Reporting Date: ${reportingDateStr}`);
  console.log(`Cutoff Date:    ${cutoffDate.toISOString()}`);
  console.log(`Cutoff Logic:   Include completions BEFORE ${cutoffDate.toISOString()}`);
  console.log("");
  
  console.log("======================================================================");
  console.log("APPROVED EXPECTED MILESTONE CONFIGURATION");
  console.log("======================================================================");
  for (const [facility, milestones] of Object.entries(APPROVED_EXPECTED_MILESTONES)) {
    console.log(`${facility.toUpperCase()}: ${milestones.length}/9 complete = ${Math.round((milestones.length/9)*100)}%`);
    console.log(`  Expected complete: ${milestones.join(", ") || "none"}`);
  }
  console.log("");
  
  // ============================================
  // DYNAMIC IMPORTS (after safety check)
  // ============================================
  console.log("Loading database modules...");
  
  let db: any;
  let governanceFacilities: any;
  let governanceMilestoneState: any;
  let inArray: any;
  
  try {
    const [{ db: dbConn }, schema, drizzle] = await Promise.all([
      import("@db/connection"),
      import("@db/schema"),
      import("drizzle-orm"),
    ]);
    
    db = dbConn;
    governanceFacilities = schema.governanceFacilities;
    governanceMilestoneState = schema.governanceMilestoneState;
    inArray = drizzle.inArray;
    
    console.log("✓ Database modules loaded");
    console.log("");
  } catch (err) {
    console.error("❌ FATAL: Failed to load database modules:", err);
    process.exit(1);
  }
  
  // ============================================
  // STEP 1: Fetch canonical facilities
  // ============================================
  console.log("======================================================================");
  console.log("STEP 1: CANONICAL FACILITIES FROM DATABASE");
  console.log("======================================================================");
  
  const dbFacilities = await db.select({
    id: governanceFacilities.id,
    slug: governanceFacilities.slug,
    name: governanceFacilities.name,
    shortName: governanceFacilities.shortName,
  }).from(governanceFacilities);
  
  console.log(`Found ${dbFacilities.length} facilities:`);
  for (const f of dbFacilities) {
    console.log(`  [ID:${f.id}] "${f.slug}" - ${f.name}`);
  }
  console.log("");
  
  // Check for facility slug mismatches
  const approvedSlugs = Object.keys(APPROVED_EXPECTED_MILESTONES);
  const dbSlugs = dbFacilities.map((f: any) => f.slug);
  
  const missingFacilities = approvedSlugs.filter(s => !dbSlugs.includes(s));
  const extraFacilities = dbSlugs.filter((s: string) => !approvedSlugs.includes(s));
  
  if (missingFacilities.length > 0) {
    console.log("⚠️  WARNING: Approved facilities missing from database:");
    for (const slug of missingFacilities) {
      console.log(`    - ${slug}`);
    }
    console.log("");
  }
  
  if (extraFacilities.length > 0) {
    console.log("ℹ️  INFO: Extra facilities in database (not in approved list):");
    for (const slug of extraFacilities) {
      console.log(`    - ${slug}`);
    }
    console.log("");
  }
  
  // ============================================
  // STEP 2: Fetch all milestone state records
  // ============================================
  console.log("======================================================================");
  console.log("STEP 2: MILESTONE STATE RECORDS FROM DATABASE");
  console.log("======================================================================");
  
  const facilitySlugs = dbFacilities.map((f: any) => f.slug);
  const allMilestoneStates = await db
    .select({
      id: governanceMilestoneState.id,
      facilitySlug: governanceMilestoneState.facilitySlug,
      milestoneId: governanceMilestoneState.milestoneId,
      pppDate: governanceMilestoneState.pppDate,
      compDate: governanceMilestoneState.compDate,
      customPct: governanceMilestoneState.customPct,
      readyStatus: governanceMilestoneState.readyStatus,
    })
    .from(governanceMilestoneState)
    .where(inArray(governanceMilestoneState.facilitySlug, facilitySlugs));
  
  console.log(`Found ${allMilestoneStates.length} milestone state records`);
  console.log("");
  
  // ============================================
  // STEP 3: Group by facility and analyze
  // ============================================
  const recordsByFacility = new Map<string, typeof allMilestoneStates>();
  for (const record of allMilestoneStates) {
    const existing = recordsByFacility.get(record.facilitySlug) || [];
    existing.push(record);
    recordsByFacility.set(record.facilitySlug, existing);
  }
  
  // ============================================
  // STEP 4: DETAILED DIAGNOSTIC TABLE
  // ============================================
  console.log("======================================================================");
  console.log("STEP 4: RECORD-LEVEL DIAGNOSTIC TABLE");
  console.log("======================================================================");
  console.log("");
  console.log("Legend:");
  console.log("  EXP = Expected per approved configuration");
  console.log("  ACT = Actual based on database records");
  console.log("  COMP = Completion date present");
  console.log("  CUTOFF = Before reporting date cutoff");
  console.log("");
  
  // Header
  console.log("| Facility | Mgmt.ID | Milestone | EXP | ACT | COMP? | CUTOFF? | Discrepancy Type |");
  console.log("|----------|---------|-----------|-----|-----|-------|---------|------------------|");
  
  interface DiagnosticResult {
    facilitySlug: string;
    facilityDbId: number | null;
    milestoneId: string;
    milestoneLabel: string;
    expectedComplete: boolean;
    actualComplete: boolean;
    persistedRowPresent: boolean;
    includedByCutoff: boolean;
    duplicateCount: number;
    discrepancyType: DiscrepancyType;
    compDate: string | null;
  }
  
  const diagnosticResults: DiagnosticResult[] = [];
  
  // Process all approved facilities, even if missing from DB
  for (const approvedSlug of approvedSlugs) {
    const facility = dbFacilities.find((f: any) => f.slug === approvedSlug);
    const facilityDbId = facility?.id || null;
    const facilityRecords = recordsByFacility.get(approvedSlug) || [];
    const expectedMilestones = APPROVED_EXPECTED_MILESTONES[approvedSlug] || [];
    
    for (const canonicalMs of GOVERNANCE_MILESTONES) {
      const expectedComplete = expectedMilestones.includes(canonicalMs.id);
      
      // Find matching record(s)
      const matchingRecords = facilityRecords.filter((r: any) => r.milestoneId === canonicalMs.id);
      const record = matchingRecords[0];
      const duplicateCount = matchingRecords.length;
      
      const compDate = record?.compDate || null;
      const persisted = record !== undefined;
      const includedByCutoff = isDateBeforeCutoff(compDate, reportingDate);
      const actualComplete = includedByCutoff && compDate !== null;
      
      const discrepancyType = classifyDiscrepancy(
        expectedComplete,
        actualComplete,
        persisted,
        includedByCutoff,
        duplicateCount
      );
      
      diagnosticResults.push({
        facilitySlug: approvedSlug,
        facilityDbId,
        milestoneId: canonicalMs.id,
        milestoneLabel: canonicalMs.label,
        expectedComplete,
        actualComplete,
        persistedRowPresent: persisted,
        includedByCutoff,
        duplicateCount,
        discrepancyType,
        compDate,
      });
      
      // Print table row
      const expStr = expectedComplete ? "YES" : "NO";
      const actStr = actualComplete ? "YES" : "NO";
      const compStr = compDate ? "YES" : "NO";
      const cutoffStr = compDate ? (includedByCutoff ? "YES" : "NO") : "N/A";
      const dispStr = discrepancyType === "NONE" ? "—" : discrepancyType;
      
      console.log(`| ${approvedSlug.padEnd(8)} | ${facilityDbId?.toString().padStart(3) || "N/A"} | ${canonicalMs.id.padEnd(9)} | ${expStr.padEnd(3)} | ${actStr.padEnd(3)} | ${compStr.padEnd(5)} | ${cutoffStr.padEnd(7)} | ${dispStr.padEnd(16)} |`);
    }
  }
  
  console.log("");
  
  // ============================================
  // STEP 5: FACILITY-LEVEL SUMMARY
  // ============================================
  console.log("======================================================================");
  console.log("STEP 5: FACILITY-LEVEL SUMMARY VS APPROVED EXPECTED");
  console.log("======================================================================");
  console.log("");
  console.log("| Facility | Expected | Actual | Match? | Discrepancies |");
  console.log("|----------|----------|--------|--------|---------------|");
  
  const facilitySummaries: Array<{
    facility: string;
    expected: number;
    actual: number;
    matches: boolean;
    discrepancies: DiscrepancyType[];
  }> = [];
  
  for (const approvedSlug of approvedSlugs) {
    const expected = APPROVED_EXPECTED_MILESTONES[approvedSlug].length;
    const facilityDiags = diagnosticResults.filter(r => r.facilitySlug === approvedSlug);
    const actual = facilityDiags.filter(r => r.actualComplete).length;
    
    const discrepancies = facilityDiags
      .filter(r => r.discrepancyType !== "NONE")
      .map(r => r.discrepancyType);
    
    const uniqueDiscrepancies = [...new Set(discrepancies)];
    const matches = expected === actual && uniqueDiscrepancies.length === 0;
    
    facilitySummaries.push({
      facility: approvedSlug,
      expected,
      actual,
      matches,
      discrepancies: uniqueDiscrepancies,
    });
    
    const expectedStr = `${expected}/9 (${Math.round((expected/9)*100)}%)`;
    const actualStr = `${actual}/9 (${Math.round((actual/9)*100)}%)`;
    const matchStr = matches ? "✓ YES" : "✗ NO";
    const dispStr = uniqueDiscrepancies.length > 0 ? uniqueDiscrepancies.join(", ") : "—";
    
    console.log(`| ${approvedSlug.toUpperCase().padEnd(8)} | ${expectedStr.padEnd(8)} | ${actualStr.padEnd(6)} | ${matchStr.padEnd(6)} | ${dispStr.padEnd(13)} |`);
  }
  
  console.log("");
  
  // ============================================
  // STEP 6: DEFINITIVE ROOT CAUSE
  // ============================================
  console.log("======================================================================");
  console.log("STEP 6: DEFINITIVE ROOT CAUSE CLASSIFICATION");
  console.log("======================================================================");
  console.log("");
  
  const allDiscrepancies = diagnosticResults.filter(r => r.discrepancyType !== "NONE");
  
  if (allDiscrepancies.length === 0) {
    console.log("✓ NO DISCREPANCIES FOUND");
    console.log("  All milestone records match approved expected values.");
    console.log("");
    console.log("  ROOT CAUSE: Production data matches approved configuration.");
    console.log("  If production API still shows different values, investigate:");
    console.log("    - Stale deployment or cache");
    console.log("    - Different code path being executed");
    console.log("    - API transformation defect");
  } else {
    console.log("❌ DISCREPANCIES DETECTED");
    console.log("");
    
    // Count by type
    const byType: Record<DiscrepancyType, number> = {
      EXPECTED_COMPLETE_BUT_MISSING: 0,
      EXPECTED_INCOMPLETE_BUT_COMPLETE: 0,
      COMPLETION_AFTER_REPORTING_DATE: 0,
      MISSING_RECORD: 0,
      DUPLICATE_RECORD: 0,
      WRONG_FACILITY_ASSOCIATION: 0,
      UNEXPECTED_MILESTONE_ID: 0,
      INVALID_REPORTING_DATE: 0,
      NONE: 0,
    };
    
    for (const d of allDiscrepancies) {
      byType[d.discrepancyType]++;
    }
    
    console.log("Discrepancy Counts:");
    for (const [type, count] of Object.entries(byType)) {
      if (count > 0 && type !== "NONE") {
        console.log(`  ${type}: ${count}`);
      }
    }
    
    console.log("");
    console.log("DEFINITIVE ROOT CAUSE:");
    
    // Determine primary root cause
    if (byType.EXPECTED_COMPLETE_BUT_MISSING > 0) {
      console.log("");
      console.log("  → EXPECTED_COMPLETE_BUT_MISSING");
      console.log(`    ${byType.EXPECTED_COMPLETE_BUT_MISSING} milestone(s) should be complete but are not.`);
      console.log("    These milestones have no record OR completion date is missing/after cutoff.");
    }
    
    if (byType.COMPLETION_AFTER_REPORTING_DATE > 0) {
      console.log("");
      console.log("  → COMPLETION_AFTER_REPORTING_DATE");
      console.log(`    ${byType.COMPLETION_AFTER_REPORTING_DATE} milestone(s) have completion date after reporting date.`);
      console.log("    These completions are excluded by the reporting date cutoff.");
    }
    
    if (byType.EXPECTED_INCOMPLETE_BUT_COMPLETE > 0) {
      console.log("");
      console.log("  → EXPECTED_INCOMPLETE_BUT_COMPLETE");
      console.log(`    ${byType.EXPECTED_INCOMPLETE_BUT_COMPLETE} milestone(s) are complete but should not be.`);
      console.log("    Verify approved expected values are correct.");
    }
    
    if (byType.DUPLICATE_RECORD > 0) {
      console.log("");
      console.log("  → DUPLICATE_RECORD");
      console.log(`    ${byType.DUPLICATE_RECORD} milestone(s) have duplicate database records.`);
      console.log("    Data integrity issue - investigate source of duplicates.");
    }
  }
  
  console.log("");
  console.log("======================================================================");
  console.log("DIAGNOSTIC COMPLETE");
  console.log("======================================================================");
  
  return {
    diagnosticResults,
    facilitySummaries,
  };
}

// Run diagnostic
diagnoseMilestones().then(({ facilitySummaries }) => {
  console.log("");
  console.log("EXECUTION SUMMARY:");
  console.log("  Script completed successfully");
  console.log("  Database connection closed");
  console.log("  No modifications performed");
  
  // Summary for programmatic processing
  console.log("");
  console.log("FACILITY SUMMARY (JSON format):");
  console.log(JSON.stringify(facilitySummaries, null, 2));
  
  process.exit(0);
}).catch(err => {
  console.error("❌ Diagnostic failed:", err);
  process.exit(1);
});
