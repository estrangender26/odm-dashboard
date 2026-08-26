/**
 * App routing regression test for the O&M Manual Governance page.
 *
 * Restored architecture: /governance is served by the original static
 * governance.html (via the api/boot.ts legacy handler); the React SPA does
 * NOT own a /governance route, and the replacement React GovernanceDashboard
 * must not be routed or imported at runtime.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("App routing — /governance is owned by the original UI, not React", () => {
  const appSource = readSource("src/App.tsx");

  it("does NOT import GovernanceDashboard", () => {
    expect(appSource).not.toContain("GovernanceDashboard");
  });

  it("does NOT route /governance to GovernanceDashboard", () => {
    expect(appSource).not.toContain('<Route path="/governance"');
  });

  it("keeps the Home entry point linked to /governance", () => {
    expect(readSource("src/pages/Home.tsx")).toContain('href="/governance"');
  });

  it("keeps the original static governance page present at public/governance.html", () => {
    const exists = (() => {
      try {
        readSource("public/governance.html");
        return true;
      } catch {
        return false;
      }
    })();
    expect(exists).toBe(true);
  });
});
