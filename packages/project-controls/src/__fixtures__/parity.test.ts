import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildParitySnapshot } from "./parityScenarios";

/**
 * M1 parity oracle.
 *
 * `parityGolden.json` was captured from the authoritative PRE-extraction
 * implementation (ODM main 5d189f0) by compiling these same scenarios. The
 * extraction was a MOVE, so this test must reproduce the golden exactly.
 *
 * Byte comparison is the primary check (the serializer is deterministic);
 * deep structural equality is asserted as well so a formatting-only change
 * cannot mask a value change.
 */
const goldenText = readFileSync(new URL("./parityGolden.json", import.meta.url), "utf8");

describe("project-controls extraction parity (frozen pre-extraction oracle)", () => {
  it("reproduces the frozen pre-extraction snapshot byte-for-byte", () => {
    const snapshot = buildParitySnapshot();
    expect(JSON.stringify(snapshot, null, 2) + "\n").toBe(goldenText);
  });

  it("reproduces the frozen pre-extraction snapshot structurally", () => {
    expect(buildParitySnapshot()).toEqual(JSON.parse(goldenText));
  });

  it("covers the required scenario surface (guards against a silently emptied oracle)", () => {
    const g = JSON.parse(goldenText) as Record<string, any>;
    expect(g.scheduling).toHaveLength(10);
    expect(g.variance.rows.map((r: any) => r.name)).toEqual(
      expect.arrayContaining([
        "unchanged", "ahead", "late", "duration-longer", "duration-shorter",
        "completed-calendar-change", "completed-calendar-exception",
        "unfinished-calendar-change", "new-since-baseline", "removed-since-baseline",
        "archived-since-baseline", "undated-baseline", "milestone",
      ])
    );
    expect(g.progress.length).toBeGreaterThanOrEqual(18);
    expect(g.progress.some((p: any) => p.ok === false)).toBe(true);
    expect(g.progress.some((p: any) => p.ok === true && p.noop === false)).toBe(true);
    expect(g.calendars.countWorking).toEqual([5, 6, 4, 0, 0]);
    expect(g.staleness.driving.filter((d: any) => d.drives).length).toBeGreaterThan(0);
    expect(g.staleness.driving.filter((d: any) => !d.drives).length).toBeGreaterThan(0);
  });
});
