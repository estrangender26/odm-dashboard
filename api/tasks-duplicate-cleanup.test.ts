import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMaintenanceDuplicateCleanupPlan,
  exportDuplicateCleanupDryRun,
  type MaintenanceDuplicateRow,
} from "./tasks-duplicate-cleanup";

const baseRow = (
  overrides: Partial<MaintenanceDuplicateRow>
): MaintenanceDuplicateRow => ({
  id: 1,
  dataset: "htt",
  equipmentId: 10,
  equipmentCode: "PMP",
  equipmentName: "Pump",
  taskList: "Inspect seals",
  frequency: "Monthly",
  operations: null,
  amd: null,
  ard: null,
  procedureFamiliarity: null,
  responsiblePersonnel: null,
  ...overrides,
});

describe("Post-PPP planning duplicate cleanup planning", () => {
  it("groups duplicates by dataset, equipment, normalized task description, and normalized frequency", () => {
    const plan = buildMaintenanceDuplicateCleanupPlan([
      baseRow({ id: 10, taskList: "Inspect  seals", frequency: "Monthly" }),
      baseRow({ id: 11, taskList: "inspect seals", frequency: " monthly " }),
      baseRow({
        id: 12,
        dataset: "aglipay",
        taskList: "inspect seals",
        frequency: "monthly",
      }),
    ]);

    expect(plan.duplicateGroupCount).toBe(1);
    expect(plan.duplicateRowCount).toBe(2);
    expect(plan.rowsProposedForDeletion).toEqual([11]);
    expect(plan.rowsPreserved).toEqual([10]);
    expect(plan.conflictGroups).toBe(0);
    expect(plan.report[0]).toMatchObject({
      duplicateIds: [10, 11],
      proposedKeeperId: 10,
      proposedDeleteIds: [11],
      action: "delete",
    });
  });

  it("keeps the row with populated planning fields over an older blank duplicate", () => {
    const plan = buildMaintenanceDuplicateCleanupPlan([
      baseRow({ id: 20 }),
      baseRow({
        id: 21,
        operations: "Ops",
        amd: "AMD",
        ard: "ARD",
        procedureFamiliarity: "Fully Familiar",
        responsiblePersonnel: "Maintenance",
      }),
    ]);

    expect(plan.rowsProposedForDeletion).toEqual([20]);
    expect(plan.rowsPreserved).toEqual([21]);
    expect(plan.report[0]).toMatchObject({
      proposedKeeperId: 21,
      action: "delete",
    });
  });

  it("flags groups with different populated stakeholder preferences for manual review", () => {
    const plan = buildMaintenanceDuplicateCleanupPlan([
      baseRow({ id: 30, operations: "Operations Team" }),
      baseRow({ id: 31, operations: "Contractor" }),
      baseRow({ id: 32, operations: null }),
    ]);

    expect(plan.conflictGroups).toBe(1);
    expect(plan.rowsProposedForDeletion).toEqual([]);
    expect(plan.rowsPreserved).toEqual([30, 31, 32]);
    expect(plan.report[0]).toMatchObject({
      proposedKeeperId: 30,
      proposedDeleteIds: [],
      action: "review",
      conflictFields: ["operations"],
    });
  });

  it("does not mark blank versus populated planning fields as conflicts", () => {
    const plan = buildMaintenanceDuplicateCleanupPlan([
      baseRow({ id: 40, responsiblePersonnel: null }),
      baseRow({ id: 41, responsiblePersonnel: "Maintenance" }),
    ]);

    expect(plan.conflictGroups).toBe(0);
    expect(plan.rowsProposedForDeletion).toEqual([40]);
    expect(plan.report[0]).toMatchObject({
      proposedKeeperId: 41,
      action: "delete",
    });
  });

  it("exports dry-run payload and csv without applying deletion", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "duplicate-cleanup-"));
    const csvPath = join(tempDir, "task-duplicate-dry-run.csv");
    const result = {
      ...buildMaintenanceDuplicateCleanupPlan([
        baseRow({ id: 50, equipmentName: 'Pump "A"', operations: "Ops" }),
        baseRow({ id: 51, equipmentName: 'Pump "A"', operations: "Ops" }),
        baseRow({ id: 52, taskList: "Lubricate bearing" }),
        baseRow({ id: 53, taskList: "lubricate bearing" }),
      ]),
      dryRun: true,
      applied: false,
      backupRunId: null,
      deletedIds: [],
    };

    const payload = await exportDuplicateCleanupDryRun(result, { csvPath });
    const csv = await readFile(csvPath, "utf8");

    expect(payload).toMatchObject({
      dryRun: true,
      applied: false,
      duplicateGroupCount: 2,
      duplicateRowCount: 4,
      rowsProposedForDeletion: [51, 53],
      rowsProposedForRetention: [50, 52],
      conflictGroups: 0,
      exported: { csvPath },
    });
    expect(payload.top20DuplicateGroups.map(row => row.duplicateIds)).toEqual([
      [52, 53],
      [50, 51],
    ]);
    expect(csv).toContain(
      "Dataset,Equipment,Equipment ID,Equipment Code,Task Description,Frequency,Duplicate IDs,Proposed Keeper ID,Proposed Delete IDs,Preserved IDs,Reason,Action,Conflict Fields"
    );
    expect(csv).toContain('"50,51",50,51,50');
  });
});
