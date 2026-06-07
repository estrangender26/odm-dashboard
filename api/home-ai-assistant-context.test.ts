import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = () => readFileSync("src/pages/Home.tsx", "utf8");

function homeAssistantBlock() {
  const source = homeSource();
  const start = source.indexOf("<AIAssistant");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("      />", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Dashboard Suite home AI assistant context", () => {
  it("uses the shared dashboard help context instead of maintenance context", () => {
    const block = homeAssistantBlock();

    expect(block).toContain('contextType="help"');
    expect(block).toContain('title="ODM Dashboard AI"');
    expect(block).not.toContain('contextType="maintenance"');
    expect(block).not.toContain('title="Maintenance Planning AI"');
  });

  it("does not pass empty maintenance data or Maintenance Planning source metadata", () => {
    const block = homeAssistantBlock();

    expect(block).not.toContain("data={[]}");
    expect(block).not.toContain('sourceModule: "Maintenance Planning"');
    expect(block).toContain('sourceModule: "Help"');
    expect(block).toContain('sourceRecordId: "home-dashboard-suite"');
    expect(block).toContain('sourceRecordLabel: "Dashboard Suite Home"');
  });

  it("offers only home help and navigation prompts", () => {
    const block = homeAssistantBlock();

    expect(block).toContain("What can this dashboard do?");
    expect(block).toContain("Which module should I open?");
    expect(block).toContain("How do I use Maintenance Planning?");
    expect(block).toContain("How do I use ODM Talk?");
    expect(block).not.toContain("Analyze PM compliance trends");
    expect(block).not.toContain("Identify high-risk equipment");
    expect(block).not.toContain("Review overdue work orders");
  });

  it("keeps module dashboard pages on their module-specific assistant contexts", () => {
    const maintenancePage = readFileSync("src/pages/Dashboard.tsx", "utf8");
    const ganttPage = readFileSync("src/pages/GanttPlanner.tsx", "utf8");
    const scorecardPage = readFileSync("src/pages/ScorecardDashboard.tsx", "utf8");

    expect(maintenancePage).toContain('contextType="maintenance"');
    expect(maintenancePage).toContain('sourceModule: "Maintenance Planning"');
    expect(ganttPage).toContain('contextType="gantt"');
    expect(ganttPage).toContain('sourceModule: "Gantt Charts"');
    expect(scorecardPage).toContain('contextType="scorecard"');
    expect(scorecardPage).toContain('sourceModule: "Monthly KPI Scorecard"');
  });
});
