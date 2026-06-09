import { describe, expect, it } from "vitest";
import { fetchGanttProjectsDiagnostics } from "./gantt-projects-diagnostics";

function rows(value: Record<string, unknown>[]) {
  return { rows: value };
}

describe("fetchGanttProjectsDiagnostics", () => {
  it("keeps latest rows when tasks_data is malformed or legacy JSON", async () => {
    const executeResults = [
      rows([{ database: "prod", schema: "public", currentUser: "app" }]),
      rows([{ count: 4 }]),
      rows([
        {
          id: 1,
          name: "modern array",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-02",
          userId: 10,
          sessionId: "s1",
          __tasksData: '[{"id":1},{"id":2}]',
        },
        {
          id: 2,
          name: "legacy object",
          createdAt: "2026-01-03",
          updatedAt: "2026-01-04",
          userId: null,
          sessionId: "s2",
          __tasksData: '{"a":{"id":1},"b":{"id":2}}',
        },
        {
          id: 3,
          name: "malformed",
          createdAt: "2026-01-05",
          updatedAt: "2026-01-06",
          userId: null,
          sessionId: "s3",
          __tasksData: "[{bad json]",
        },
        {
          id: 4,
          name: "blank",
          createdAt: "2026-01-07",
          updatedAt: "2026-01-08",
          userId: null,
          sessionId: null,
          __tasksData: "",
        },
      ]),
      rows([{ userId: null, rows: 3 }]),
      rows([{ sessionId: "s1", rows: 1 }]),
      rows([{ totalRows: 4 }]),
    ];
    const db = {
      execute: async () => executeResults.shift() ?? rows([]),
    };

    const diagnostics = await fetchGanttProjectsDiagnostics(db);

    expect(diagnostics.rowCount).toBe(4);
    expect(diagnostics.latest).toEqual([
      expect.objectContaining({
        id: 1,
        name: "modern array",
        tasksCount: 2,
        tasksDataFormat: "array",
      }),
      expect.objectContaining({
        id: 2,
        name: "legacy object",
        tasksCount: 2,
        tasksDataFormat: "object",
      }),
      expect.objectContaining({
        id: 3,
        name: "malformed",
        tasksCount: null,
        tasksDataFormat: "malformed-json",
      }),
      expect.objectContaining({
        id: 4,
        name: "blank",
        tasksCount: 0,
        tasksDataFormat: "blank",
      }),
    ]);
    expect(diagnostics.latest[0]).not.toHaveProperty("__tasksData");
    expect(diagnostics.failingTasksCountSql).toContain("tasks_data::json");
    expect(diagnostics.sql).not.toContain("tasks_data::json");
    expect(diagnostics.sql).not.toContain("LIMIT 50");
  });
});
