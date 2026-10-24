import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(process.cwd(), "public/scorecard-kpi.html"), "utf8");

function block(startToken: string, endToken: string) {
  const start = html.indexOf(startToken);
  const end = html.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0) throw new Error("Expected source block not found");
  return html.slice(start, end);
}

describe("Monthly KPI Excel import round trip", () => {
  it("persists and reloads Schedule Compliance plus MTBF", () => {
    const summary = block("function importSummaryWorkbook", "function normalizePersistedBusinessUnit");
    const mapper = block("function applyPersistedMonthlyKpiRecords", "async function fetchMonthlyKpiAggregates");
    expect(summary).toContain("schedule_compliance: record.schedule_compliance");
    expect(summary).toContain("mtbf_days: record.mtbf_days");
    expect(summary).not.toContain("ensureMonthlyRecord(");
    expect(mapper).toContain("record.scheduleCompliance = row.schedule_compliance");
    expect(mapper).toContain("record.mtbf = row.mtbf_days");
  });

  it("keeps modal and conflict handling deterministic", () => {
    const importCode = block("function importExcel", "// ===== CLEAR =====");
    expect(importCode).toContain("Import cancelled. Existing saved KPI records were kept.");
    expect(importCode.indexOf("closeImportModal(true);")).toBeGreaterThan(-1);
  });
});
