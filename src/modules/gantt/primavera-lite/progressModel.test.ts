import { describe, expect, it } from "vitest";
import {
  deriveProgressState,
  isCompletedState,
  percentAfterClearingActualFinish,
  resolveProgress,
  type ProgressFields,
} from "./progressModel";

const base: ProgressFields = {
  percentComplete: 0,
  actualStart: null,
  actualFinish: null,
  status: null,
  remainingDurationDays: 0,
  originalDurationDays: 5,
};

const completed: ProgressFields = {
  ...base,
  percentComplete: 100,
  actualStart: "2026-08-03",
  actualFinish: "2026-08-07",
  status: "completed",
  remainingDurationDays: 0,
};

describe("progressModel — canonical derivation", () => {
  it("derives completed only from 100% AND an Actual Finish", () => {
    expect(deriveProgressState(100, "2026-08-03", "2026-08-07")).toBe("completed");
    expect(deriveProgressState(100, "2026-08-03", null)).toBe("in-progress");
    expect(deriveProgressState(0, null, null)).toBe("not-started");
    expect(deriveProgressState(0, "2026-08-03", null)).toBe("in-progress");
    expect(deriveProgressState(50, null, null)).toBe("in-progress");
    expect(isCompletedState(100, "2026-08-07")).toBe(true);
    expect(isCompletedState(100, null)).toBe(false);
    expect(isCompletedState(50, "2026-08-07")).toBe(false);
  });

  it("clearing Actual Finish at 100% yields 99% with Actual Start, 0% without (T2b)", () => {
    expect(percentAfterClearingActualFinish("2026-08-03")).toBe(99);
    expect(percentAfterClearingActualFinish(null)).toBe(0);
    expect(percentAfterClearingActualFinish("2026-08-03", 45)).toBe(45);
    expect(percentAfterClearingActualFinish(null, 100)).toBe(0);
  });
});

describe("progressModel — explicit contradictions are rejected (V-rules)", () => {
  it("V1: completed status with < 100%", () => {
    const r = resolveProgress({ current: base, changes: { status: "completed", percentComplete: 60 }, dataDate: null, mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Completed status requires 100%/);
  });

  it("V2: Actual Finish with < 100%", () => {
    const r = resolveProgress({ current: base, changes: { actualFinish: "2026-08-07" }, dataDate: null, mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Actual Finish requires 100% complete/);
  });

  it("V3: Actual Finish before Actual Start", () => {
    const r = resolveProgress({ current: base, changes: { actualStart: "2026-08-10", actualFinish: "2026-08-09", percentComplete: 100 }, dataDate: null, mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Actual start must be on or before actual finish/);
  });

  it("V4: completed with positive remaining duration", () => {
    const r = resolveProgress({ current: base, changes: { percentComplete: 100, actualFinish: "2026-08-07", remainingDurationDays: 2 }, dataDate: "2026-08-07", mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/positive remaining duration/);
  });

  it("V5: unknown non-null status", () => {
    const r = resolveProgress({ current: base, changes: { status: "done" }, dataDate: null, mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown activity status/);
  });

  it("V6: in-progress status with 0% or 100%", () => {
    expect(resolveProgress({ current: base, changes: { status: "in-progress", percentComplete: 0 }, dataDate: null, mode: "update" }).ok).toBe(false);
    expect(resolveProgress({ current: base, changes: { status: "in-progress", percentComplete: 100, actualFinish: "2026-08-07" }, dataDate: null, mode: "update" }).ok).toBe(false);
  });

  it("V7: not-started status with progress or actual dates", () => {
    expect(resolveProgress({ current: base, changes: { status: "not-started", percentComplete: 30 }, dataDate: null, mode: "update" }).ok).toBe(false);
    expect(resolveProgress({ current: base, changes: { status: "not-started", actualStart: "2026-08-01" }, dataDate: null, mode: "update" }).ok).toBe(false);
  });

  it("V8: percentage outside 0-100 and negative remaining", () => {
    expect(resolveProgress({ current: base, changes: { percentComplete: 150 }, dataDate: null, mode: "update" }).ok).toBe(false);
    expect(resolveProgress({ current: base, changes: { percentComplete: -5 }, dataDate: null, mode: "update" }).ok).toBe(false);
    expect(resolveProgress({ current: base, changes: { remainingDurationDays: -1 }, dataDate: null, mode: "update" }).ok).toBe(false);
  });

  it("V9/V7: explicit status contradicting the derived state is rejected", () => {
    // not-started with an Actual Start is rejected (V7 — the more specific rule).
    const r = resolveProgress({ current: base, changes: { status: "not-started", actualStart: "2026-08-01" }, dataDate: null, mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not-started status cannot have progress or actual dates/);
  });

  it("does not silently repair a contradictory explicit completion", () => {
    const r = resolveProgress({ current: base, changes: { status: "completed", percentComplete: 0 }, dataDate: "2026-08-10", mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Completed status requires 100%/);
  });
});

describe("progressModel — deliberate transitions (T1 / T2)", () => {
  it("T1: percentComplete to 100 with no Actual Finish uses the Data Date", () => {
    const r = resolveProgress({ current: base, changes: { percentComplete: 100 }, dataDate: "2026-08-13", mode: "update" });
    expect(r.ok).toBe(true);
    expect(r.values?.actualFinish).toBe("2026-08-13");
    expect(r.values?.remainingDurationDays ?? 0).toBe(0);
    expect(r.values?.status).toBe("completed");
  });

  it("T1: rejects when Data Date is missing", () => {
    const r = resolveProgress({ current: base, changes: { percentComplete: 100 }, dataDate: null, mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Project Data Date is required/);
  });

  it("T1: rejects when Data Date precedes Actual Start", () => {
    const inProgress: ProgressFields = { ...base, percentComplete: 25, actualStart: "2026-08-14" };
    const r = resolveProgress({ current: inProgress, changes: { percentComplete: 100 }, dataDate: "2026-08-13", mode: "update" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/precedes Actual Start/);
  });

  it("T2: reducing % below 100 clears Actual Finish and derives remaining/status", () => {
    const r = resolveProgress({ current: completed, changes: { percentComplete: 60 }, dataDate: null, mode: "update" });
    expect(r.ok).toBe(true);
    expect(r.values?.actualFinish).toBeNull();
    expect(r.values?.remainingDurationDays).toBe(2); // 5 * (1 - 0.6) rounded = 2
    expect(r.values?.status).toBe("in-progress");
  });

  it("T2: completing via explicit Actual Finish requires 100% (V2), explicit transition works", () => {
    expect(resolveProgress({ current: { ...base, percentComplete: 25 }, changes: { actualFinish: "2026-08-14" }, dataDate: null, mode: "update" }).ok).toBe(false);
    const ok = resolveProgress({ current: { ...base, percentComplete: 25 }, changes: { actualFinish: "2026-08-14", percentComplete: 100 }, dataDate: null, mode: "update" });
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.values?.percentComplete).toBe(100);
    expect(ok.ok && ok.values?.status).toBe("completed");
  });

  it("create mode sanctions an explicit Actual Finish as completion", () => {
    const r = resolveProgress({ current: base, changes: { actualFinish: "2026-08-12" }, dataDate: null, mode: "create" });
    expect(r.ok).toBe(true);
    expect(r.values?.percentComplete).toBe(100);
  });

  it("create mode with an explicit contradictory % < 100 and Actual Finish is rejected", () => {
    const r = resolveProgress({ current: base, changes: { actualFinish: "2026-08-12", percentComplete: 40 }, dataDate: null, mode: "create" });
    expect(r.ok).toBe(false);
  });

  it("no-op edits are detected and return empty values", () => {
    const r = resolveProgress({ current: base, changes: { percentComplete: 0 }, dataDate: null, mode: "update" });
    expect(r.ok).toBe(true);
    expect(r.noop).toBe(true);
    expect(r.values).toEqual({});
  });
});
