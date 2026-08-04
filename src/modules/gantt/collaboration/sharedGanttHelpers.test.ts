import "dotenv/config";
import { describe, it, expect } from "vitest";
import {
  collectTaskAndDescendantIds,
  validateActualDateOrdering,
} from "../../../../api/shared-gantt-router";

describe("sharedGantt helper logic", () => {
  it("collects a task and all descendants", () => {
    const tasks = [
      { id: 1, parentTaskId: 0 },
      { id: 2, parentTaskId: 1 },
      { id: 3, parentTaskId: 2 },
      { id: 4, parentTaskId: 0 },
    ];
    const ids = collectTaskAndDescendantIds(1, tasks);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });

  it("validates actual date ordering", () => {
    expect(validateActualDateOrdering({ actualStart: "2026-08-01", actualFinish: "2026-08-10" }).ok).toBe(true);
    expect(validateActualDateOrdering({ actualStart: "2026-08-10", actualFinish: "2026-08-01" }).ok).toBe(false);
    expect(validateActualDateOrdering({ actualStart: "2026-08-01", actualFinish: null }).ok).toBe(true);
    expect(validateActualDateOrdering({ actualStart: null, actualFinish: "2026-08-01" }).ok).toBe(true);
  });
});
