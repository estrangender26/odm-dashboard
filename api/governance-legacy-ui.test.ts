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

  it("shows the status dropdown only in Edit mode (hidden in view mode)", () => {
    expect(legacy).toContain("stSel.style.display=EDIT_MODE?'block':'none';");
    // The select is a child of the STATUS cell but must not be visible in view mode.
    expect(legacy).toContain("c7.appendChild(stSel)");
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

  it("updates the local milestone state on Save so the chip persists before any reload", () => {
    expect(legacy).toContain("ST[f].ms[mId].readyStatus=v.readyStatus;");
  });

  it("keeps a status-only edit from touching compDate/pppDate/customPct in the payload", () => {
    // The payload only carries readyStatus when the other fields are undefined.
    expect(legacy).toContain("readyStatus:changes.readyStatus!==undefined?changes.readyStatus:undefined");
    expect(legacy).toContain("compDate:changes.compDate!==undefined?changes.compDate:undefined");
    expect(legacy).toContain("customPct:changes.pct!==undefined?changes.pct:undefined");
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

  it("GET state reload returns ready_status for every milestone row", () => {
    expect(boot).toMatch(/SELECT id, facility_slug, milestone_id, ppp_date, comp_date, custom_pct, ready_status, remarks, updated_at, updated_by/);
  });

  it("UPDATE persists ready_status: undefined leaves it unchanged, null clears it, valid string sets it", () => {
    // The guard is `!== undefined` (never a truthy `if (readyStatus)`), so null is
    // handled explicitly: undefined -> unchanged, null -> NULL, string -> value.
    expect(boot).toMatch(/readyStatus !== undefined\) setParts\.push\("ready_status = " \+ \(readyStatus === null \? 'NULL' : "'" \+ readyStatus \+ "'"\)\)/);
    expect(boot).not.toMatch(/if \(readyStatus\) \{/);
  });

  it("INSERT persists ready_status on new milestone rows", () => {
    expect(boot).toContain("facility_slug, milestone_id, comp_date, custom_pct, ppp_date, ready_status, updated_at");
    expect(boot).toContain("readyStatus !== undefined ? readyStatus : null");
  });
});
