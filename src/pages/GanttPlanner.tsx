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

/* ─── Native Gantt Chart Component ─── */
function NativeGanttChart({ tasks }: { tasks: GanttTask[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { projectStart, projectEnd, totalDays, dayWidth, rows } = useMemo(() => {
    if (!tasks.length) {
      return { projectStart: new Date(), projectEnd: new Date(), totalDays: 30, dayWidth: 18, rows: [] };
    }

    // Find project date range
    let start: Date | null = null;
    let end: Date | null = null;
    for (const t of tasks) {
      const s = parseDate(t.startDate);
      const e = t.endDate ? parseDate(t.endDate) : s ? new Date(s.getTime() + (t.duration || 1) * 86400000) : null;
      if (s && (!start || s < start)) start = s;
      if (e && (!end || e > end)) end = e;
    }
    if (!start) start = new Date();
    if (!end) end = new Date(start.getTime() + 30 * 86400000);

    // Add padding
    const ps = new Date(start.getTime() - 5 * 86400000);
    const pe = new Date(end.getTime() + 10 * 86400000);
    const td = Math.max(daysBetween(ps, pe), 30);

    // Responsive day width
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const dw = isMobile ? 12 : 18;

    // Build rows (exclude project-type rows from chart, show only tasks/milestones)
    const chartRows = tasks
      .filter((t) => t.type !== "project" && parseDate(t.startDate))
      .map((t) => {
        const sd = parseDate(t.startDate)!;
        const dur = t.duration || 1;
        const left = Math.max(0, daysBetween(ps, sd)) * dw;
        const width = dur * dw;
        const prog = Math.min(1, Math.max(0, t.progress || 0));
        const isMilestone = t.type === "milestone";
        return { task: t, left, width, prog, isMilestone };
      });

    return { projectStart: ps, projectEnd: pe, totalDays: td, dayWidth: dw, rows: chartRows };
  }, [tasks]);

  // Build month header columns
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
  const rowHeight = 40;
  const headerHeight = 40;
  const chartHeight = Math.max(300, rows.length * rowHeight + headerHeight + 20);

  const barColor = (task: GanttTask) => {
    const p = task.progress || 0;
    if (task.type === "milestone") return "#7C3AED";
    if (p >= 1) return "#1F9D55";
    if (p > 0) return "#005BAC";
    return "#94A3B8";
  };

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
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#2D3748", fontWeight: task.parent === 0 ? 600 : 400 }} title={task.text}>
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

          {/* Task bars */}
          {rows.map(({ task, left, width, prog, isMilestone }, idx) => {
            const top = headerHeight + idx * rowHeight;
            const color = barColor(task);
            return (
              <div key={task.id} style={{ position: "absolute", left, top, height: rowHeight, display: "flex", alignItems: "center", zIndex: 1 }}>
                {isMilestone ? (
                  /* Milestone: diamond shape */
                  <div style={{ width: 14, height: 14, background: color, transform: "rotate(45deg)", borderRadius: 2, marginLeft: -7, boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                ) : (
                  /* Task bar */
                  <div style={{ width, height: 20, background: "#E2E8F0", borderRadius: 4, overflow: "hidden", position: "relative", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }}>
                    {/* Progress fill */}
                    <div style={{ width: `${prog * 100}%`, height: "100%", background: color, borderRadius: 4, transition: "width .3s" }} />
                    {/* Progress text */}
                    {width > 40 && (
                      <span style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", fontSize: 9, fontWeight: 700, color: prog > 0.4 ? "#fff" : "#475569", lineHeight: 1 }}>
                        {Math.round(prog * 100)}%
                      </span>
                    )}
                  </div>
                )}
                {/* Duration label */}
                {!isMilestone && width > 60 && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: "#94A3B8", whiteSpace: "nowrap" }}>
                    {task.duration}d
                  </span>
                )}
              </div>
            );
          })}
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
    const completed = tasks.filter((t: any) => (t.progress || 0) >= 1).length;
    const inProgress = tasks.filter((t: any) => { const p = t.progress || 0; return p > 0 && p < 1; }).length;
    const overdue = tasks.filter((t: any) => {
      const end = t.endDate ? parseDate(t.endDate) : t.startDate ? new Date(new Date(t.startDate).getTime() + (t.duration || 1) * 86400000) : null;
      return end && end < now && (t.progress || 0) < 1;
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

  /* ─── Excel Export ─── */
  const exportExcel = () => {
    const rows = (tasksQuery.data || []).map((t: any) => ({
      "ID": t.id,
      "Task Name": t.text || "",
      "Owner": t.owner || "",
      "Start Date": t.startDate ? String(t.startDate).slice(0, 10) : "",
      "End Date": t.endDate ? String(t.endDate).slice(0, 10) : "",
      "Duration": t.duration || "",
      "Progress": Math.round((t.progress || 0) * 100) + "%",
      "Type": t.type || "task",
      "Parent": t.parent || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gantt Tasks");
    XLSX.writeFile(wb, "Gantt_Tasks.xlsx");
  };

  /* ─── Excel Import ─── */
  const importExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      rows.forEach((row: any) => {
        const text = row["Task Name"] || row["text"] || "Imported Task";
        const start = row["Start Date"] || row["start_date"] || "";
        const end = row["End Date"] || row["end_date"] || "";
        const dur = row["Duration"] || row["duration"] || 1;
        const prog = parseInt((row["Progress"] || "0").toString().replace("%", "")) || 0;
        const owner = row["Owner"] || row["owner"] || "";
        const type = row["Type"] || row["type"] || "task";
        const parent = parseInt(row["Parent"] || row["parent"] || "0") || 0;

        saveTaskMut.mutate({
          text, start_date: start ? String(start) : null, end_date: end ? String(end) : null,
          duration: parseInt(dur) || 1, progress: prog, parent, type, owner,
        });
      });
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

/* ─── Task List Tab ─── */
function TaskListTab({ tasks, saveTask, deleteTask }: { tasks: any[]; saveTask: any; deleteTask: any }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState({ text: "", start_date: "", duration: 1, progress: 0, owner: "", type: "task", parent: 0 });

  const startEdit = (t: any) => {
    setEditing(t.id);
    setForm({
      text: t.text || "",
      start_date: t.startDate ? t.startDate.slice(0, 10) : "",
      duration: t.duration || 1,
      progress: t.progress || 0,
      owner: t.owner || "",
      type: t.type || "task",
      parent: t.parent || 0,
    });
  };

  const submitEdit = () => {
    if (!editing) return;
    saveTask.mutate({
      id: editing,
      text: form.text,
      start_date: form.start_date || null,
      duration: form.duration,
      progress: form.progress,
      owner: form.owner,
      type: form.type,
      parent: form.parent,
    });
    setEditing(null);
  };

  const addTask = () => {
    saveTask.mutate({
      text: "New Task",
      start_date: new Date().toISOString().slice(0, 10) + " 08:00",
      duration: 5,
      progress: 0,
      owner: "",
      type: "task",
      parent: 0,
    });
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #D6DFE8", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#16324F" }}>Task List</h3>
        <span style={{ fontSize: 12, color: "#8BA3B8" }}>{tasks.length} tasks</span>
      </div>
      <button onClick={addTask} style={{ marginBottom: 12, padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#005BAC", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>+ Add Task</button>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #E2E8F0" }}>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569" }}>ID</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569" }}>Task</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569" }}>Owner</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569" }}>Start</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569" }}>Duration</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569" }}>Progress</th>
              <th style={{ textAlign: "left", padding: "8px", color: "#475569" }}></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                {editing === t.id ? (
                  <>
                    <td style={{ padding: "6px 8px" }}>{t.id}</td>
                    <td style={{ padding: "6px 8px" }}><input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} style={{ width: 120, fontSize: 12, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                    <td style={{ padding: "6px 8px" }}><input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} style={{ width: 80, fontSize: 12, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                    <td style={{ padding: "6px 8px" }}><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} style={{ width: 120, fontSize: 12, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                    <td style={{ padding: "6px 8px" }}><input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: parseInt(e.target.value) || 1 })} style={{ width: 50, fontSize: 12, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                    <td style={{ padding: "6px 8px" }}><input type="number" value={form.progress} onChange={(e) => setForm({ ...form, progress: parseInt(e.target.value) || 0 })} style={{ width: 50, fontSize: 12, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                    <td style={{ padding: "6px 8px" }}>
                      <button onClick={submitEdit} style={{ fontSize: 11, padding: "3px 8px", background: "#1F9D55", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Save</button>
                      <button onClick={() => setEditing(null)} style={{ fontSize: 11, padding: "3px 8px", background: "#F1F5F9", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer", marginLeft: 4 }}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "8px", color: "#94A3B8", fontWeight: 600 }}>{t.id}</td>
                    <td style={{ padding: "8px", color: "#2D3748", fontWeight: 600 }}>{t.text || "Untitled"}</td>
                    <td style={{ padding: "8px", color: "#5A6B7D" }}>{t.owner || "—"}</td>
                    <td style={{ padding: "8px", color: "#5A6B7D" }}>{t.startDate ? t.startDate.slice(0, 10) : "—"}</td>
                    <td style={{ padding: "8px", color: "#5A6B7D" }}>{t.duration || 0}d</td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ width: 60, height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, (t.progress || 0) * 100)}%`, height: "100%", background: (t.progress || 0) >= 1 ? "#1F9D55" : (t.progress || 0) > 0 ? "#005BAC" : "#94A3B8", borderRadius: 3 }} />
                      </div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <button onClick={() => startEdit(t)} style={{ fontSize: 11, padding: "3px 8px", background: "#EFF6FF", color: "#005BAC", border: "none", borderRadius: 4, cursor: "pointer" }}>Edit</button>
                      <button onClick={() => { if (confirm("Delete this task?")) deleteTask.mutate({ id: t.id }); }} style={{ fontSize: 11, padding: "3px 8px", background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 4, cursor: "pointer", marginLeft: 4 }}>Delete</button>
                    </td>
                  </>
                )}
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
      if ((t.progress || 0) >= 1) map[o].completed++;
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
