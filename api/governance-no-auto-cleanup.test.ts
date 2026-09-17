/**
 * Regression tests: the obsolete Governance `cleanup-dates` mechanism is gone,
 * and normal Governance page loading performs no database writes.
 *
 * Background
 * ----------
 * `POST /api/governance/cleanup-dates` ran two blanket UPDATE statements against
 * `governance_milestone_state`, NULLing any `ppp_date` / `comp_date` that did not
 * match `^\d{4}-\d{2}-\d{2}$`. It was invoked automatically by governance.html
 * INIT() on EVERY page load, and its response was only console-logged — nothing
 * depended on the result.
 *
 * It became obsolete because malformed dates can no longer reach the table:
 * the normal save path validates both dates with isValidDate() (strict
 * YYYY-MM-DD plus a real-calendar check) before writing, and a deliberate,
 * targeted repair endpoint (/api/governance/repair-ppp) exists for fixing a
 * specific milestone. A blanket auto-UPDATE on page load is therefore both
 * unnecessary and undesirable: merely viewing Governance should never write.
 *
 * These tests lock in the removal and prove Governance still loads its data and
 * S-curve without it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const bootSource = readFileSync(resolve(ROOT, "api/boot.ts"), "utf8");
const governanceHtml = readFileSync(resolve(ROOT, "public/governance.html"), "utf8");

describe("Governance — obsolete cleanup-dates mechanism is removed", () => {
  it("does NOT register the /api/governance/cleanup-dates route in boot.ts", () => {
    expect(bootSource).not.toContain("cleanup-dates");
    expect(bootSource).not.toMatch(/app\.(post|get|put|delete)\(\s*"\/api\/governance\/cleanup-dates"/);
  });

  it("does NOT keep the blanket UPDATE statements that NULLed invalid dates", () => {
    // Those two statements were the only place ppp_date/comp_date were cleared
    // unconditionally by regex.
    expect(bootSource).not.toMatch(/SET\s+ppp_date\s*=\s*NULL[\s\S]{0,200}NOT REGEXP/);
    expect(bootSource).not.toMatch(/SET\s+comp_date\s*=\s*NULL[\s\S]{0,200}NOT REGEXP/);
  });

  it("does NOT reference cleanup-dates from the Governance page", () => {
    expect(governanceHtml).not.toContain("cleanup-dates");
    expect(governanceHtml).not.toContain("cleanupResp");
    expect(governanceHtml).not.toContain("Auto-cleanup");
  });

  it("has no remaining reference anywhere in the application surface", () => {
    // Guard against a re-introduction in either half of the mechanism.
    for (const src of [bootSource, governanceHtml]) {
      expect(src).not.toContain("cleanup-dates");
      expect(src).not.toContain("cleanupDates");
    }
  });
});

describe("Governance — normal page load performs NO maintenance write", () => {
  it("INIT() still runs the real load path", () => {
    expect(governanceHtml).toContain("async function INIT()");
    expect(governanceHtml).toContain("fetchStateFromDB");
    // LD() seeds the local state/structure the page renders
    expect(governanceHtml).toContain("try{LD();");
  });

  it("reads milestone state with a GET, not a write", () => {
    // fetchStateFromDB issues a plain fetch (default GET) against the state path.
    expect(governanceHtml).toMatch(/API_BASE\+'\/api\/governance\/state\/'\+encodeURIComponent\(facility\)/);
    // and does so without a mutating method
    const stateFetch = governanceHtml.slice(
      governanceHtml.indexOf("async function fetchStateFromDB"),
      governanceHtml.indexOf("async function fetchStateFromDB") + 1400
    );
    expect(stateFetch).not.toMatch(/method:\s*'(POST|PUT|DELETE|PATCH)'/);
  });

  it("does NOT call any automatic cleanup / repair / purge endpoint on load", () => {
    for (const term of ["cleanup", "repair-ppp", "purge", "normalizeDates"]) {
      expect(governanceHtml.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("keeps date validation on the normal save path, which is why cleanup is unnecessary", () => {
    expect(bootSource).toContain("function isValidDate(");
    // strict YYYY-MM-DD shape check
    expect(bootSource).toMatch(/isValidDate[\s\S]{0,400}\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
    // the save route still validates before writing
    expect(bootSource).toMatch(/app\.post\(\s*"\/api\/governance\/state\/:facilitySlug"/);
    expect(bootSource).toMatch(/sanitizedPP/);
    expect(bootSource).toMatch(/sanitizedCD/);
  });

  it("retains a deliberate, targeted repair endpoint for a specific milestone", () => {
    // Removing the automatic blanket cleanup must not remove the ability to fix
    // one known-bad value on purpose.
    expect(bootSource).toMatch(/app\.post\(\s*"\/api\/governance\/repair-ppp"/);
  });
});

describe("Governance — data loading and S-curve remain intact", () => {
  it("still renders the S-curve surface", () => {
    expect(governanceHtml).toContain("S-Curve");
    expect(governanceHtml).toContain("Logistic Model");
    // Planned / Actual are the S-curve series
    expect(governanceHtml).toMatch(/Planned = cumulative earned value/);
    expect(governanceHtml).toMatch(/Actual = cumulative earned value/);
    expect(governanceHtml).toMatch(/cumulative earned value from/);
  });

  it("still carries readiness / risk / RAG presentation", () => {
    expect(governanceHtml).toMatch(/readiness/i);
    expect(governanceHtml).toMatch(/risk level/i);
    expect(governanceHtml).toContain("RAG");
    expect(governanceHtml).toContain("riskColors");
  });

  it("still defines the four facilities and the milestone model", () => {
    for (const f of ["AGLIPAY", "HTT", "EASTBAY", "KAYSAKAT"]) {
      expect(governanceHtml).toContain(f);
    }
    // the manual status whitelist used by the save path
    expect(governanceHtml).toContain("planned_open");
  });

  it("keeps the legacy Governance UI served from public/governance.html", () => {
    expect(governanceHtml.length).toBeGreaterThan(100000);
  });
});
