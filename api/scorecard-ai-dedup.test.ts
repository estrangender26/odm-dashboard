import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const auditedModulePages = [
  "src/pages/Dashboard.tsx",
  "src/pages/PostPlanningInsights.tsx",
  "src/pages/ScorecardDashboard.tsx",
  "src/pages/OmManualsLibrary.tsx",
  "src/pages/GovernanceDashboard.tsx",
  "src/pages/GanttPlanner.tsx",
  "src/pages/ExistingFacilitiesMaintenance.tsx",
  "src/pages/SmpDashboard.tsx",
];

describe("duplicate AI assistant regression", () => {
  it("keeps one unified React assistant entry point per audited module page", () => {
    for (const file of auditedModulePages) {
      const source = repoFile(file);
      expect(source.match(/<AIAssistant\b/g) ?? [], file).toHaveLength(1);
    }
  });

  it("keeps Monthly KPI Scorecard on the unified Monthly KPI AI assistant", () => {
    const source = repoFile("src/pages/ScorecardDashboard.tsx");

    expect(source).toContain('contextType="scorecard"');
    expect(source).toContain('title="Monthly KPI AI"');
    expect(source).toContain('sourceModule: "Monthly KPI Scorecard"');
    expect(source.match(/<AIAssistant\b/g) ?? []).toHaveLength(1);
  });

  it("does not render the legacy scorecard iframe AI widget", () => {
    const html = repoFile("public/scorecard-kpi.html");

    expect(html).not.toContain(["Scorecard", "AI"].join(""));
    expect(html).not.toContain(["aiFab", "Btn"].join(""));
    expect(html).not.toContain(["aiScorecard", "Panel"].join(""));
    expect(html).not.toContain(["aiScorecard", "Overlay"].join(""));
  });
});
