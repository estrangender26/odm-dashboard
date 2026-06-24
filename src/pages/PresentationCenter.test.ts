import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deckGeneratorRegistry } from "@/modules/presentation-center/generators";
import { ODM_TEMPLATE_OPTIONS } from "@/modules/presentation-center/odmScorecardData";
import { MONTHLY_KPI_TEMPLATE_OPTIONS } from "@/modules/presentation-center/scorecardData";

const presentationCenterSource = readFileSync(
  resolve(process.cwd(), "src/pages/PresentationCenter.tsx"),
  "utf8"
);

describe("Presentation Center Monthly KPI generation dialog", () => {
  it("opens the configuration modal from the Monthly KPI Generate button", () => {
    const buttonHandler = presentationCenterSource.slice(
      presentationCenterSource.indexOf(
        "generator.id === monthlyKpiGeneratorId"
      ),
      presentationCenterSource.indexOf("disabled={isActive}")
    );

    expect(buttonHandler).toContain("openMonthlyKpiDialog(generator.id)");
    expect(buttonHandler).toContain("runGenerator(generator.id)");
    expect(presentationCenterSource).toContain("Generate Monthly KPI PPTX");
  });

  it("renders the required reporting fields and only the Executive Scorecard template", () => {
    expect(presentationCenterSource).toContain("Reporting Year");
    expect(presentationCenterSource).toContain("Reporting Month");
    expect(presentationCenterSource).toContain("Business Unit");
    expect(presentationCenterSource).toContain("Template");
    expect(MONTHLY_KPI_TEMPLATE_OPTIONS).toEqual(["Executive Scorecard"]);
  });
});

describe("Presentation Center Operator-Driven Maintenance generation dialog", () => {
  it("activates only the ODM generator among reserved future generators", () => {
    const odmGenerator = deckGeneratorRegistry.find(
      generator => generator.id === "operator-driven-maintenance"
    );
    const remainingComingSoon = deckGeneratorRegistry.filter(
      generator =>
        generator.id !== "monthly-kpi-scorecard" &&
        generator.id !== "operator-driven-maintenance"
    );

    expect(odmGenerator).toMatchObject({
      status: "active",
      enabled: true,
      title: "Operator Driven Maintenance Deck",
    });
    expect(typeof odmGenerator?.generate).toBe("function");
    expect(remainingComingSoon.every(generator => !generator.enabled)).toBe(true);
    expect(
      remainingComingSoon.every(generator => generator.status === "coming-soon")
    ).toBe(true);
  });

  it("opens the ODM configuration modal from the Generate button", () => {
    const buttonHandler = presentationCenterSource.slice(
      presentationCenterSource.indexOf(
        "generator.id === monthlyKpiGeneratorId"
      ),
      presentationCenterSource.indexOf("disabled={isActive}")
    );

    expect(buttonHandler).toContain("openOdmDialog(generator.id)");
    expect(buttonHandler).toContain("runGenerator(generator.id)");
    expect(presentationCenterSource).toContain(
      "Generate Operator-Driven Maintenance PPTX"
    );
  });

  it("renders the ODM dashboard filter controls and Executive Summary template", () => {
    expect(presentationCenterSource).toContain("Reporting Year");
    expect(presentationCenterSource).toContain("Reporting Month");
    expect(presentationCenterSource).toContain("Date From");
    expect(presentationCenterSource).toContain("Date To");
    expect(presentationCenterSource).toContain("Plant / Facility");
    expect(presentationCenterSource).toContain("Equipment Type");
    expect(presentationCenterSource).toContain("Category");
    expect(presentationCenterSource).toContain("Inspector");
    expect(presentationCenterSource).toContain("Template");
    expect(presentationCenterSource).toContain("getAvailableOdmScorecardOptions");
    expect(presentationCenterSource).toContain("getOdmMonthDateRange");
    expect(presentationCenterSource).toContain("dateFrom: odmSelection.dateFrom");
    expect(presentationCenterSource).toContain("dateTo: odmSelection.dateTo");
    expect(presentationCenterSource).not.toContain("odmSelection.dateFrom &&");
    expect(presentationCenterSource).not.toContain("odmSelection.dateTo &&");
    expect(presentationCenterSource).toContain("facility: odmSelection.facility");
    expect(presentationCenterSource).toContain("equipmentType: odmSelection.equipmentType");
    expect(presentationCenterSource).toContain("category: odmSelection.category");
    expect(presentationCenterSource).toContain("inspector: odmSelection.inspector");
    expect(ODM_TEMPLATE_OPTIONS).toEqual(["Executive Summary"]);
  });
});

describe("Presentation Center Recent Presentations deduplication", () => {
  it("uses mergeGeneratedPresentation to avoid duplicate recent rows", () => {
    expect(presentationCenterSource).toContain(
      "mergeGeneratedPresentation(generated, deck)"
    );
  });

  it("imports the merge helper from the presentation-center storage module", () => {
    expect(presentationCenterSource).toContain(
      "mergeGeneratedPresentation,"
    );
    expect(presentationCenterSource).toContain(
      'from "@/modules/presentation-center/storage"'
    );
  });

  it("sorts Recent Presentations by generatedAt descending", () => {
    expect(presentationCenterSource).toContain("const sortedGenerated");
    expect(presentationCenterSource).toContain("a.generatedAt ?? a.generatedDate");
    expect(presentationCenterSource).toContain("b.generatedAt ?? b.generatedDate");
    expect(presentationCenterSource).toContain("{sortedGenerated.map(deck =>");
  });

  it("keeps download buttons wired to the latest dataUrl", () => {
    const recentTable = presentationCenterSource.slice(
      presentationCenterSource.indexOf("Recent Presentations"),
      presentationCenterSource.indexOf("No recent presentations yet")
    );
    expect(recentTable).toContain("downloadDataUrl(deck.dataUrl, deck.name)");
  });
});
