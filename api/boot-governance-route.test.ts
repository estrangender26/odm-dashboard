/**
 * Regression test: /governance must be owned by the React SPA, not a legacy
 * server-side handler.
 *
 * Production 404 root cause: api/boot.ts registered a hard-coded
 * GET /governance handler that read dist/public/governance.html. PR #383
 * renamed that legacy file to governance-legacy.html so the React
 * GovernanceDashboard could own /governance, but the boot.ts handler was
 * registered before the static SPA fallback and returned 404
 * ("Governance dashboard not found") instead of letting React routing run.
 *
 * These source-level assertions guard against the handler being re-added.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

describe("api/boot.ts — /governance routes to the React SPA", () => {
  const bootSource = readFileSync(resolve(ROOT, "api/boot.ts"), "utf8");

  it("no longer registers a legacy GET /governance handler", () => {
    expect(bootSource).not.toMatch(/app\.get\(\s*"\/governance"/);
  });

  it("no longer serves /governance from the removed dist/public/governance.html file", () => {
    expect(bootSource).not.toContain('join(dp, "governance.html")');
    expect(bootSource).not.toMatch(/readFileSync\([^)]*governance\.html/);
  });

  it("keeps the /mw-dashboard handler (untouched)", () => {
    expect(bootSource).toContain('app.get("/mw-dashboard"');
  });
});
