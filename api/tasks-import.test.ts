import { describe, expect, it } from "vitest";
import {
  buildMaintenanceImportPlan,
  buildMaintenanceTaskCode,
  formatMaintenanceImportFailure,
  normalizeImportKey,
  validateMaintenanceImportRows,
} from "./tasks-import";

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
    expect(formatMaintenanceImportFailure(plan.skipped, "Import mapping failed")).toContain("row 7 [Unknown Pump]");
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
});
