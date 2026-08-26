/**
 * Regression test: /governance is served by the original static
 * governance.html via the api/boot.ts legacy handler (restored architecture).
 * The handler must stay registered so the production page is the original
 * O&M Manual Governance UI, not the React SPA.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

describe("api/boot.ts — /governance is served by the original governance.html", () => {
  const bootSource = readFileSync(resolve(ROOT, "api/boot.ts"), "utf8");

  it("registers the legacy GET /governance handler", () => {
    expect(bootSource).toMatch(/app\.get\(\s*"\/governance"/);
  });

  it("serves /governance from dist/public/governance.html", () => {
    expect(bootSource).toContain('join(dp, "governance.html")');
    // The handler reads the resolved governance.html path back to the client.
    expect(bootSource).toContain("readFileSync(governancePath");
    expect(bootSource).toContain('c.html(content)');
  });

  it("keeps the /mw-dashboard handler (untouched)", () => {
    expect(bootSource).toContain('app.get("/mw-dashboard"');
  });
});
