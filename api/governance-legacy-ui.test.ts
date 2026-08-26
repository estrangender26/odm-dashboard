/**
 * Regression tests for the editable milestone status dropdown in the ORIGINAL
 * O&M Manual Governance UI (public/governance.html).
 *
 * Guards the production UI wiring: the STATUS column keeps the percentage
 * badge, gains the 5-option manual status dropdown in Edit mode, saves via the
 * existing /api/governance/state path (ready_status), preserves unrelated
 * fields, and reloads the persisted ready_status.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const legacy = readFileSync(resolve(ROOT, "public/governance.html"), "utf8");

describe("Legacy governance UI — editable milestone status dropdown", () => {
  it("remains the production UI file (public/governance.html)", () => {
    expect(legacy.length).toBeGreaterThan(100000);
    expect(legacy).toContain("O&amp;M Manual Governance");
  });

  it("keeps the existing percentage/progress badge in the STATUS column", () => {
    expect(legacy).toContain("badge.textContent=effPct+'%'");
    expect(legacy).toContain("'Status'");
  });

  it("provides exactly the five dropdown options with canonical values", () => {
    const block = "[['','Auto'],['achieved','Achieved'],['in_progress','In progress'],['planned_open','Planned by now — still open'],['upcoming','Upcoming']]";
    expect(legacy).toContain(block);
  });

  it("saves readyStatus through the existing /api/governance/state payload", () => {
    expect(legacy).toContain("readyStatus:changes.readyStatus!==undefined?changes.readyStatus:undefined");
    expect(legacy).toContain("'/api/governance/state/'+encodeURIComponent(facility)");
  });

  it("persists Auto as null and approved values as-is in the pending edit state", () => {
    expect(legacy).toContain("{readyStatus:ev.target.value===''?null:ev.target.value}");
  });

  it("merge-updates pending state so a status change never clobbers a pending compDate", () => {
    expect(legacy).toContain("Object.assign({},PENDING[f2].ms[mid],{readyStatus:");
    expect(legacy).toContain("Object.assign({},PENDING[f].ms[mid],{compDate:");
  });

  it("discards pending status changes on Cancel", () => {
    expect(legacy).toContain("PENDING={};");
  });

  it("reloads the persisted ready_status from governance_milestone_state", () => {
    expect(legacy).toContain("s.ready_status");
    expect(legacy).toContain("ST[facility].ms[mid].readyStatus=rawRS;");
  });

  it("does not reintroduce the React GovernanceDashboard component", () => {
    expect(legacy).not.toContain("GovernanceDashboard");
  });
});

describe("Legacy /api/governance/state endpoint — readyStatus whitelist (boot.ts)", () => {
  const boot = readFileSync(resolve(ROOT, "api/boot.ts"), "utf8");

  it("imports the shared manual status validator", () => {
    expect(boot).toContain('import { isValidManualStatus } from "../src/modules/governance-v3/milestoneStatusManual";');
  });

  it("rejects invalid readyStatus server-side on the legacy endpoint", () => {
    expect(boot).toMatch(/if \(readyStatus !== undefined && readyStatus !== null && !isValidManualStatus\(readyStatus\)\)/);
    expect(boot).toContain('"Invalid readyStatus. Allowed: achieved, in_progress, planned_open, upcoming, null."');
  });
});
