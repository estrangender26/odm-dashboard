import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Boot integration regression tests
 * 
 * These tests verify that api/boot.ts correctly:
 * - Registers serveStaticFiles(app)
 * - Registers all three Governance AI endpoints  
 * - Registers /_debug/static endpoint
 * - Imports and calls executeProductionStartup
 * - Does NOT contain detached migrationReadyPromise
 */

describe("boot.ts integration regression", () => {
  const bootSource = fs.readFileSync(
    path.join(__dirname, "boot.ts"), 
    "utf-8"
  );

  it("imports executeProductionStartup from production-startup module", () => {
    expect(bootSource).toContain("executeProductionStartup");
    expect(bootSource).toContain('./production-startup');
  });

  it("registers serveStaticFiles(app)", () => {
    expect(bootSource).toContain("serveStaticFiles(app)");
  });

  it("registers /_debug/static endpoint", () => {
    expect(bootSource).toContain('app.get("/_debug/static"');
  });

  it("registers /api/governance/ai-insights endpoint", () => {
    expect(bootSource).toContain('app.post("/api/governance/ai-insights"');
  });

  it("registers /api/governance/ai-chat endpoint", () => {
    expect(bootSource).toContain('app.post("/api/governance/ai-chat"');
  });

  it("registers /api/governance/ai-summary endpoint", () => {
    expect(bootSource).toContain('app.post("/api/governance/ai-summary"');
  });

  it("does NOT contain detached migrationReadyPromise", () => {
    expect(bootSource).not.toContain("migrationReadyPromise.catch");
    expect(bootSource).not.toMatch(/const migrationReadyPromise\s*=/);
  });

  it("awaits executeProductionStartup in production block", () => {
    expect(bootSource).toContain("await executeProductionStartup(startupDeps)");
  });
});
