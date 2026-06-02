import { describe, expect, it } from "vitest";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  MaintenanceImportError,
  buildImportDiagnostics,
  buildMaintenanceImportPlan,
  buildMaintenanceTaskCode,
  formatMaintenanceImportFailure,
  importMaintenancePlanningRows,
  normalizeImportKey,
  validateMaintenanceImportRows,
  type MaintenanceDbLike,
  type MaintenanceExistingRow,
} from "./tasks-import";

const pgDialect = new PgDialect();
const SQL_RENDER_CONFIG = {
  casing: { getColumnCasing: (column: { name: string }) => column.name },
  escapeName: pgDialect.escapeName.bind(pgDialect),
  escapeParam: pgDialect.escapeParam.bind(pgDialect),
  escapeString: pgDialect.escapeString.bind(pgDialect),
};

function renderSql(query: SQL): string {
  return query.toQuery(SQL_RENDER_CONFIG as unknown as Parameters<SQL["toQuery"]>[0]).sql.replace(/\s+/g, " ").trim();
}

function expectUpdateSetTargetsToBeUnqualified(renderedSql: string): void {
  expect(renderedSql).not.toMatch(/SET "tasks"\."(?:frequency|responsible_personnel|operations|amd|ard|procedure_familiarity)" =/);
  expect(renderedSql).toMatch(/UPDATE "tasks" SET "(?:frequency|responsible_personnel|operations|amd|ard|procedure_familiarity)" = CASE "tasks"\."id"/);
  expect(renderedSql).toContain('WHERE "tasks"."dataset" =');
  expect(renderedSql).toContain('AND "tasks"."id" IN');
}

describe("Maintenance Planning (Post-PPP) import", () => {
  const existing = [
    { id: 101, dataset: "htt", equipmentCode: "IP", equipmentName: "Influent Pump", taskList: "Inspect seals and bearings" },
    { id: 102, dataset: "htt", equipmentCode: "BA", equipmentName: "Blower – Aeration", taskList: "Check vibration" },
    { id: 201, dataset: "htt", equipmentCode: "CL", equipmentName: "Clarifier", taskList: "Inspect scraper bridge" },
  ];

  it("prioritizes task_id for exported rows and updates editable fields only", () => {
    const plan = buildMaintenanceImportPlan([
      {
        rowNumber: 2,
        taskId: 101,
        taskCode: "tampered-code-is-ignored-when-task-id-is-present",
        facilityDataset: "HTT STP",
        equipmentType: "Renamed in spreadsheet but ignored for identity",
        taskList: "Edited task text is ignored for identity",
        frequency: "Monthly",
        responsiblePersonnel: "Operations Lead",
        operations: "Operator",
        amd: "AMD in-house",
        ard: "Requires review",
        procedureFamiliarity: "Fully Familiar",
      },
    ], existing, true);

    expect(plan.skipped).toEqual([]);
    expect(plan.matches).toEqual([
      {
        row: 2,
        equipmentType: "Influent Pump",
        taskList: "Inspect seals and bearings",
        taskId: 101,
        updateData: {
          frequency: "Monthly",
          responsiblePersonnel: "Operations Lead",
          operations: "Operator",
          amd: "AMD in-house",
          ard: "Requires review",
          procedureFamiliarity: "Fully Familiar",
        },
      },
    ]);
  });

  it("canonicalizes legacy familiarity import values to procedureFamiliarity updates", () => {
    const plan = buildMaintenanceImportPlan([
      {
        rowNumber: 3,
        taskId: 101,
        equipmentType: "Influent Pump",
        taskList: "Inspect seals and bearings",
        familiarity: "Partially Familiar",
      },
    ], existing, true);

    expect(plan.skipped).toEqual([]);
    expect(plan.matches[0]).toMatchObject({
      taskId: 101,
      updateData: { procedureFamiliarity: "Partially Familiar" },
    });
  });

  it("falls back from missing task_id to stable task_code before equipment/task text", () => {
    const plan = buildMaintenanceImportPlan([
      {
        rowNumber: 3,
        taskId: "",
        taskCode: buildMaintenanceTaskCode(existing[1]),
        equipmentType: "Incorrect equipment text",
        taskList: "Incorrect task text",
        operations: "Outsourced SLA",
      },
    ], existing, true);

    expect(plan.skipped).toEqual([]);
    expect(plan.matches[0]).toMatchObject({ taskId: 102, updateData: { operations: "Outsourced SLA" } });
  });

  it("uses equipment/task fallback only when stable IDs are absent", () => {
    const plan = buildMaintenanceImportPlan([
      { rowNumber: 4, equipmentType: "Blower - Aeration", taskList: "Check vibration", amd: "AMD in-house" },
    ], existing, true);

    expect(plan.skipped).toEqual([]);
    expect(plan.matches[0]).toMatchObject({ taskId: 102, updateData: { amd: "AMD in-house" } });
  });

  it("rejects invalid task_id clearly", () => {
    const errors = validateMaintenanceImportRows([
      { rowNumber: 5, taskId: "not-a-number", equipmentType: "Influent Pump", taskList: "Inspect seals and bearings" },
    ], "htt");

    expect(errors).toEqual([
      {
        row: 5,
        eq: "Influent Pump",
        task: "Inspect seals and bearings",
        reason: "Invalid task_id; expected a positive numeric task_id from the export",
      },
    ]);
  });

  it("rejects imports whose exported dataset does not match the active dataset", () => {
    const errors = validateMaintenanceImportRows([
      { rowNumber: 6, taskId: 101, facilityDataset: "HTT STP", equipmentType: "Influent Pump", taskList: "Inspect seals and bearings" },
    ], "aglipay");

    expect(errors).toEqual([
      {
        row: 6,
        eq: "Influent Pump",
        task: "Inspect seals and bearings",
        reason: "File facility/dataset HTT STP does not match active dataset Aglipay STP",
      },
    ]);
  });

  it("reports row-level mapping errors instead of silently skipping missing equipment or tasks", () => {
    const plan = buildMaintenanceImportPlan([
      { rowNumber: 7, equipmentType: "Unknown Pump", taskList: "Inspect seals and bearings", operations: "Operator" },
    ], existing, true);

    expect(plan.matches).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        row: 7,
        eq: "Unknown Pump",
        task: "Inspect seals and bearings",
        reason: "No matching task found for this dataset/equipment/task",
      },
    ]);
    expect(formatMaintenanceImportFailure(plan.skipped, "Import mapping failed")).toContain("Row 7 rejected [Unknown Pump]");
    expect(formatMaintenanceImportFailure(plan.skipped, "Import mapping failed")).toContain("Required fix: Import a fresh export with task_id/task_code");
  });

  it("rejects row values that would fail database varchar validation before a transaction starts", () => {
    const errors = validateMaintenanceImportRows([
      {
        rowNumber: 8,
        equipmentType: "Clarifier",
        taskList: "Inspect scraper bridge",
        operations: "x".repeat(101),
      },
    ], "htt");

    expect(errors).toEqual([
      {
        row: 8,
        eq: "Clarifier",
        task: "Inspect scraper bridge",
        reason: "Operations exceeds 100 characters (101)",
      },
    ]);
  });

  it("keeps ambiguous equipment/task fallback matches out of the update plan with diagnostics", () => {
    const plan = buildMaintenanceImportPlan([
      { rowNumber: 9, equipmentType: "Clarifier", taskList: "Inspect scraper bridge", amd: "AMD in-house" },
    ], [...existing, { id: 202, dataset: "htt", equipmentCode: "CL", equipmentName: "Clarifier", taskList: "Inspect scraper bridge" }], true);

    expect(plan.matches).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({
      row: 9,
      reason: "Multiple matching tasks found by equipment/task fallback; include task_id or task_code from a fresh export to disambiguate",
    });
  });

  it("normalizes whitespace, case, and en dash/hyphen variants for equipment mapping", () => {
    expect(normalizeImportKey("  Blower –  Aeration ")).toBe(normalizeImportKey("blower - aeration"));
  });

  it("creates structured 400 payloads for expected validation failures", () => {
    const skipped = validateMaintenanceImportRows([
      { rowNumber: 10, taskId: "bad-id", equipmentType: "Clarifier", taskList: "Inspect scraper bridge" },
    ], "htt");
    const error = new MaintenanceImportError("validation", formatMaintenanceImportFailure(skipped), skipped, buildImportDiagnostics([
      { rowNumber: 10, taskId: "bad-id", equipmentType: "Clarifier", taskList: "Inspect scraper bridge" },
    ], skipped));

    expect(error.statusCode).toBe(400);
    expect(error.toPayload()).toMatchObject({
      success: false,
      kind: "validation",
      rejected: 1,
      skipped: [{ row: 10, reason: "Invalid task_id; expected a positive numeric task_id from the export" }],
      diagnostics: [{ row: 10, hasTaskId: true, matchingPath: "task_id", rejectionReason: "Invalid task_id; expected a positive numeric task_id from the export" }],
    });
  });


  it("generates valid PostgreSQL CASE SQL for a single-row update", async () => {
    const existingRows: MaintenanceExistingRow[] = [{
      id: 101,
      dataset: "htt",
      equipmentCode: "IP",
      equipmentName: "Influent Pump",
      taskList: "Inspect seals and bearings",
    }];
    const renderedStatements: string[] = [];
    const fakeDb: MaintenanceDbLike = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => existingRows,
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
      execute: async (query) => {
        renderedStatements.push(renderSql(query as SQL));
      },
      transaction: async (fn) => fn(fakeDb),
    };

    const result = await importMaintenancePlanningRows(fakeDb, {
      dataset: "htt",
      rows: [{
        taskId: 101,
        taskCode: buildMaintenanceTaskCode(existingRows[0]),
        facilityDataset: "HTT STP",
        equipmentType: "Influent Pump",
        taskList: "Inspect seals and bearings",
        frequency: "Monthly",
      }],
    }, true);

    expect(result.updated).toBe(1);
    expect(renderedStatements).toHaveLength(1);
    expectUpdateSetTargetsToBeUnqualified(renderedStatements[0]);
    expect(renderedStatements[0]).toContain('SET "frequency" = CASE "tasks"."id"');
  });

  it("generates valid PostgreSQL CASE SQL for multi-row chunk updates", async () => {
    const existingRows: MaintenanceExistingRow[] = existing.map((row) => ({ ...row }));
    const renderedStatements: string[] = [];
    const fakeDb: MaintenanceDbLike = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => existingRows,
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
      execute: async (query) => {
        renderedStatements.push(renderSql(query as SQL));
      },
      transaction: async (fn) => fn(fakeDb),
    };

    const result = await importMaintenancePlanningRows(fakeDb, {
      dataset: "htt",
      rows: existingRows.map((row) => ({
        taskId: row.id,
        taskCode: buildMaintenanceTaskCode(row),
        facilityDataset: "HTT STP",
        equipmentType: row.equipmentName,
        taskList: row.taskList,
        frequency: "Monthly",
        responsiblePersonnel: "Plant Operators",
        operations: "Operator",
        amd: "AMD in-house",
        ard: "ARD team",
        procedureFamiliarity: "Fully Familiar",
      })),
    }, true);

    expect(result.updated).toBe(3);
    expect(renderedStatements).toHaveLength(6);
    renderedStatements.forEach(expectUpdateSetTargetsToBeUnqualified);
    expect(renderedStatements.join("\n")).toContain('SET "procedure_familiarity" = CASE "tasks"."id"');
  });

  it("imports a 975-task modified export roundtrip using split-field 25-row batches", async () => {
    const existingRows: MaintenanceExistingRow[] = Array.from({ length: 975 }, (_, index) => ({
      id: index + 1,
      dataset: "htt",
      equipmentCode: `EQ${index + 1}`,
      equipmentName: `Equipment ${index + 1}`,
      taskList: `Task ${index + 1}`,
    }));
    const executedStatements: string[] = [];
    const fakeDb: MaintenanceDbLike = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => existingRows,
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
      execute: async (query) => {
        executedStatements.push(renderSql(query as SQL));
      },
      transaction: async (fn) => fn(fakeDb),
    };

    const result = await importMaintenancePlanningRows(fakeDb, {
      dataset: "htt",
      rows: existingRows.map((row) => ({
        taskId: row.id,
        taskCode: buildMaintenanceTaskCode(row),
        facilityDataset: "HTT STP",
        equipmentType: row.equipmentName,
        taskList: row.taskList,
        frequency: "Monthly",
        responsiblePersonnel: "Plant Operators",
        operations: "Operator",
        amd: "AMD in-house",
        ard: "ARD team",
        procedureFamiliarity: "Fully Familiar",
      })),
    }, true);

    expect(result.updated).toBe(975);
    expect(result.metrics).toMatchObject({
      total_rows: 975,
      initial_rows_per_chunk: 25,
      chunk_count: 39,
      statement_count: 234,
      max_parameter_count: 76,
      max_generated_sql_length: 895,
    });
    expect(executedStatements).toHaveLength(234);
    executedStatements.forEach(expectUpdateSetTargetsToBeUnqualified);
  });

  it("falls back adaptively to sequential updates for a failed one-row batch", async () => {
    const existingRows: MaintenanceExistingRow[] = [{
      id: 101,
      dataset: "htt",
      equipmentCode: "IP",
      equipmentName: "Influent Pump",
      taskList: "Inspect seals and bearings",
    }];
    let executeAttempts = 0;
    let sequentialUpdates = 0;
    const fakeDb: MaintenanceDbLike = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => existingRows,
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => { sequentialUpdates += 1; },
        }),
      }),
      execute: async () => {
        executeAttempts += 1;
        throw new Error("simulated oversized CASE statement");
      },
      transaction: async (fn) => fn(fakeDb),
    };

    const result = await importMaintenancePlanningRows(fakeDb, {
      dataset: "htt",
      rows: [{
        taskId: 101,
        taskCode: buildMaintenanceTaskCode(existingRows[0]),
        facilityDataset: "HTT STP",
        equipmentType: "Influent Pump",
        taskList: "Inspect seals and bearings",
        frequency: "Monthly",
      }],
    }, true);

    expect(result.updated).toBe(1);
    expect(executeAttempts).toBe(1);
    expect(sequentialUpdates).toBe(1);
    expect(result.metrics.sequential_fallback_count).toBe(1);
    expect(result.metrics.retry_count).toBe(1);
  });

});
