import { describe, expect, it } from "vitest";
import {
  buildMaintenanceImportPlan,
  formatMaintenanceImportFailure,
  normalizeImportKey,
  validateMaintenanceImportRows,
} from "./tasks-import";

describe("Maintenance Planning (Post-PPP) import", () => {
  const existing = [
    { id: 101, equipmentName: "Influent Pump", taskList: "Inspect seals and bearings" },
    { id: 102, equipmentName: "Blower – Aeration", taskList: "Check vibration" },
    { id: 201, equipmentName: "Clarifier", taskList: "Inspect scraper bridge" },
  ];

  it("maps exported valid rows back to existing dataset tasks without changing identity fields", () => {
    const plan = buildMaintenanceImportPlan([
      {
        rowNumber: 2,
        equipmentType: "Influent Pump",
        taskList: "Inspect seals and bearings",
        operations: "Operator",
        amd: "AMD in-house",
        ard: "Requires review",
        procedureFamiliarity: "Fully Familiar",
      },
      {
        rowNumber: 3,
        equipmentType: "Blower - Aeration",
        taskList: "Check vibration",
        operations: "Outsourced SLA",
      },
    ], existing, true);

    expect(plan.skipped).toEqual([]);
    expect(plan.unchanged).toBe(0);
    expect(plan.matches).toEqual([
      {
        row: 2,
        equipmentType: "Influent Pump",
        taskList: "Inspect seals and bearings",
        taskId: 101,
        updateData: {
          operations: "Operator",
          amd: "AMD in-house",
          ard: "Requires review",
          procedureFamiliarity: "Fully Familiar",
        },
      },
      {
        row: 3,
        equipmentType: "Blower - Aeration",
        taskList: "Check vibration",
        taskId: 102,
        updateData: { operations: "Outsourced SLA" },
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
    expect(formatMaintenanceImportFailure(plan.skipped, "Import mapping failed")).toContain("row 7 [Unknown Pump]");
  });

  it("rejects row values that would fail database varchar validation before a transaction starts", () => {
    const errors = validateMaintenanceImportRows([
      {
        rowNumber: 4,
        equipmentType: "Clarifier",
        taskList: "Inspect scraper bridge",
        operations: "x".repeat(101),
      },
    ]);

    expect(errors).toEqual([
      {
        row: 4,
        eq: "Clarifier",
        task: "Inspect scraper bridge",
        reason: "Operations exceeds 100 characters (101)",
      },
    ]);
  });

  it("keeps ambiguous equipment/task matches out of the update plan", () => {
    const plan = buildMaintenanceImportPlan([
      { rowNumber: 5, equipmentType: "Clarifier", taskList: "Inspect scraper bridge", amd: "AMD in-house" },
    ], [...existing, { id: 202, equipmentName: "Clarifier", taskList: "Inspect scraper bridge" }], true);

    expect(plan.matches).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({
      row: 5,
      reason: "Multiple matching tasks found; import would be ambiguous",
    });
  });

  it("normalizes whitespace, case, and en dash/hyphen variants for equipment mapping", () => {
    expect(normalizeImportKey("  Blower –  Aeration ")).toBe(normalizeImportKey("blower - aeration"));
  });
});
