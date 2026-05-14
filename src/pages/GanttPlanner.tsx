import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import * as XLSX from "xlsx";

/* ─── KPI type ─── */
interface KpiData {
  totalTasks: number;
  completed: number;
  inProgress: number;
  overdue: number;
  completionRate: number;
  avgDuration: number;
}

interface GanttTask {
  id: number;
  text: string;
  startDate: string;
  endDate: string | null;
  duration: number;
  progress: number;
  parent: number;
  type: string;
  owner: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  open: number;
  sortorder: number | null;
}

/* ─── Date helpers ─── */
const parseDate = (d: string | null | undefined): Date | null => {
  if (!d) return null;
  const dt = new Date(d.replace(" ", "T").slice(0, 10) + "T12:00:00");
  return isNaN(dt.getTime()) ? null : dt;
};

const daysBetween = (a: Date, b: Date): number => {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
};

const fmtMonth = (d: Date): string => {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return M[d.getMonth()] + " " + d.getFullYear();
};

const fmtShortDate = (d: Date): string => {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return M[d.getMonth()] + " " + d.getDate();
};

// Normalize progress — handles both 0-1 float and 0-100 integer formats
// Returns 0-100 integer
const normProgress = (p: any): number => {
  const n = Number(p);
  if (isNaN(n) || n === null || n === undefined) return 0;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  // If between 0 and 1, it's a float → multiply by 100
  if (n < 1) return Math.round(n * 100);
  // Otherwise it's already 0-100
  return Math.round(n);
};

// Get progress as 0-1 float (for internal calculations)
const progressFloat = (p: any): number => normProgress(p) / 100;

/* ─── Native Gantt Chart Component — Planned vs Actual dual bars ─── */
function NativeGanttChart({ tasks }: { tasks: GanttTask[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Compute project range + per-task bar positions */
  const { projectStart, projectEnd, totalDays, dayWidth, rows } = useMemo(() => {
    if (!tasks.length) {
      return { projectStart: new Date(), projectEnd: new Date(), totalDays: 30, dayWidth: 18, rows: [] };
    }

    // Collect ALL dates — planned AND actual
    let ps: Date | null = null;
    let pe: Date | null = null;
    const consider = (d: Date | null) => {
      if (!d) return;
      if (!ps || d < ps) ps = d;
      if (!pe || d > pe) pe = d;
    };

    for (const t of tasks) {
      consider(parseDate(t.plannedStart));
      consider(parseDate(t.plannedEnd));
      consider(parseDate(t.startDate));
      consider(parseDate(t.endDate));
    }

    if (!ps) ps = new Date();
    if (!pe) pe = new Date(ps.getTime() + 30 * 86400000);

    // Add padding
    ps = new Date(ps.getTime() - 5 * 86400000);
    pe = new Date(pe.getTime() + 10 * 86400000);
    const td = Math.max(daysBetween(ps, pe), 30);

    // Responsive day width
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const dw = isMobile ? 12 : 18;

    // Build rows
    const chartRows = tasks
      .filter((t) => t.type !== "project")
      .map((t) => {
        const plannedStart = parseDate(t.plannedStart);
        const plannedEnd = parseDate(t.plannedEnd);
        const actualStart = parseDate(t.startDate);
        const actualEnd = parseDate(t.endDate);

        // Planned bar geometry
        const plannedLeft = plannedStart ? Math.max(0, daysBetween(ps, plannedStart)) * dw : null;
        const plannedWidth = (plannedStart && plannedEnd && daysBetween(plannedStart, plannedEnd) > 0)
          ? daysBetween(plannedStart, plannedEnd) * dw
          : null;

        // Actual bar geometry
        const actualLeft = actualStart ? Math.max(0, daysBetween(ps, actualStart)) * dw : null;
        const actualWidth = (actualStart && actualEnd && daysBetween(actualStart, actualEnd) > 0)
          ? daysBetween(actualStart, actualEnd) * dw
          : actualStart ? (t.duration || 1) * dw : null;

        // Delay check
        const isDelayed = actualEnd && plannedEnd && actualEnd > plannedEnd;
        const isMilestone = t.type === "milestone";

        return {
          task: t,
          plannedLeft, plannedWidth,
          actualLeft, actualWidth,
          isDelayed, isMilestone,
        };
      });

    return { projectStart: ps, projectEnd: pe, totalDays: td, dayWidth: dw, rows: chartRows };
  }, [tasks]);

  // Month header columns
  const monthColumns = useMemo(() => {
    const cols: { label: string; left: number; width: number }[] = [];
    if (!projectStart) return cols;
    let cur = new Date(projectStart);
    while (cur <= projectEnd) {
      const monthStart = new Date(cur);
      const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const monthEnd = nextMonth < projectEnd ? nextMonth : projectEnd;
      const left = daysBetween(projectStart, monthStart) * dayWidth;
      const width = Math.max(1, daysBetween(monthStart, monthEnd) * dayWidth);
      cols.push({ label: fmtMonth(monthStart), left, width });
      cur = nextMonth;
    }
    return cols;
  }, [projectStart, projectEnd, dayWidth]);

  const chartWidth = totalDays * dayWidth;
  const rowHeight = 56;
  const headerHeight = 40;
  const chartHeight = Math.max(350, rows.length * rowHeight + headerHeight + 20);

  if (!tasks.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px", minHeight: 300, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#16324F", marginBottom: 6 }}>No tasks yet</div>
        <div style={{ fontSize: 12, color: "#8BA3B8" }}>Load demo data or import from Excel to see the Gantt chart.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, padding: "10px 14px", background: "#FAFBFC", borderBottom: "1px solid #E2E8F0", fontSize: 11, fontFamily: "Inter, sans-serif", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#93C5FD", borderRadius: 2, border: "1px solid #60A5FA" }} /> Planned</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#86EFAC", borderRadius: 2, border: "1px solid #4ADE80" }} /> Actual (on time)</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#FCA5A5", borderRadius: 2, border: "1px solid #F87171" }} /> Actual (delayed)</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, background: "#7C3AED", transform: "rotate(45deg)", borderRadius: 1 }} /> Milestone</span>
      </div>

      <div style={{ display: "flex", height: chartHeight, fontFamily: "Inter, sans-serif", fontSize: 12 }}>
        {/* Left: Task names column */}
        <div style={{ width: 160, minWidth: 160, borderRight: "1px solid #E2E8F0", background: "#FAFBFC", display: "flex", flexDirection: "column", zIndex: 2 }}>
          {/* Header */}
          <div style={{ height: headerHeight, borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", padding: "0 10px", fontWeight: 700, color: "#475569", fontSize: 11, background: "#F1F5F9" }}>
            Task Name
          </div>
          {/* Task rows */}
          {rows.map(({ task }) => (
            <div key={task.id} style={{ height: rowHeight, borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", padding: "0 10px", overflow: "hidden" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#2D3748", fontWeight: task.parent === 0 ? 600 : 400, fontSize: 11 }} title={task.text}>
                {task.text || "Untitled"}
              </span>
            </div>
          ))}
        </div>

        {/* Right: Scrollable timeline */}
        <div ref={scrollRef} style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <div style={{ width: chartWidth, position: "relative" }}>
            {/* Month header row */}
            <div style={{ height: headerHeight, borderBottom: "1px solid #E2E8F0", display: "flex", position: "relative", background: "#F1F5F9" }}>
              {monthColumns.map((col, i) => (
                <div key={i} style={{ position: "absolute", left: col.left, width: col.width, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #E2E8F0", fontWeight: 600, color: "#475569", fontSize: 10, whiteSpace: "nowrap" }}>
                  {col.label}
                </div>
              ))}
            </div>

            {/* Grid lines */}
            {monthColumns.map((col, i) => (
              <div key={`grid-${i}`} style={{ position: "absolute", left: col.left, top: headerHeight, width: 1, height: rows.length * rowHeight, background: "#F1F5F9", zIndex: 0 }} />
            ))}

            {/* Task rows — dual bars */}
            {rows.map((row, idx) => {
              const { task, plannedLeft, plannedWidth, actualLeft, actualWidth, isDelayed, isMilestone } = row;
              const top = headerHeight + idx * rowHeight;

              return (
                <div key={task.id}>
                  {isMilestone ? (
                    /* Milestone: diamond only */
                    <div style={{ position: "absolute", left: (actualLeft ?? plannedLeft ?? 0) - 7, top: top + rowHeight / 2 - 7, zIndex: 2 }}>
                      <div style={{ width: 14, height: 14, background: "#7C3AED", transform: "rotate(45deg)", borderRadius: 2, boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                    </div>
                  ) : (
                    <>
                      {/* Planned bar (top) */}
                      {plannedLeft !== null && plannedWidth !== null && (
                        <div style={{ position: "absolute", left: plannedLeft, top: top + 6, height: 18, zIndex: 1 }}>
                          <div style={{ width: Math.max(plannedWidth, 2), height: 16, background: "rgba(147,197,253,0.35)", border: "1px dashed #60A5FA", borderRadius: 3, position: "relative" }}>
                            {plannedWidth > 50 && (
                              <span style={{ position: "absolute", left: 3, top: "50%", transform: "translateY(-50%)", fontSize: 8, fontWeight: 600, color: "#3B82F6", whiteSpace: "nowrap" }}>Planned</span>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Actual bar (bottom) */}
                      {actualLeft !== null && actualWidth !== null ? (
                        <div style={{ position: "absolute", left: actualLeft, top: top + 30, height: 18, zIndex: 2 }}>
                          <div style={{ width: Math.max(actualWidth, 2), height: 16, background: isDelayed ? "rgba(252,165,165,0.5)" : "rgba(134,239,172,0.5)", border: `1px solid ${isDelayed ? "#F87171" : "#4ADE80"}`, borderRadius: 3, position: "relative" }}>
                            {actualWidth > 50 && (
                              <span style={{ position: "absolute", left: 3, top: "50%", transform: "translateY(-50%)", fontSize: 8, fontWeight: 600, color: isDelayed ? "#DC2626" : "#15803D", whiteSpace: "nowrap" }}>
                                {isDelayed ? "Delayed" : `${normProgress(task.progress)}%`}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* No actual data yet */
                        plannedLeft !== null && (
                          <div style={{ position: "absolute", left: plannedLeft, top: top + 30, zIndex: 1 }}>
                            <span style={{ fontSize: 8, color: "#CBD5E1", fontStyle: "italic" }}>No actual yet</span>
                          </div>
                        )
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GanttPlanner() {
  const [activeTab, setActiveTab] = useState<"gantt" |"tasks"|"resources">("gantt");
  const [kpi, setKpi] = useState<KpiData>({
    totalTasks: 0, completed: 0, inProgress: 0, overdue: 0, completionRate: 0, avgDuration: 0,
  });

  /* tRPC queries */
  const tasksQuery = trpc.gantt.tasks.useQuery();
  const linksQuery = trpc.gantt.links.useQuery();
  const utils = trpc.useUtils();

  const saveTaskMut = trpc.gantt.saveTask.useMutation({ onSuccess: () => utils.gantt.tasks.invalidate() });
  const deleteTaskMut = trpc.gantt.deleteTask.useMutation({ onSuccess: () => utils.gantt.tasks.invalidate() });
  const saveLinkMut = trpc.gantt.saveLink.useMutation({ onSuccess: () => utils.gantt.links.invalidate() });
  const deleteLinkMut = trpc.gantt.deleteLink.useMutation({ onSuccess: () => utils.gantt.links.invalidate() });
  const resetMut = trpc.gantt.resetAll.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });
  const seedMut = trpc.gantt.seed.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });

  /* ─── Helpers ─── */
  const calcKpi = useCallback((tasks: any[]): KpiData => {
    const now = new Date();
    const total = tasks.length;
    const completed = tasks.filter((t: any) => normProgress(t.progress) >= 100).length;
    const inProgress = tasks.filter((t: any) => { const p = normProgress(t.progress); return p > 0 && p < 100; }).length;
    const overdue = tasks.filter((t: any) => {
      const end = t.endDate ? parseDate(t.endDate) : t.startDate ? new Date(new Date(t.startDate).getTime() + (t.duration || 1) * 86400000) : null;
      return end && end < now && normProgress(t.progress) < 100;
    }).length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgDuration = total > 0 ? Math.round(tasks.reduce((s: number, t: any) => s + (t.duration || 0), 0) / total) : 0;
    return { totalTasks: total, completed, inProgress, overdue, completionRate, avgDuration };
  }, []);

  /* ─── KPI from query ─── */
  useEffect(() => {
    if (!tasksQuery.data) return;
    setKpi(calcKpi(tasksQuery.data));
  }, [tasksQuery.data, calcKpi]);

  /* ─── Normalize Excel date (serial number or string) → YYYY-MM-DD ─── */
  const normalizeExcelDate = (val: any): string => {
    if (!val) return "";
    if (typeof val === "number") {
      // Excel serial date → JS Date
      const epoch = new Date(1899, 11, 30);
      const dt = new Date(epoch.getTime() + val * 86400000);
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    }
    const s = String(val).trim();
    if (!s || s === "undefined" || s === "null") return "";
    // Already ISO-ish: extract YYYY-MM-DD
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
    return "";
  };

  /* ─── Calculate duration in days between two date strings ─── */
  const calcDuration = (startStr: string, endStr: string): number => {
    const s = parseDate(startStr);
    const e = parseDate(endStr);
    if (!s || !e) return 1;
    return Math.max(1, daysBetween(s, e));
  };

  /* ─── Resolve field with multiple possible key names ─── */
  const resolveField = (obj: any, ...keys: string[]): any => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return "";
  };

  /* ─── Excel Export — 15-column format with field variant support ─── */
  const exportExcel = () => {
    // Debug: log the raw data source
    const rawTasks = tasksQuery.data || [];
    console.log("[EXPORT TASK COUNT]", rawTasks.length, rawTasks);

    // Build rows from the LIVE data source (same as UI renders)
    const rows = rawTasks.map((t: any) => {
      // Resolve fields with variant key names
      const taskId = resolveField(t, "id", "task_id", "taskId");
      const parentTask = resolveField(t, "parent", "parentId", "parent_task", "parentTask");
      const wbsLevel = resolveField(t, "wbsLevel", "wbs_level", "wbs", "level");
      const taskName = resolveField(t, "text", "name", "task_name", "taskName", "title");
      const owner = resolveField(t, "owner", "assignee", "responsible");
      const start = normalizeExcelDate(resolveField(t, "startDate", "start_date", "start", "actualStart"));
      const finish = normalizeExcelDate(resolveField(t, "endDate", "end_date", "finish", "finish_date", "end", "actualEnd"));
      const plannedStart = normalizeExcelDate(resolveField(t, "plannedStart", "planned_start", "plannedStartDate"));
      const plannedFinish = normalizeExcelDate(resolveField(t, "plannedEnd", "planned_end", "plannedFinish", "planned_finish_date"));
      let duration = resolveField(t, "duration", "dur", "days");
      if (!duration && start && finish) {
        duration = calcDuration(start, finish);
      }
      if (!duration && plannedStart && plannedFinish) {
        duration = calcDuration(plannedStart, plannedFinish);
      }
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
        "Milestone": milestone,
        "Category": category,
        "Status": status,
        "Notes": notes,
      };
    });

    // If no task data, export headers-only template
    if (rows.length === 0) {
      console.log("[EXPORT] No task data — exporting blank template with headers only");
    }

    // Build worksheet with explicit column order
    const COLUMN_ORDER = [
      "Task ID", "Parent Task", "WBS Level", "Task Name", "Owner",
      "Start", "Finish", "Duration", "Progress",
      "Dependency", "Dependency Type", "Milestone", "Category", "Status", "Notes",
    ];

    // Create a row with headers in exact order (even for empty data)
    const wsData = rows.length > 0 ? rows : [{}];
    const ws = XLSX.utils.json_to_sheet(wsData, { header: COLUMN_ORDER });

    // Set column widths for readability
    const colWidths = [
      { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 18 },
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 25 },
    ];
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gantt Tasks");
    XLSX.writeFile(wb, "Gantt_Tasks.xlsx");
  };

  /* ─── Excel Import — 15-column format with full backward compat ─── */
  const importExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (!rows.length) { alert("No data found in the file"); return; }

      console.log("[IMPORT ROW COUNT]", rows.length, rows[0]);

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      rows.forEach((row: any, idx: number) => {
        // ── Task Name (required) ──
        const text = (row["Task Name"] || row["Task"] || row["Name"] || row["name"] || row["text"] || row["Title"] || row["title"] || "").trim();
        if (!text) { skipped++; return; }

        // ── Resolve all fields with variant key names ──
        const owner = row["Owner"] || row["owner"] || row["Assignee"] || row["assignee"] || "";
        const parentTask = row["Parent Task"] || row["parent"] || row["parentId"] || row["parent_task"] || "0";
        const wbsLevel = row["WBS Level"] || row["wbsLevel"] || row["wbs_level"] || row["wbs"] || "";
        const category = row["Category"] || row["category"] || row["cat"] || row["group"] || row["phase"] || "";

        // ── Dates (new 15-col format) ──
        let start = normalizeExcelDate(row["Start"] || row["start"] || row["Start Date"] || row["start_date"] || row["startDate"] || "");
        let finish = normalizeExcelDate(row["Finish"] || row["finish"] || row["End"] || row["end"] || row["end_date"] || row["endDate"] || row["finish_date"] || "");

        // ── Planned dates ──
        let plannedStart = normalizeExcelDate(row["Planned Start"] || row["planned_start"] || row["plannedStart"] || row["Planned"] || row["Baseline Start"] || row["baseline_start"] || "");
        let plannedEnd = normalizeExcelDate(row["Planned End"] || row["planned_end"] || row["plannedEnd"] || row["Planned Finish"] || row["Baseline End"] || row["baseline_end"] || "");

        // If no start/finish but planned dates exist → use planned as actual
        if (!start && plannedStart) start = plannedStart;
        if (!finish && plannedEnd) finish = plannedEnd;

        // Backward compat: old single-column date formats
        const oldStart = normalizeExcelDate(row["Start"] || row["start"] || row["start_date"] || row["startDate"] || row["Date"] || row["date"] || "");
        const oldEnd = normalizeExcelDate(row["Finish"] || row["finish"] || row["End"] || row["end"] || row["end_date"] || row["endDate"] || "");
        if (!start && oldStart) start = oldStart;
        if (!finish && oldEnd) finish = oldEnd;

        // ── Duration ──
        let dur = row["Duration"] || row["duration"] || row["dur"] || row["days"] || "";
        if (!dur && start && finish) {
          dur = calcDuration(start, finish);
        } else if (!dur && plannedStart && plannedEnd) {
          dur = calcDuration(plannedStart, plannedEnd);
        }
        if (!dur) dur = 1;

        // If finish missing but start + duration exist → calculate finish
        if (start && !finish && dur) {
          const s = parseDate(start);
          if (s) {
            const e = new Date(s.getTime() + (parseInt(String(dur)) || 1) * 86400000);
            finish = `${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`;
          }
        }
        // Same for planned end
        if (plannedStart && !plannedEnd && dur) {
          const s = parseDate(plannedStart);
          if (s) {
            const e = new Date(s.getTime() + (parseInt(String(dur)) || 1) * 86400000);
            plannedEnd = `${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`;
          }
        }

        // ── Progress ──
        const progRaw = row["Progress"] || row["progress"] || row["percent_complete"] || row["percentComplete"] || row["percent"] || "0";
        let prog = parseInt(String(progRaw).toString().replace("%", "")) || 0;
        prog = Math.min(100, Math.max(0, prog));

        // ── Dependency ──
        const dependency = row["Dependency"] || row["dependency"] || row["predecessorId"] || row["predecessor"] || row["Predecessor"] || "";
        const dependencyType = row["Dependency Type"] || row["dependency_type"] || row["dependencyType"] || row["linkType"] || row["link_type"] || "FS";

        // ── Milestone ──
        const milestoneVal = row["Milestone"] || row["milestone"] || row["isMilestone"] || row["is_milestone"] || "";
        const isMilestone = String(milestoneVal).toLowerCase() === "yes" || String(milestoneVal).toLowerCase() === "true" || String(milestoneVal) === "1";

        // ── Status ──
        let status = row["Status"] || row["status"] || row["state"] || row["State"] || "";
        if (!status) {
          if (prog >= 100) status = "Completed";
          else if (prog > 0) status = "In Progress";
          else status = "Not Started";
        }

        // ── Notes / Remarks ──
        const notes = row["Notes"] || row["notes"] || row["note"] || row["Remarks"] || row["remarks"] || row["Comments"] || row["comments"] || row["Description"] || row["description"] || "";

        // ── Type ──
        const type = isMilestone ? "milestone" : (row["Type"] || row["type"] || "task");
        const parent = parseInt(parentTask) || 0;

        // ── Validation ──
        if (start && finish) {
          const s = parseDate(start);
          const f = parseDate(finish);
          if (s && f && f < s) {
            errors.push(`Row ${idx + 1}: "${text}" has Finish before Start`);
          }
        }

        // ── Save ──
        saveTaskMut.mutate({
          text, owner: owner || null,
          start_date: start || null,
          end_date: finish || null,
          planned_start: plannedStart || start || null,
          planned_end: plannedEnd || finish || null,
          duration: parseInt(String(dur)) || 1,
          progress: prog,
          status: status || null,
          remarks: notes || null,
          category: category || null,
          parent, type,
        });
        imported++;
      });

      const msg = [`Imported ${imported} task(s)`];
      if (skipped > 0) msg.push(`${skipped} row(s) skipped (blank task name)`);
      if (errors.length > 0) msg.push(`Warnings:\n${errors.join("\n")}`);
      alert(msg.join("\n"));
    };
    reader.readAsArrayBuffer(file);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#F4F7FA" }}>
      {/* Header */}
      <header style={{ background: "#16324F", padding: "12px 24px", display: "flex", alignItems: "center", gap: "16px", position: "sticky", top: 0, zIndex: 100 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" }}>
          <ProgramsEngineeringLogo size={48} borderRadius={8} />
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Gantt Charts</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.5px" }}>O &amp;M Project Schedule Visualization</div>
          </div>
        </Link>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={exportExcel} className="gantt-action-btn export-btn" title="Export to Excel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Export Excel</span>
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="gantt-action-btn import-btn" title="Import from Excel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Import Excel</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) importExcel(e.target.files[0]); }} />
          <button onClick={() => { if (confirm("Reset all tasks and links?")) resetMut.mutate(); }} className="gantt-action-btn reset-btn" title="Reset all data">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span>Reset</span>
          </button>
        </div>
      </header>

      {/* KPI Cards */}
      <div style={{ padding: "16px 24px 0", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px" }}>
          <KpiCard label="Total Tasks" value={kpi.totalTasks} icon="📋" color="#005BAC" />
          <KpiCard label="Completed" value={kpi.completed} icon="✅" color="#1F9D55" />
          <KpiCard label="In Progress" value={kpi.inProgress} icon="🔄" color="#F59E0B" />
          <KpiCard label="Overdue" value={kpi.overdue} icon="⚠️" color="#DC2626" />
          <KpiCard label="Completion" value={`${kpi.completionRate}%`} icon="📊" color="#7C3AED" />
          <KpiCard label="Avg Duration" value={`${kpi.avgDuration}d`} icon="⏱️" color="#0EA5E9" />
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ padding: "16px 24px 0", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: "2px", background: "#E2E8F0", padding: "4px", borderRadius: "8px" }}>
          {(["gantt", "tasks", "resources"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "8px 16px", border: "none", borderRadius: "6px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", cursor: "pointer", transition: "all .2s", background: activeTab === tab ? "#005BAC" : "transparent", color: activeTab === tab ? "#fff" : "#5A6B7D", boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>
              {tab === "gantt" ? "📅 Gantt Chart" : tab === "tasks" ? "📝 Task List" : "👥 Resources"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "16px 24px 24px", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {activeTab === "gantt" && (
          <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)", border: "1px solid #D6DFE8", overflow: "hidden" }}>
            <NativeGanttChart tasks={(tasksQuery.data || []) as GanttTask[]} />
          </div>
        )}

        {activeTab === "tasks" && <TaskListTab tasks={tasksQuery.data || []} saveTask={saveTaskMut} deleteTask={deleteTaskMut} />}

        {activeTab === "resources" && <ResourcesTab tasks={tasksQuery.data || []} />}
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #D6DFE8", padding: "16px 24px", textAlign: "right", fontSize: 11, color: "#5A6B7D" }}>
        Program Oversight Center &copy; 2026
      </footer>

      {/* Styles */}
      <style>{`
        .gantt-action-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 12px; font-weight: 600; font-family: Inter, sans-serif; border: none; border-radius: 6px; cursor: pointer; transition: all .15s; white-space: nowrap; color: #fff; }
        .export-btn { background: #1F9D55; } .export-btn:hover { background: #15803D; }
        .import-btn { background: #005BAC; } .import-btn:hover { background: #004D99; }
        .reset-btn { background: #DC2626; } .reset-btn:hover { background: #B91C1C; }
        @media (max-width: 768px) {
          .gantt-action-btn { padding: 6px 10px; font-size: 11px; }
        }
        @media (max-width: 480px) {
          .gantt-action-btn span { display: none; }
          .gantt-action-btn { padding: 6px 8px; }
        }
      `}</style>
    </div>
  );
}

/* ─── KPI Card ─── */
function KpiCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.06)", border: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
        <div style={{ fontSize: 10, color: "#8BA3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      </div>
    </div>
  );
}

/* ─── Task List Tab — Full 10-field CRUD ─── */
interface TaskForm {
  text: string; owner: string;
  plannedStart: string; plannedEnd: string;
  actualStart: string; actualEnd: string;
  duration: number; progress: number;
  status: string; remarks: string;
  type: string; parent: number;
}

const EMPTY_FORM: TaskForm = {
  text: "", owner: "", plannedStart: "", plannedEnd: "", actualStart: "", actualEnd: "",
  duration: 1, progress: 0, status: "Not Started", remarks: "", type: "task", parent: 0,
};

function taskToForm(t: any): TaskForm {
  return {
    text: t.text || "",
    owner: t.owner || "",
    plannedStart: t.plannedStart ? String(t.plannedStart).slice(0, 10) : "",
    plannedEnd: t.plannedEnd ? String(t.plannedEnd).slice(0, 10) : "",
    actualStart: t.startDate ? String(t.startDate).slice(0, 10) : "",
    actualEnd: t.endDate ? String(t.endDate).slice(0, 10) : "",
    duration: t.duration || 1,
    progress: normProgress(t.progress),
    status: rowStatus(t),
    remarks: t.remarks || "",
    type: t.type || "task",
    parent: t.parent || 0,
  };
}

function rowStatus(t: any): string {
  const p = normProgress(t.progress);
  if (p >= 100) return "Completed";
  if (p > 0) {
    const aEnd = parseDate(t.endDate);
    const pEnd = parseDate(t.plannedEnd);
    if (aEnd && pEnd && aEnd > pEnd) return "In Progress (Delayed)";
    return "In Progress";
  }
  return "Not Started";
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    "Completed": { bg: "#DCFCE7", color: "#166534" },
    "In Progress": { bg: "#DBEAFE", color: "#1E40AF" },
    "In Progress (Delayed)": { bg: "#FEE2E2", color: "#991B1B" },
    "Not Started": { bg: "#F1F5F9", color: "#475569" },
  };
  const s = map[status] || map["Not Started"];
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>{status}</span>;
}

function TaskListTab({ tasks, saveTask, deleteTask }: { tasks: any[]; saveTask: any; deleteTask: any }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const [showAdd, setShowAdd] = useState(false);

  // Filter out garbage rows
  const validTasks = tasks.filter((t) => t.text && t.text.trim() && t.text.trim() !== "-");

  const startEdit = (t: any) => {
    setEditingId(t.id);
    setForm(taskToForm(t));
    setShowAdd(false);
  };

  const startAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowAdd(true);
  };

  const submitForm = () => {
    if (!form.text.trim()) { alert("Task Name is required"); return; }
    const payload: any = {
      text: form.text.trim(),
      owner: form.owner || null,
      planned_start: form.plannedStart || null,
      planned_end: form.plannedEnd || null,
      start_date: form.actualStart || null,
      end_date: form.actualEnd || null,
      duration: form.duration || 1,
      progress: Math.min(100, Math.max(0, form.progress)),
      status: form.status || "Not Started",
      remarks: form.remarks || null,
      type: form.type || "task",
      parent: form.parent || 0,
    };
    if (editingId) payload.id = editingId;
    saveTask.mutate(payload);
    setEditingId(null);
    setShowAdd(false);
    setForm(EMPTY_FORM);
  };

  const inputStyle: React.CSSProperties = { fontSize: 12, padding: "5px 8px", border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter, sans-serif", width: "100%", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3, display: "block" };

  const renderForm = () => (
    <div style={{ background: "#FAFBFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "16px", marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#16324F" }}>{editingId ? "Edit Task" : "Add New Task"}</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 16px" }}>
        <div>
          <label style={labelStyle}>Task Name *</label>
          <input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} style={inputStyle} placeholder="Enter task name" />
        </div>
        <div>
          <label style={labelStyle}>Owner</label>
          <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} style={inputStyle} placeholder="Assignee name" />
        </div>
        <div>
          <label style={labelStyle}>Planned Start</label>
          <input type="date" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Planned End</label>
          <input type="date" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Actual Start</label>
          <input type="date" value={form.actualStart} onChange={(e) => setForm({ ...form, actualStart: e.target.value })} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Actual End</label>
          <input type="date" value={form.actualEnd} onChange={(e) => setForm({ ...form, actualEnd: e.target.value })} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Duration (days)</label>
          <input type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: parseInt(e.target.value) || 1 })} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Progress %</label>
          <input type="number" min={0} max={100} value={form.progress} onChange={(e) => setForm({ ...form, progress: parseInt(e.target.value) || 0 })} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inputStyle}>
            <option>Not Started</option>
            <option>In Progress</option>
            <option>In Progress (Delayed)</option>
            <option>Completed</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} style={inputStyle} placeholder="Notes..." />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={submitForm} style={{ padding: "8px 20px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#1F9D55", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Save</button>
        <button onClick={() => { setEditingId(null); setShowAdd(false); }} style={{ padding: "8px 20px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #D6DFE8", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#16324F" }}>Task List</h3>
        <span style={{ fontSize: 12, color: "#8BA3B8" }}>{validTasks.length} tasks</span>
      </div>

      {!showAdd && !editingId && (
        <button onClick={startAdd} style={{ marginBottom: 16, padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#005BAC", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>+ Add Task</button>
      )}

      {(showAdd || editingId) && renderForm()}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #E2E8F0" }}>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Task Name</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Owner</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Planned Start</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Planned End</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Actual Start</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Actual End</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Progress</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Status</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569", whiteSpace: "nowrap" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {validTasks.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px", color: "#2D3748", fontWeight: 600, whiteSpace: "nowrap" }}>{t.text}</td>
                <td style={{ padding: "8px", color: "#5A6B7D", whiteSpace: "nowrap" }}>{t.owner || "—"}</td>
                <td style={{ padding: "8px", color: "#5A6B7D", whiteSpace: "nowrap", fontSize: 11 }}>{t.plannedStart ? String(t.plannedStart).slice(0, 10) : "—"}</td>
                <td style={{ padding: "8px", color: "#5A6B7D", whiteSpace: "nowrap", fontSize: 11 }}>{t.plannedEnd ? String(t.plannedEnd).slice(0, 10) : "—"}</td>
                <td style={{ padding: "8px", color: "#5A6B7D", whiteSpace: "nowrap", fontSize: 11 }}>{t.startDate ? String(t.startDate).slice(0, 10) : "—"}</td>
                <td style={{ padding: "8px", color: "#5A6B7D", whiteSpace: "nowrap", fontSize: 11 }}>{t.endDate ? String(t.endDate).slice(0, 10) : "—"}</td>
                <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                  <div style={{ width: 60, height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${normProgress(t.progress)}%`, height: "100%", background: normProgress(t.progress) >= 100 ? "#1F9D55" : normProgress(t.progress) > 0 ? "#005BAC" : "#94A3B8", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 10, color: "#94A3B8" }}>{normProgress(t.progress)}%</span>
                </td>
                <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{statusBadge(rowStatus(t))}</td>
                <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                  <button onClick={() => startEdit(t)} style={{ fontSize: 11, padding: "3px 8px", background: "#EFF6FF", color: "#005BAC", border: "none", borderRadius: 4, cursor: "pointer" }}>Edit</button>
                  <button onClick={() => { if (confirm("Delete this task?")) deleteTask.mutate({ id: t.id }); }} style={{ fontSize: 11, padding: "3px 8px", background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 4, cursor: "pointer", marginLeft: 4 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Resources Tab ─── */
function ResourcesTab({ tasks }: { tasks: any[] }) {
  const owners = useMemo(() => {
    const map: Record<string, { owner: string; tasks: any[]; totalDays: number; completed: number }> = {};
    for (const t of tasks) {
      const o = t.owner || "Unassigned";
      if (!map[o]) map[o] = { owner: o, tasks: [], totalDays: 0, completed: 0 };
      map[o].tasks.push(t);
      map[o].totalDays += t.duration || 0;
      if (normProgress(t.progress) >= 100) map[o].completed++;
    }
    return Object.values(map).sort((a, b) => b.totalDays - a.totalDays);
  }, [tasks]);

  return (
    <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #D6DFE8", padding: "20px" }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#16324F" }}>Team Resources</h3>
      {owners.length === 0 && <p style={{ color: "#8BA3B8", fontSize: 12 }}>No resource assignments yet.</p>}
      <div style={{ display: "grid", gap: "10px" }}>
        {owners.map((o) => (
          <div key={o.owner} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", background: "#FAFBFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#005BAC15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#005BAC" }}>{o.owner.charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#2D3748" }}>{o.owner}</div>
              <div style={{ fontSize: 11, color: "#8BA3B8" }}>{o.tasks.length} tasks · {o.totalDays}d total · {o.completed}/{o.tasks.length} done</div>
            </div>
            <div style={{ width: 80, height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${o.tasks.length > 0 ? (o.completed / o.tasks.length) * 100 : 0}%`, height: "100%", background: "#1F9D55", borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
