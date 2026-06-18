import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
