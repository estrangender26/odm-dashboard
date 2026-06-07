import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const auditedAssistantPages = [
  "src/pages/Home.tsx",
  "src/pages/Dashboard.tsx",
  "src/pages/PostPlanningInsights.tsx",
  "src/pages/ScorecardDashboard.tsx",
  "src/pages/OmManualsLibrary.tsx",
  "src/pages/GovernanceDashboard.tsx",
  "src/pages/GanttPlanner.tsx",
  "src/pages/ExistingFacilitiesMaintenance.tsx",
  "src/pages/SmpDashboard.tsx",
  "src/pages/Help.tsx",
  "src/pages/OperatorDrivenMaintenance.tsx",
];

const assistantSource = () => repoFile("src/components/AIAssistant.tsx");
const legacyMarkerParts = [
  ["Ask AI", " about this Dashboard"],
  ["Groq AI ", "(Llama"],
  ["AI ", "Insights"],
  ["Scorecard", "AI"],
  ["aiFab", "Btn"],
  ["aiScorecard", "Panel"],
  ["aiScorecard", "Overlay"],
];
const legacyMarkers = legacyMarkerParts.map((parts) => parts.join(""));
const sourceFilesToGuard = [
  ...auditedAssistantPages,
  "src/App.tsx",
  "src/components/AiChatPanel.tsx",
  "public/governance.html",
  "public/mw-dashboard.html",
  "public/ai-assistant.js",
  "public/scorecard-kpi.html",
  "api/boot.ts",
];
const assistantShell = () => {
  const source = assistantSource();
  return source.slice(source.indexOf("  return (\n    <>") );
};

describe("AI assistant visual standardization", () => {
  it("keeps AIAssistant JSX shell free of context-specific visual branches", () => {
    const shell = assistantShell();

    expect(shell).not.toContain("contextType");
    expect(shell).not.toContain("maintenance");
    expect(shell).not.toContain("manuals");
    expect(shell).not.toContain("governance");
    expect(shell).not.toContain("Maintenance AI Expert");
    expect(shell).not.toContain("Senior Reliability Advisor");
    expect(shell).not.toContain("#005BAC");
  });


  it("keeps the visible assistant chrome shared instead of module-titled", () => {
    const source = assistantSource();
    const shell = assistantShell();
    const headerChrome = shell.slice(0, shell.indexOf("          {/* Messages */}"));

    expect(source).toContain('const SHARED_ASSISTANT_TITLE = "ODM Dashboard AI";');
    expect(source).toContain('const SHARED_ASSISTANT_SUBTITLE = "Grounded in active dashboard data";');
    expect(headerChrome).toContain("{SHARED_ASSISTANT_TITLE}");
    expect(headerChrome).toContain("{SHARED_ASSISTANT_SUBTITLE}");
    expect(headerChrome).not.toContain('title || "AI Analysis"');
    expect(headerChrome).not.toContain("odmTalkSource.sourceModule");
  });

  it("renders one shared visual section for fab, panel, header, input, voice, and ODM Talk", () => {
    const shell = assistantShell();

    expect(shell.match(/className="odm-ai-fab"/g) ?? []).toHaveLength(1);
    expect(shell.match(/className="odm-ai-panel"/g) ?? []).toHaveLength(1);
    expect(shell.match(/className="odm-ai-header"/g) ?? []).toHaveLength(1);
    expect(shell.match(/className="odm-ai-input-row"/g) ?? []).toHaveLength(1);
    expect(shell.match(/className="odm-ai-voice-controls"/g) ?? []).toHaveLength(1);
    expect(shell.match(/className="odm-ai-odm-talk"/g) ?? []).toHaveLength(1);
  });

  it("keeps required shared voice, ODM Talk, and grounding UI copy", () => {
    const source = assistantSource();

    expect(source).toContain("Start voice listening");
    expect(source).toContain("Voice reply ON");
    expect(source).toContain("Voice captured. Review then tap Send.");
    expect(source).toContain("ODM Talk Bridge");
    expect(source).toContain("Live web lookup is not enabled in this dashboard AI.");
  });

  it("keeps each audited page on exactly one unified React AIAssistant", () => {
    for (const file of auditedAssistantPages) {
      const source = repoFile(file);
      expect(source.match(/<AIAssistant\b/g) ?? [], file).toHaveLength(1);
    }
  });

  it("does not retain the old blue Maintenance AI Expert implementation", () => {
    const source = repoFile("src/components/AiChatPanel.tsx");

    expect(source).toContain("<AIAssistant");
    expect(source).not.toContain("Maintenance AI Expert");
    expect(source).not.toContain("Senior Reliability Advisor");
    expect(source).not.toContain("#005BAC");
  });



  it("keeps routed static entry points on the React app shell", () => {
    const app = repoFile("src/App.tsx");
    const boot = repoFile("api/boot.ts");

    expect(app).toContain('path="/governance"');
    expect(app).toContain('path="/mw-dashboard"');
    expect(boot).toContain('app.get("/governance", serveReactDashboard)');
    expect(boot).toContain('app.get("/mw-dashboard", serveReactDashboard)');
    expect(repoFile("public/governance.html")).toContain('url=/governance');
    expect(repoFile("public/mw-dashboard.html")).toContain('url=/mw-dashboard');
  });

  it("does not retain known legacy custom AI markers in guarded source", () => {
    for (const file of sourceFilesToGuard) {
      const source = repoFile(file);
      for (const marker of legacyMarkers) {
        expect(source.includes(marker), `${file} contains legacy marker: ${marker}`).toBe(false);
      }
    }
  });
});
