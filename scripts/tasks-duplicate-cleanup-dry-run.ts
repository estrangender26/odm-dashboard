import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../api/queries/connection";
import {
  runMaintenanceDuplicateCleanup,
  type DuplicateCleanupResult,
  type DuplicateReviewReportRow,
} from "../api/tasks-duplicate-cleanup";

type ExportReportRow = {
  Dataset: string;
  Equipment: string;
  "Task Description": string;
  Frequency: string;
  "Duplicate IDs": string;
  "Keeper ID": number;
  Reason: string;
  Action: string;
};

function toExportRow(row: DuplicateReviewReportRow): ExportReportRow {
  return {
    Dataset: row.dataset,
    Equipment: row.equipment,
    "Task Description": row.taskDescription,
    Frequency: row.frequency,
    "Duplicate IDs": row.duplicateIds.join(","),
    "Keeper ID": row.proposedKeeperId,
    Reason: row.reason,
    Action: row.action,
  };
}

function csvEscape(value: string | number): string {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: ExportReportRow[]): string {
  const columns = [
    "Dataset",
    "Equipment",
    "Task Description",
    "Frequency",
    "Duplicate IDs",
    "Keeper ID",
    "Reason",
    "Action",
  ] as const;
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map(column => csvEscape(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function getTopDuplicateGroups(
  result: DuplicateCleanupResult
): DuplicateReviewReportRow[] {
  return [...result.report]
    .sort(
      (a, b) =>
        b.duplicateIds.length - a.duplicateIds.length ||
        a.dataset.localeCompare(b.dataset) ||
        a.equipment.localeCompare(b.equipment) ||
        a.proposedKeeperId - b.proposedKeeperId
    )
    .slice(0, 20);
}

async function main(): Promise<void> {
  const dataset = process.argv
    .find(arg => arg.startsWith("--dataset="))
    ?.split("=")[1] as "htt" | "aglipay" | undefined;
  if (dataset && !["htt", "aglipay"].includes(dataset)) {
    throw new Error(
      "Invalid --dataset value. Use --dataset=htt or --dataset=aglipay."
    );
  }

  const result = await runMaintenanceDuplicateCleanup(db, {
    dataset,
    dryRun: true,
    apply: false,
  });
  const exportRows = result.report.map(toExportRow);
  const top20DuplicateGroups = getTopDuplicateGroups(result).map(toExportRow);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportsDir = join(process.cwd(), "reports");
  await mkdir(reportsDir, { recursive: true });

  const datasetSuffix = dataset ? `-${dataset}` : "-all";
  const jsonPath = join(
    reportsDir,
    `tasks-duplicate-cleanup-dry-run${datasetSuffix}-${timestamp}.json`
  );
  const csvPath = join(
    reportsDir,
    `tasks-duplicate-cleanup-dry-run${datasetSuffix}-${timestamp}.csv`
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    dataset: dataset ?? "all",
    dryRun: result.dryRun,
    applied: result.applied,
    duplicateGroupCount: result.duplicateGroupCount,
    duplicateRowCount: result.duplicateRowCount,
    rowsProposedForDeletion: result.rowsProposedForDeletion,
    rowsProposedForRetention: result.rowsPreserved,
    conflictGroups: result.conflictGroups,
    top20DuplicateGroups,
    report: exportRows,
  };

  await writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await writeFile(csvPath, toCsv(exportRows));

  console.log(
    JSON.stringify({ ...payload, exported: { jsonPath, csvPath } }, null, 2)
  );
}

await main();
