import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contract test for the EXACT user-facing Monthly KPI presentation path:
 * Presentation Center (single BU) -> boot route -> adapter -> generator.
 * Uses read-only source assertions so the regression is locked without a DB.
 */

const boot = readFileSync("api/boot.ts", "utf8");
const adapter = readFileSync("src/modules/monthly-kpi/adapter.server.ts", "utf8");
const generators = readFileSync("src/modules/presentation-center/generators.ts", "utf8");

const normalizeWs = (value: string) => value.replace(/\s+/g, " ");

describe("Monthly KPI presentation path (UI -> route -> adapter -> generator)", () => {
  it("Presentation Center branches single-BU vs all-BU and passes business_unit on the single-BU route", () => {
    const start = generators.indexOf("async function generateMonthlyKpiExecutiveScorecard");
    const block = normalizeWs(generators.slice(start, start + 6000));
    expect(block).toContain("/api/monthly-kpi/presentation/generate");
    expect(block).toContain('params.set("all_business_units", "1")');
    expect(block).toContain('params.set("business_unit", request.businessUnit)');
    // Single-BU decks keep the "Monthly KPI Executive Scorecard" identity.
    expect(block).toContain("Monthly KPI Executive Scorecard - ${monthName}");
  });

  it("boot route feeds business_unit into fetchMonthlyKpiPresentationData and the shared generator", () => {
    const start = boot.indexOf('app.get("/api/monthly-kpi/presentation/generate"');
    const end = boot.indexOf('app.route("/api/presentation-files"');
    const single = normalizeWs(boot.slice(start, end));
    expect(single).toContain("business_unit");
    expect(single).toContain(
      "fetchMonthlyKpiPresentationData(reportingYear, reportingMonth, businessUnitParam)"
    );
    expect(single).toContain("generateMonthlyKpiPresentation(data)");
    expect(single).toContain("all_business_units");
    expect(single).toContain("data.reportingMonthLabel");
  });

  it("adapter resolves the authoritative effective month before reading notes/situation and YTD", () => {
    expect(adapter).toContain("resolveEffectiveReportingMonth(records, reportingMonth)");
    expect(adapter).toContain(
      "aggregateMonthlyKpiRecords(records, reportingYear, effectiveMonth)"
    );
    expect(adapter).toContain("buildScorecard(records, agg, effectiveMonth)");
    expect(adapter).toContain("reportingMonth: effectiveMonth,");
    expect(adapter).toContain("through August uses the August CWC Notes/Situation");
  });

  it("adapter year-row projection includes notes and situation for the generator", () => {
    expect(adapter).toContain("situation,");
    expect(adapter).toContain("situation: row.situation,");
    expect(adapter).toContain("notes: row.notes,");
  });
});
