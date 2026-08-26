/**
 * App routing regression test for the O&M Manual Governance page.
 *
 * Root cause of the production UI regression: the React GovernanceDashboard
 * (where the editable milestone status dropdown lives) was NOT wired to any
 * route — the /governance URL was served by the legacy static
 * public/governance.html instead, so the PR #382 dropdown never rendered.
 *
 * These source-level assertions guard against the route/import being removed
 * again (which silently tree-shakes the page out of the bundle).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("App routing — O&M Manual Governance page is reachable", () => {
  const appSource = readSource("src/App.tsx");

  it("imports GovernanceDashboard", () => {
    expect(appSource).toContain('import GovernanceDashboard from "./pages/GovernanceDashboard";');
  });

  it("routes /governance to GovernanceDashboard", () => {
    expect(appSource).toContain('<Route path="/governance" element={<GovernanceDashboard />} />');
  });

  it("keeps the Home entry point linked to /governance", () => {
    const homeSource = readSource("src/pages/Home.tsx");
    expect(homeSource).toContain('href="/governance"');
  });

  it("no longer serves the legacy static governance page at /governance", () => {
    // The legacy standalone UI must not shadow the React route.
    const legacyExists = (() => {
      try {
        readSource("public/governance.html");
        return true;
      } catch {
        return false;
      }
    })();
    expect(legacyExists).toBe(false);
  });
});
