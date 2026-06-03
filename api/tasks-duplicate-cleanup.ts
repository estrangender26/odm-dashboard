import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sql } from "drizzle-orm";
import { tasks, equipment } from "../db/schema";
import { eq } from "drizzle-orm";

export const PLANNING_FIELDS = [
  "operations",
  "amd",
  "ard",
  "procedureFamiliarity",
  "responsiblePersonnel",
] as const;
export type PlanningField = (typeof PLANNING_FIELDS)[number];

export type MaintenanceDuplicateRow = {
  id: number;
  dataset: string;
  equipmentId: number;
  equipmentCode: string | null;
  equipmentName: string | null;
  taskList: string;
  frequency: string;
  operations: string | null;
  amd: string | null;
  ard: string | null;
  procedureFamiliarity: string | null;
  responsiblePersonnel: string | null;
};

export type DuplicateReviewAction = "delete" | "review";

export type DuplicateReviewReportRow = {
  dataset: string;
  equipment: string;
  equipmentId: number;
  equipmentCode: string | null;
  taskDescription: string;
  frequency: string;
  duplicateIds: number[];
  proposedKeeperId: number;
  proposedDeleteIds: number[];
  preservedIds: number[];
  reason: string;
  action: DuplicateReviewAction;
  conflictFields: PlanningField[];
};

export type DuplicateCleanupPlan = {
  duplicateGroupCount: number;
  duplicateRowCount: number;
  rowsProposedForDeletion: number[];
  rowsPreserved: number[];
  conflictGroups: number;
  report: DuplicateReviewReportRow[];
};

export type DuplicateCleanupResult = DuplicateCleanupPlan & {
  dryRun: boolean;
  applied: boolean;
  backupRunId: string | null;
  deletedIds: number[];
};

export type DuplicateCleanupDryRunExportRow = {
  Dataset: string;
  Equipment: string;
  "Equipment ID": number;
  "Equipment Code": string;
  "Task Description": string;
  Frequency: string;
  "Duplicate IDs": string;
  "Proposed Keeper ID": number;
  "Proposed Delete IDs": string;
  "Preserved IDs": string;
  Reason: string;
  Action: DuplicateReviewAction;
  "Conflict Fields": string;
};

export type DuplicateCleanupDryRunPayload = {
  generatedAt: string;
  dataset: "htt" | "aglipay" | "all";
  dryRun: true;
  applied: false;
  duplicateGroupCount: number;
  duplicateRowCount: number;
  rowsProposedForDeletion: number[];
  rowsProposedForRetention: number[];
  conflictGroups: number;
  top20DuplicateGroups: DuplicateReviewReportRow[];
  exportRows: DuplicateCleanupDryRunExportRow[];
  exported: {
    csvPath: string;
  };
};

export type DuplicateCleanupDbLike = {
  select: (...args: any[]) => any;
  execute: (query: any) => Promise<unknown>;
  transaction: <T>(
    callback: (tx: DuplicateCleanupDbLike) => Promise<T>
  ) => Promise<T>;
  delete: (...args: any[]) => any;
};

function normalizeStableText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizePlanningValue(value: string | null | undefined): string {
  return normalizeStableText(value);
}

function hasValue(value: string | null | undefined): boolean {
  return normalizePlanningValue(value).length > 0;
}

function planningCompleteness(row: MaintenanceDuplicateRow): number {
  return PLANNING_FIELDS.reduce(
    (score, field) => score + (hasValue(row[field]) ? 1 : 0),
    0
  );
}

function findConflictFields(rows: MaintenanceDuplicateRow[]): PlanningField[] {
  return PLANNING_FIELDS.filter(field => {
    const nonBlankValues = new Set(
      rows.map(row => normalizePlanningValue(row[field])).filter(Boolean)
    );
    return nonBlankValues.size > 1;
  });
}

function duplicateGroupKey(row: MaintenanceDuplicateRow): string {
  return [
    normalizeStableText(row.dataset),
    String(
      row.equipmentId ||
        normalizeStableText(row.equipmentCode) ||
        normalizeStableText(row.equipmentName)
    ),
    normalizeStableText(row.taskList),
    normalizeStableText(row.frequency),
  ].join("||");
}

function chooseKeeper(
  rows: MaintenanceDuplicateRow[]
): MaintenanceDuplicateRow {
  return [...rows].sort((a, b) => {
    const completenessDelta = planningCompleteness(b) - planningCompleteness(a);
    if (completenessDelta !== 0) return completenessDelta;
    return a.id - b.id;
  })[0];
}

export function buildMaintenanceDuplicateCleanupPlan(
  rows: MaintenanceDuplicateRow[]
): DuplicateCleanupPlan {
  const grouped = new Map<string, MaintenanceDuplicateRow[]>();
  for (const row of rows) {
    const key = duplicateGroupKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const report: DuplicateReviewReportRow[] = [];
  const rowsProposedForDeletion: number[] = [];
  const rowsPreserved = new Set<number>();

  for (const groupRows of grouped.values()) {
    if (groupRows.length < 2) continue;

    const sortedRows = [...groupRows].sort((a, b) => a.id - b.id);
    const conflictFields = findConflictFields(sortedRows);
    const keeper = chooseKeeper(sortedRows);
    const duplicateIds = sortedRows.map(row => row.id);
    const hasConflict = conflictFields.length > 0;
    const proposedDeleteIds = hasConflict
      ? []
      : duplicateIds.filter(id => id !== keeper.id);
    const preservedIds = hasConflict ? duplicateIds : [keeper.id];

    for (const id of preservedIds) rowsPreserved.add(id);
    for (const id of proposedDeleteIds) rowsProposedForDeletion.push(id);

    const equipmentLabel = keeper.equipmentCode
      ? `${keeper.equipmentCode} — ${keeper.equipmentName ?? `Equipment ${keeper.equipmentId}`}`
      : (keeper.equipmentName ?? `Equipment ${keeper.equipmentId}`);

    const completeness = planningCompleteness(keeper);
    const maxCompleteness = Math.max(...sortedRows.map(planningCompleteness));

    report.push({
      dataset: keeper.dataset,
      equipment: equipmentLabel,
      equipmentId: keeper.equipmentId,
      equipmentCode: keeper.equipmentCode,
      taskDescription: keeper.taskList,
      frequency: keeper.frequency,
      duplicateIds,
      proposedKeeperId: keeper.id,
      proposedDeleteIds,
      preservedIds,
      reason: hasConflict
        ? `Manual review required: different populated stakeholder preference values in ${conflictFields.join(", ")}.`
        : completeness > 0 && completeness === maxCompleteness
          ? "Keeps the row with the most complete planning fields; ties keep the oldest row."
          : "Keeps the oldest row because planning-field completeness is tied.",
      action: hasConflict ? "review" : "delete",
      conflictFields,
    });
  }

  report.sort(
    (a, b) =>
      a.dataset.localeCompare(b.dataset) ||
      a.equipment.localeCompare(b.equipment) ||
      a.proposedKeeperId - b.proposedKeeperId
  );
  rowsProposedForDeletion.sort((a, b) => a - b);

  return {
    duplicateGroupCount: report.length,
    duplicateRowCount: report.reduce(
      (sum, row) => sum + row.duplicateIds.length,
      0
    ),
    rowsProposedForDeletion,
    rowsPreserved: Array.from(rowsPreserved).sort((a, b) => a - b),
    conflictGroups: report.filter(row => row.action === "review").length,
    report,
  };
}

export async function fetchMaintenancePlanningRows(
  db: DuplicateCleanupDbLike,
  dataset?: "htt" | "aglipay"
): Promise<MaintenanceDuplicateRow[]> {
  let query = db
    .select({
      id: tasks.id,
      dataset: tasks.dataset,
      equipmentId: tasks.equipmentId,
      equipmentCode: equipment.initials,
      equipmentName: equipment.name,
      taskList: tasks.taskList,
      frequency: tasks.frequency,
      operations: tasks.operations,
      amd: tasks.amd,
      ard: tasks.ard,
      procedureFamiliarity: tasks.procedureFamiliarity,
      responsiblePersonnel: tasks.responsiblePersonnel,
    })
    .from(tasks)
    .innerJoin(equipment, eq(tasks.equipmentId, equipment.id));

  if (dataset) query = query.where(eq(tasks.dataset, dataset));
  const rows = await query;
  return rows.map((row: any) => ({
    ...row,
    equipmentId: Number(row.equipmentId),
  }));
}

export async function runMaintenanceDuplicateCleanup(
  db: DuplicateCleanupDbLike,
  options: {
    dataset?: "htt" | "aglipay";
    dryRun?: boolean;
    apply?: boolean;
    confirm?: string;
  } = {}
): Promise<DuplicateCleanupResult> {
  const dryRun = options.dryRun ?? true;
  const shouldApply = options.apply === true && dryRun === false;
  const rows = await fetchMaintenancePlanningRows(db, options.dataset);
  const plan = buildMaintenanceDuplicateCleanupPlan(rows);

  if (!shouldApply) {
    return {
      ...plan,
      dryRun,
      applied: false,
      backupRunId: null,
      deletedIds: [],
    };
  }

  if (options.confirm !== "DELETE_DUPLICATE_TASKS") {
    throw new Error(
      "Duplicate cleanup apply requires confirm='DELETE_DUPLICATE_TASKS'. Run dry-run first and review the report before applying."
    );
  }

  if (plan.rowsProposedForDeletion.length === 0) {
    return {
      ...plan,
      dryRun,
      applied: true,
      backupRunId: null,
      deletedIds: [],
    };
  }

  const deleteIdSet = new Set(plan.rowsProposedForDeletion);
  const rowsToBackup = rows.filter(row => deleteIdSet.has(row.id));
  const backupRunId = `task-duplicate-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  await db.transaction(async tx => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS task_duplicate_cleanup_backups (
        id serial PRIMARY KEY,
        run_id varchar(120) NOT NULL,
        dataset varchar(20),
        created_at timestamp DEFAULT now(),
        dry_run boolean NOT NULL DEFAULT false,
        deleted_ids text NOT NULL,
        rows_json jsonb NOT NULL
      )
    `);

    await tx.execute(sql`
      INSERT INTO task_duplicate_cleanup_backups (run_id, dataset, dry_run, deleted_ids, rows_json)
      VALUES (${backupRunId}, ${options.dataset ?? null}, false, ${plan.rowsProposedForDeletion.join(",")}, ${JSON.stringify(rowsToBackup)}::jsonb)
    `);

    await tx.execute(
      sql`DELETE FROM tasks WHERE id IN (${sql.join(
        plan.rowsProposedForDeletion.map(id => sql`${id}`),
        sql`, `
      )})`
    );
  });

  console.info("[tasks/duplicateCleanup] deleted duplicate task rows", {
    backupRunId,
    deletedIds: plan.rowsProposedForDeletion,
    duplicateGroupCount: plan.duplicateGroupCount,
    conflictGroups: plan.conflictGroups,
  });

  return {
    ...plan,
    dryRun,
    applied: true,
    backupRunId,
    deletedIds: plan.rowsProposedForDeletion,
  };
}

function csvEscape(value: string | number): string {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toDuplicateCleanupDryRunExportRow(
  row: DuplicateReviewReportRow
): DuplicateCleanupDryRunExportRow {
  return {
    Dataset: row.dataset,
    Equipment: row.equipment,
    "Equipment ID": row.equipmentId,
    "Equipment Code": row.equipmentCode ?? "",
    "Task Description": row.taskDescription,
    Frequency: row.frequency,
    "Duplicate IDs": row.duplicateIds.join(","),
    "Proposed Keeper ID": row.proposedKeeperId,
    "Proposed Delete IDs": row.proposedDeleteIds.join(","),
    "Preserved IDs": row.preservedIds.join(","),
    Reason: row.reason,
    Action: row.action,
    "Conflict Fields": row.conflictFields.join(","),
  };
}

export function duplicateCleanupDryRunRowsToCsv(
  rows: DuplicateCleanupDryRunExportRow[]
): string {
  const columns = [
    "Dataset",
    "Equipment",
    "Equipment ID",
    "Equipment Code",
    "Task Description",
    "Frequency",
    "Duplicate IDs",
    "Proposed Keeper ID",
    "Proposed Delete IDs",
    "Preserved IDs",
    "Reason",
    "Action",
    "Conflict Fields",
  ] as const;
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map(column => csvEscape(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function getTopDuplicateGroups(
  result: DuplicateCleanupResult,
  limit = 20
): DuplicateReviewReportRow[] {
  return [...result.report]
    .sort(
      (a, b) =>
        b.duplicateIds.length - a.duplicateIds.length ||
        a.dataset.localeCompare(b.dataset) ||
        a.equipment.localeCompare(b.equipment) ||
        a.proposedKeeperId - b.proposedKeeperId
    )
    .slice(0, limit);
}

export async function exportDuplicateCleanupDryRun(
  result: DuplicateCleanupResult,
  options: { dataset?: "htt" | "aglipay"; csvPath?: string } = {}
): Promise<DuplicateCleanupDryRunPayload> {
  if (!result.dryRun || result.applied) {
    throw new Error(
      "Duplicate cleanup dry-run export requires a dry-run result that has not been applied."
    );
  }

  const csvPath = options.csvPath ?? "reports/task-duplicate-dry-run.csv";
  const exportRows = result.report.map(toDuplicateCleanupDryRunExportRow);
  await mkdir(dirname(csvPath), { recursive: true });
  await writeFile(
    csvPath,
    duplicateCleanupDryRunRowsToCsv(exportRows),
    "utf8"
  );

  return {
    generatedAt: new Date().toISOString(),
    dataset: options.dataset ?? "all",
    dryRun: true,
    applied: false,
    duplicateGroupCount: result.duplicateGroupCount,
    duplicateRowCount: result.duplicateRowCount,
    rowsProposedForDeletion: result.rowsProposedForDeletion,
    rowsProposedForRetention: result.rowsPreserved,
    conflictGroups: result.conflictGroups,
    top20DuplicateGroups: getTopDuplicateGroups(result),
    exportRows,
    exported: { csvPath },
  };
}
