/* ─── Gantt Persistence Engine — Export / Import / Date Normalization ─── */
import { GanttTask, parseDate, daysBetween, normProgress, deriveStatus, rowStatus } from "./schedulingEngine";
import * as XLSX from "xlsx";

/* ─── Normalize Excel date (serial number or string) → YYYY-MM-DD ─── */
export function normalizeExcelDate(val: any): string {
  if (!val) return "";
  if (typeof val === "number") {
    const epoch = new Date(1899, 11, 30);
    const dt = new Date(epoch.getTime() + val * 86400000);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  const s = String(val).trim();
  if (!s || s === "undefined" || s === "null") return "";
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

/* ─── Calculate duration in days between two date strings ─── */
export function calcDuration(startStr: string, endStr: string): number {
  const s = parseDate(startStr);
  const e = parseDate(endStr);
  if (!s || !e) return 1;
  return Math.max(1, daysBetween(s, e));
}

/* ─── Resolve field with multiple possible key names ─── */
export function resolveField(obj: any, ...keys: string[]): any {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return "";
}

/* ─── Export Template — Empty Excel with headers + sample row ─── */
export function exportTemplate() {
  try {
    const COLUMN_ORDER = [
      "Task ID", "Parent Task", "WBS Level", "Task Name", "Owner",
      "Start", "Finish", "Duration", "Progress",
      "Dependency", "Dependency Type", "Lag (days)", "Milestone", "Category", "Status", "Notes",
    ];
    const sampleRows = [
      { "Task ID": 1, "Parent Task": 0, "WBS Level": 1, "Task Name": "Sample Project", "Owner": "Engineer A", "Start": "2025-01-01", "Finish": "2025-06-30", "Duration": 180, "Progress": 0, "Dependency": "", "Dependency Type": "", "Lag (days)": 0, "Milestone": "No", "Category": "General", "Status": "Not Started", "Notes": "Project kickoff" },
      { "Task ID": 2, "Parent Task": 1, "WBS Level": 2, "Task Name": "Site Inspection", "Owner": "Engineer B", "Start": "2025-01-01", "Finish": "2025-01-15", "Duration": 14, "Progress": 50, "Dependency": 1, "Dependency Type": "FS", "Lag (days)": 0, "Milestone": "No", "Category": "Inspection", "Status": "In Progress", "Notes": "Initial site walk" },
      { "Task ID": 3, "Parent Task": 1, "WBS Level": 2, "Task Name": "Equipment Install", "Owner": "Technician C", "Start": "2025-01-16", "Finish": "2025-03-15", "Duration": 58, "Progress": 0, "Dependency": 2, "Dependency Type": "FS", "Lag (days)": 0, "Milestone": "No", "Category": "Installation", "Status": "Not Started", "Notes": "Wait for inspection" },
      { "Task ID": 4, "Parent Task": 0, "WBS Level": 1, "Task Name": "Milestone: Handover", "Owner": "Manager D", "Start": "2025-06-30", "Finish": "2025-06-30", "Duration": 1, "Progress": 0, "Dependency": "", "Dependency Type": "", "Lag (days)": 0, "Milestone": "Yes", "Category": "Milestone", "Status": "Not Started", "Notes": "Project completion" },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: COLUMN_ORDER });
    const colWidths = [
      { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 18 },
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
      { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 25 },
    ];
    ws["!cols"] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gantt Tasks");
    const instructions = [
      { "Column": "Task ID", "Description": "Unique numeric ID for each task", "Required": "Yes", "Example": "1, 2, 3" },
      { "Column": "Parent Task", "Description": "Task ID of parent (0 = root level)", "Required": "No", "Example": "0, 1, 1" },
      { "Column": "WBS Level", "Description": "Hierarchy level (1 = project, 2 = phase, etc.)", "Required": "No", "Example": "1, 2, 2" },
      { "Column": "Task Name", "Description": "Name of the task", "Required": "Yes", "Example": "Site Inspection" },
      { "Column": "Owner", "Description": "Person responsible", "Required": "No", "Example": "Engineer A" },
      { "Column": "Start", "Description": "Actual start date (YYYY-MM-DD)", "Required": "No", "Example": "2025-01-01" },
      { "Column": "Finish", "Description": "Actual finish date (YYYY-MM-DD)", "Required": "No", "Example": "2025-01-15" },
      { "Column": "Duration", "Description": "Duration in days (auto-calculated if dates provided)", "Required": "No", "Example": "14" },
      { "Column": "Progress", "Description": "Completion percentage (0-100)", "Required": "No", "Example": "50" },
      { "Column": "Dependency", "Description": "Task ID of predecessor", "Required": "No", "Example": "1" },
      { "Column": "Dependency Type", "Description": "FS, SS, FF, or SF", "Required": "No", "Example": "FS" },
      { "Column": "Lag (days)", "Description": "Lag/lead days for dependency", "Required": "No", "Example": "0" },
      { "Column": "Milestone", "Description": "Yes = milestone, No = regular task", "Required": "No", "Example": "No" },
      { "Column": "Category", "Description": "Task category or phase", "Required": "No", "Example": "Inspection" },
      { "Column": "Status", "Description": "Auto-derived from dates if left blank", "Required": "No", "Example": "In Progress" },
      { "Column": "Notes", "Description": "Additional notes or remarks", "Required": "No", "Example": "Notes here" },
    ];
    const wsInst = XLSX.utils.json_to_sheet(instructions);
    wsInst["!cols"] = [{ wch: 20 }, { wch: 50 }, { wch: 10 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsInst, "Instructions");
    XLSX.writeFile(wb, "Gantt_Task_Template.xlsx");
    return true;
  } catch (e: any) {
    /* Fallback: download CSV template */
    const headers = ["Task ID","Parent Task","WBS Level","Task Name","Owner","Start","Finish","Duration","Progress","Dependency","Dependency Type","Lag (days)","Milestone","Category","Status","Notes"];
    const csv = headers.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gantt-template.csv";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 200);
    return false;
  }
}

/* ─── Export CSV — 15-column format ─── */
export function exportCSV(tasks: GanttTask[]) {
  const rows = tasks.map((t: any) => ({
    "Task ID": resolveField(t, "id", "task_id", "taskId"),
    "Parent Task": resolveField(t, "parent", "parentId", "parent_task"),
    "WBS Level": resolveField(t, "wbsLevel", "wbs_level", "wbs"),
    "Task Name": resolveField(t, "text", "name", "task_name"),
    "Owner": resolveField(t, "owner", "assignee"),
    "Start": normalizeExcelDate(resolveField(t, "startDate", "start", "actualStart")),
    "Finish": normalizeExcelDate(resolveField(t, "endDate", "finish", "actualEnd")),
    "Duration": resolveField(t, "duration", "dur"),
    "Progress": normProgress(resolveField(t, "progress", "percent")),
    "Dependency": resolveField(t, "dependency", "predecessorId", "predecessor"),
    "Dependency Type": resolveField(t, "dependencyType", "linkType") || "FS",
    "Lag (days)": resolveField(t, "lag", "lag_days") || "0",
    "Milestone": t.type === "milestone" ? "Yes" : "No",
    "Category": resolveField(t, "category", "cat"),
    "Status": resolveField(t, "status") || rowStatus(t),
    "Notes": resolveField(t, "remarks", "notes"),
  }));

  const COLUMN_ORDER = [
    "Task ID", "Parent Task", "WBS Level", "Task Name", "Owner",
    "Start", "Finish", "Duration", "Progress",
    "Dependency", "Dependency Type", "Lag (days)", "Milestone", "Category", "Status", "Notes",
  ];

  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}], { header: COLUMN_ORDER });
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = tasks.length > 0 ? "Gantt_Tasks.csv" : "Gantt_Task_Template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/* ─── Excel Export — 15-column format with field variant support ─── */
export function exportExcel(tasks: GanttTask[]) {
  const rows = tasks.map((t: any) => {
    const taskId = resolveField(t, "id", "task_id", "taskId");
    const parentTask = resolveField(t, "parent", "parentId", "parent_task", "parentTask");
    const wbsLevel = resolveField(t, "wbsLevel", "wbs_level", "wbs", "level");
    const taskName = resolveField(t, "text", "name", "task_name", "taskName", "title");
    const owner = resolveField(t, "owner", "assignee", "responsible");
    const start = normalizeExcelDate(resolveField(t, "startDate", "start_date", "start", "actualStart"));
    const finish = normalizeExcelDate(resolveField(t, "endDate", "end_date", "finish", "finish_date", "end", "actualEnd"));
    const plannedStart = normalizeExcelDate(resolveField(t, "plannedStart", "planned_start", "plannedStartDate"));
    const plannedFinish = normalizeExcelDate(resolveField(t, "plannedEnd", "planned_end", "plannedFinish", "planned_finish_date"));
    let duration: any = resolveField(t, "duration", "dur", "days");
    if (!duration && start && finish) duration = calcDuration(start, finish);
    if (!duration && plannedStart && plannedFinish) duration = calcDuration(plannedStart, plannedFinish);
    const progressVal = normProgress(resolveField(t, "progress", "percent_complete", "percentComplete", "percent"));
    const dependency = resolveField(t, "dependency", "predecessorId", "predecessor", "predecessor_id", "link");
    const dependencyType = resolveField(t, "dependencyType", "dependency_type", "linkType", "link_type", "type");
    const milestone = resolveField(t, "milestone", "isMilestone", "is_milestone") || (t.type === "milestone" ? "Yes" : "No");
    const category = resolveField(t, "category", "cat", "group", "phase");
    let status = resolveField(t, "status", "state", "taskStatus", "task_status");
    if (!status) {
      if (progressVal >= 100) status = "Completed";
      else if (progressVal > 0) {
        const aEnd = parseDate(t.endDate);
        const pEnd = parseDate(t.plannedEnd);
        status = (aEnd && pEnd && aEnd > pEnd) ? "In Progress (Delayed)" : "In Progress";
      } else status = "Not Started";
    }
    const notes = resolveField(t, "remarks", "notes", "note", "comments", "comment", "description");

    return {
      "Task ID": taskId,
      "Parent Task": parentTask,
      "WBS Level": wbsLevel,
      "Task Name": taskName,
      "Owner": owner,
      "Start": start,
      "Finish": finish,
      "Duration": duration,
      "Progress": progressVal,
      "Dependency": dependency,
      "Dependency Type": dependencyType,
      "Lag (days)": resolveField(t, "lag", "lag_days", "lagDays") || "",
      "Milestone": milestone,
      "Category": category,
      "Status": status,
      "Notes": notes,
    };
  });

  const COLUMN_ORDER = [
    "Task ID", "Parent Task", "WBS Level", "Task Name", "Owner",
    "Start", "Finish", "Duration", "Progress",
    "Dependency", "Dependency Type", "Lag (days)", "Milestone", "Category", "Status", "Notes",
  ];

  const wsData = rows.length > 0 ? rows : [{}];
  const ws = XLSX.utils.json_to_sheet(wsData, { header: COLUMN_ORDER });

  const colWidths = [
    { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 18 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
    { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 25 },
  ];
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Gantt Tasks");
  XLSX.writeFile(wb, "Gantt_Tasks.xlsx");
}

/* ─── Import row → task payload (used inside FileReader callback) ─── */
export interface ImportResult {
  payload: any;
  errors: string[];
  imported: number;
  skipped: number;
}

export function parseImportRow(row: any, idx: number): { payload: any | null; error: string | null } {
  const text = (row["Task Name"] || row["Task"] || row["Name"] || row["name"] || row["text"] || row["Title"] || row["title"] || "").trim();
  if (!text) return { payload: null, error: null }; // skipped (no name)

  const owner = row["Owner"] || row["owner"] || row["Assignee"] || row["assignee"] || "";
  const parentTask = row["Parent Task"] || row["parent"] || row["parentId"] || row["parent_task"] || "0";
  const category = row["Category"] || row["category"] || row["cat"] || row["group"] || row["phase"] || "";

  let start = normalizeExcelDate(row["Start"] || row["start"] || row["Start Date"] || row["start_date"] || row["startDate"] || "");
  let finish = normalizeExcelDate(row["Finish"] || row["finish"] || row["End"] || row["end"] || row["end_date"] || row["endDate"] || row["finish_date"] || "");

  let plannedStart = normalizeExcelDate(row["Planned Start"] || row["planned_start"] || row["plannedStart"] || row["Planned"] || row["Baseline Start"] || row["baseline_start"] || "");
  let plannedEnd = normalizeExcelDate(row["Planned End"] || row["planned_end"] || row["plannedEnd"] || row["Planned Finish"] || row["Baseline End"] || row["baseline_end"] || "");

  if (!start && plannedStart) start = plannedStart;
  if (!finish && plannedEnd) finish = plannedEnd;

  let dur: any = row["Duration"] || row["duration"] || row["dur"] || row["days"] || "";
  if (!dur && start && finish) dur = calcDuration(start, finish);
  else if (!dur && plannedStart && plannedEnd) dur = calcDuration(plannedStart, plannedEnd);
  if (!dur) dur = 1;

  if (start && !finish && dur) {
    const s = parseDate(start);
    if (s) {
      const e = new Date(s.getTime() + (parseInt(String(dur)) || 1) * 86400000);
      finish = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
    }
  }
  if (plannedStart && !plannedEnd && dur) {
    const s = parseDate(plannedStart);
    if (s) {
      const e = new Date(s.getTime() + (parseInt(String(dur)) || 1) * 86400000);
      plannedEnd = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
    }
  }

  const progRaw = row["Progress"] || row["progress"] || row["percent_complete"] || row["percentComplete"] || row["percent"] || "0";
  let prog = parseInt(String(progRaw).toString().replace("%", "")) || 0;
  prog = Math.min(100, Math.max(0, prog));

  const dependency = row["Dependency"] || row["dependency"] || row["predecessorId"] || row["predecessor"] || row["Predecessor"] || "";
  const dependencyType = row["Dependency Type"] || row["dependency_type"] || row["dependencyType"] || row["linkType"] || row["link_type"] || "FS";

  const milestoneVal = row["Milestone"] || row["milestone"] || row["isMilestone"] || row["is_milestone"] || "";
  const isMilestone = String(milestoneVal).toLowerCase() === "yes" || String(milestoneVal).toLowerCase() === "true" || String(milestoneVal) === "1";

  let status = row["Status"] || row["status"] || row["state"] || row["State"] || "";
  if (!status) {
    status = deriveStatus({ startDate: start, endDate: finish, plannedEnd: plannedEnd });
  }

  const notes = row["Notes"] || row["notes"] || row["note"] || row["Remarks"] || row["remarks"] || row["Comments"] || row["comments"] || row["Description"] || row["description"] || "";
  const type = isMilestone ? "milestone" : (row["Type"] || row["type"] || "task");
  const parent = parseInt(parentTask) || 0;
  const wbsLevelRaw = row["WBS Level"] || row["wbsLevel"] || row["wbs_level"] || row["wbs"] || row["level"] || "";
  let wbsLevel = parseInt(wbsLevelRaw) || 0;
  if (wbsLevel <= 0) {
    // Auto-compute from parent: root=1, child=2, etc.
    wbsLevel = parent > 0 ? 2 : 1;
  }

  if (start && finish) {
    const s = parseDate(start);
    const f = parseDate(finish);
    if (s && f && f < s) {
      return { payload: null, error: `Row ${idx + 1}: "${text}" has Finish before Start` };
    }
  }

  const payload = {
    /* New schema field names (backend saveTask accepts both old + new) */
    task_name: text,
    owner: owner || null,
    actual_start: start || null,
    actual_finish: finish || null,
    planned_start: plannedStart || start || null,
    planned_finish: plannedEnd || finish || null,
    planned_duration: parseInt(String(dur)) || 1,
    progress_percent: prog,
    wbs_level: wbsLevel,
    status: status || null,
    notes: notes || null,
    category: category || null,
    parent_task_id: parent,
    task_type: type,
  };

  return { payload, error: null };
}

/* ─── Parse Excel file → array of import payloads ─── */
export function parseImportFile(data: Uint8Array): { rows: any[]; sheetName: string } | null {
  const workbook = XLSX.read(data, { type: "array" });
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(ws);
  if (!rows.length) return null;
  return { rows, sheetName: workbook.SheetNames[0] };
}
