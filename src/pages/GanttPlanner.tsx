import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import { gantt } from "dhtmlx-gantt";
import "dhtmlx-gantt/codebase/dhtmlxgantt.css";
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

export default function GanttPlanner() {
  const ganttContainer = useRef<HTMLDivElement>(null);
  const ganttInit = useRef(false);
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

  /* ─── Helpers ─── */
  const calcKpi = useCallback((tasks: any[]): KpiData => {
    const now = new Date();
    const total = tasks.length;
    const completed = tasks.filter((t: any) => (t.progress || 0) >= 1).length;
    const inProgress = tasks.filter((t: any) => {
      const p = t.progress || 0;
      return p > 0 && p < 1;
    }).length;
    const overdue = tasks.filter((t: any) => {
      const end = t.end_date ? new Date(t.end_date) : null;
      return end && end < now && (t.progress || 0) < 1;
    }).length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgDuration = total > 0
      ? Math.round(tasks.reduce((s: number, t: any) => s + (t.duration || 0), 0) / total)
      : 0;
    return { totalTasks: total, completed, inProgress, overdue, completionRate, avgDuration };
  }, []);

  /* ─── Init Gantt ─── */
  useEffect(() => {
    if (ganttInit.current || !ganttContainer.current) return;
    ganttInit.current = true;

    /* Gantt config */
    gantt.config.date_format = "%Y-%m-%d %H:%i";
    gantt.config.xml_date = "%Y-%m-%d %H:%i";
    gantt.config.scale_unit = "month";
    gantt.config.step = 1;
    gantt.config.date_scale = "%F %Y";
    gantt.config.subscales = [{ unit: "day", step: 1, date: "%j" }];
    gantt.config.min_column_width = 30;
    gantt.config.row_height = 34;
    gantt.config.bar_height = 22;
    gantt.config.drag_move = true;
    gantt.config.drag_resize = true;
    gantt.config.drag_progress = true;
    gantt.config.drag_links = true;
    gantt.config.details_on_create = true;
    gantt.config.details_on_dblclick = true;
    gantt.config.show_unscheduled = true;

    /* Lightbox config */
    gantt.config.lightbox.sections = [
      { name: "description", height: 38, map_to: "text", type: "textarea", focus: true },
      { name: "owner", height: 30, map_to: "owner", type: "textarea" },
      { name: "type", height: 30, map_to: "type", type: "template" },
      { name: "time", type: "duration", map_to: "auto" },
    ];
    gantt.locale.labels.section_description = "Task Name";
    gantt.locale.labels.section_owner = "Owner / Assignee";
    gantt.locale.labels.section_type = "Type";

    /* Columns */
    gantt.config.columns = [
      { name: "text", label: "Task Name", tree: true, width: 200, resize: true },
      { name: "owner", label: "Owner", width: 120, align: "center", resize: true },
      { name: "start_date", label: "Start", width: 90, align: "center" },
      { name: "end_date", label: "End", width: 90, align: "center" },
      { name: "duration", label: "Duration", width: 70, align: "center" },
      { name: "progress", label: "%", width: 50, align: "center", template: (task: any) => Math.round((task.progress || 0) * 100) + "%" },
      { name: "add", label: "", width: 40 },
    ];

    /* Color coding by progress */
    gantt.templates.task_class = (start: Date, end: Date, task: any) => {
      const p = task.progress || 0;
      if (task.type === "milestone") return "milestone-task";
      if (p >= 1) return "completed-task";
      if (p > 0) return "inprogress-task";
      return "notstarted-task";
    };

    /* Attach handlers */
    gantt.attachEvent("onAfterTaskAdd", (_id: string, task: any) => {
      saveTaskMut.mutate({
        text: task.text || "New Task",
        start_date: task.start_date ? gantt.date.date_to_str("%Y-%m-%d %H:%i")(task.start_date) : null,
        end_date: task.end_date ? gantt.date.date_to_str("%Y-%m-%d %H:%i")(task.end_date) : null,
        duration: task.duration || 1,
        progress: task.progress || 0,
        parent: task.parent || 0,
        type: task.type || "task",
        owner: task.owner || "",
        sortorder: task.sortorder || 0,
      });
    });

    gantt.attachEvent("onAfterTaskUpdate", (_id: string, task: any) => {
      saveTaskMut.mutate({
        id: parseInt(_id),
        text: task.text || "Task",
        start_date: task.start_date ? gantt.date.date_to_str("%Y-%m-%d %H:%i")(task.start_date) : null,
        end_date: task.end_date ? gantt.date.date_to_str("%Y-%m-%d %H:%i")(task.end_date) : null,
        duration: task.duration || 1,
        progress: task.progress || 0,
        parent: task.parent || 0,
        type: task.type || "task",
        owner: task.owner || "",
      });
    });

    gantt.attachEvent("onAfterTaskDelete", (_id: string) => {
      deleteTaskMut.mutate({ id: parseInt(_id) });
    });

    gantt.attachEvent("onAfterLinkAdd", (_id: string, link: any) => {
      saveLinkMut.mutate({ source: link.source, target: link.target, type: link.type || "0" });
    });

    gantt.attachEvent("onAfterLinkDelete", (_id: string) => {
      deleteLinkMut.mutate({ id: parseInt(_id) });
    });

    gantt.init(ganttContainer.current);
  }, []);

  /* ─── Load data ─── */
  useEffect(() => {
    if (!tasksQuery.data || !linksQuery.data) return;

    const tasks = tasksQuery.data.map((t: any) => ({
      id: t.id,
      text: t.text,
      start_date: t.startDate ? t.startDate.replace("T", " ").slice(0, 16) : undefined,
      end_date: t.endDate ? t.endDate.replace("T", " ").slice(0, 16) : undefined,
      duration: t.duration || 1,
      progress: (t.progress || 0) / 100,
      parent: t.parent || 0,
      type: t.type || "task",
      owner: t.owner || "",
      open: t.open !== 0,
    }));

    const links = linksQuery.data.map((l: any) => ({
      id: l.id,
      source: l.source,
      target: l.target,
      type: l.type || "0",
    }));

    gantt.clearAll();
    gantt.parse({ data: tasks, links });

    setKpi(calcKpi(tasks));
  }, [tasksQuery.data, linksQuery.data, calcKpi]);

  /* ─── Excel Export ─── */
  const exportExcel = () => {
    const data = gantt.serialize();
    const today = new Date().toISOString().slice(0, 10);
    const headers = [
      "Task ID", "Parent Task", "WBS Level", "Task Name", "Owner",
      "Start", "Finish", "Duration", "Progress", "Dependency",
      "Dependency Type", "Milestone", "Category", "Status", "Notes"
    ];

    const rows = data.data.length > 0
      ? data.data.map((t: any) => {
          // Find dependency link
          const link = data.links?.find((l: any) => l.source === t.id);
          const wbs = gantt.getWBSCode(t.id);
          const wbsLevel = wbs ? wbs.split(".").length : 1;
          const isMilestone = t.type === "milestone";
          const progressPct = Math.round((t.progress || 0) * 100);
          let status = "Not Started";
          if (isMilestone) status = "Milestone";
          else if (progressPct >= 100) status = "Completed";
          else if (progressPct > 0) status = "In Progress";

          return {
            "Task ID": t.id,
            "Parent Task": t.parent || "",
            "WBS Level": wbsLevel,
            "Task Name": t.text,
            "Owner": t.owner || "",
            "Start": t.start_date ? t.start_date.slice(0, 10) : "",
            "Finish": t.end_date ? t.end_date.slice(0, 10) : "",
            "Duration": t.duration || "",
            "Progress": progressPct,
            "Dependency": link ? link.target : "",
            "Dependency Type": link ? (link.type || "FS") : "",
            "Milestone": isMilestone ? "TRUE" : "FALSE",
            "Category": t.category || "",
            "Status": status,
            "Notes": t.notes || "",
          };
        })
      : []; // empty data → just headers

    const ws = rows.length > 0
      ? XLSX.utils.json_to_sheet(rows, { header: headers })
      : XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gantt Tasks");
    XLSX.writeFile(wb, `s4hana-gantt-template-${today}.xlsx`);
  };

  /* ─── Excel Import ─── */
  const importExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (!rows.length) { alert("No data found in the Excel file."); return; }

      // Collect all tasks first, then links
      const importedTasks: any[] = [];
      const importedLinks: any[] = [];

      rows.forEach((row: any) => {
        // Accept both new column names and old aliases
        const text = row["Task Name"] || row["text"] || "Imported Task";
        const start = row["Start"] || row["Start Date"] || row["start_date"] || "";
        const end = row["Finish"] || row["End Date"] || row["end_date"] || "";
        const dur = row["Duration"] || row["duration"] || 1;
        const progRaw = row["Progress"] || row["progress"] || "0";
        const prog = typeof progRaw === "number" ? progRaw : (parseInt(String(progRaw).replace("%", "")) || 0);
        const owner = row["Owner"] || row["owner"] || "";
        const parentRaw = row["Parent Task"] || row["Parent"] || row["parent"] || "0";
        const parent = parseInt(String(parentRaw)) || 0;
        const milestoneStr = row["Milestone"] || "";
        const isMilestone = milestoneStr === "TRUE" || milestoneStr === true || milestoneStr === 1;
        const type = isMilestone ? "milestone" : "task";
        const category = row["Category"] || row["category"] || "";
        const notes = row["Notes"] || row["notes"] || "";
        const depTarget = row["Dependency"] || row["dependency"] || "";
        const depType = row["Dependency Type"] || row["dependency_type"] || "FS";

        importedTasks.push({
          text,
          start_date: start ? String(start).slice(0, 10) : null,
          end_date: end ? String(end).slice(0, 10) : null,
          duration: parseInt(String(dur)) || 1,
          progress: prog,
          parent,
          type,
          owner,
          category,
          notes,
        });

        if (depTarget) {
          importedLinks.push({ target: depTarget, type: depType });
        }
      });

      // Save tasks sequentially to get IDs, then save links
      let savedCount = 0;
      importedTasks.forEach((task, idx) => {
        saveTaskMut.mutate(task, {
          onSuccess: () => {
            savedCount++;
            if (savedCount === importedTasks.length) {
              // All tasks saved — now create links
              if (importedLinks.length > 0) {
                // Refresh gantt to get IDs, then create links
                setTimeout(() => {
                  const data = gantt.serialize();
                  importedLinks.forEach((link, linkIdx) => {
                    const src = data.data[linkIdx]?.id;
                    const tgt = data.data.find((t: any) => t.text === link.target)?.id;
                    if (src && tgt) {
                      saveLinkMut.mutate({ source: src, target: tgt, type: link.type });
                    }
                  });
                }, 500);
              }
              alert(`Imported ${importedTasks.length} tasks successfully!`);
            }
          },
        });
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#F4F7FA" }}>
      {/* Header */}
      <header className="gantt-header">
        <div className="gantt-header-left">
          <Link to="/" className="gantt-header-brand">
            <ProgramsEngineeringLogo size={42} borderRadius={8} />
            <div className="gantt-header-text">
              <div className="gantt-header-title">S/4HANA Gantt Planner</div>
              <div className="gantt-header-sub">Material Management — Project Roadmap</div>
            </div>
          </Link>
        </div>
        <div className="gantt-header-actions">
          <button onClick={exportExcel} className="gantt-action-btn export-btn" title="Export to Excel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Export</span>
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="gantt-action-btn import-btn" title="Import from Excel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Import</span>
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
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "8px 16px",
                border: "none",
                borderRadius: "6px",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "Inter, sans-serif",
                cursor: "pointer",
                transition: "all .2s",
                background: activeTab === tab ? "#005BAC" : "transparent",
                color: activeTab === tab ? "#fff" : "#5A6B7D",
                boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,.1)" : "none",
              }}
            >
              {tab === "gantt" ? "📅 Gantt Chart" : tab === "tasks" ? "📝 Task List" : "👥 Resources"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "16px 24px 24px", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {activeTab === "gantt" && (
          <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)", border: "1px solid #D6DFE8", overflow: "hidden" }}>
            <div ref={ganttContainer} style={{ width: "100%", height: "calc(100vh - 340px)", minHeight: 500 }} />
          </div>
        )}

        {activeTab === "tasks" && <TaskListTab tasks={tasksQuery.data || []} saveTask={saveTaskMut} deleteTask={deleteTaskMut} />}

        {activeTab === "resources" && <ResourcesTab tasks={tasksQuery.data || []} />}
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #D6DFE8", padding: "16px 24px", textAlign: "right", fontSize: 11, color: "#5A6B7D" }}>
        Program Oversight Center &copy; 2026
      </footer>

      {/* Custom Gantt Styles */}
      <style>{`
        /* ─── Responsive Header ─── */
        .gantt-header {
          background: #16324F;
          padding: 10px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          position: sticky;
          top: 0;
          z-index: 100;
          flex-wrap: wrap;
        }
        .gantt-header-left { flex: 1 1 auto; min-width: 0; }
        .gantt-header-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
        }
        .gantt-header-text { min-width: 0; }
        .gantt-header-title {
          font-size: 15px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .gantt-header-sub {
          font-size: 10px;
          color: rgba(255,255,255,0.6);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .gantt-header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        /* Mobile: stack header */
        @media (max-width: 640px) {
          .gantt-header { padding: 8px 12px; gap: 8px; }
          .gantt-header-brand { gap: 8px; }
          .gantt-header-title { font-size: 13px; }
          .gantt-header-sub { font-size: 9px; }
          .gantt-header-actions { gap: 6px; width: 100%; justify-content: flex-start; }
          .gantt-action-btn { padding: 6px 10px !important; font-size: 11px !important; }
          .gantt-action-btn svg { width: 12px !important; height: 12px !important; }
        }

        /* ─── Buttons ─── */
        .gantt-action-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 14px; font-size: 12px; font-weight: 600;
          font-family: Inter, sans-serif; border: none; border-radius: 6px;
          cursor: pointer; transition: all .15s; white-space: nowrap;
          color: #fff;
        }
        .export-btn { background: #1F9D55; }
        .export-btn:hover { background: #15803D; }
        .import-btn { background: #005BAC; }
        .import-btn:hover { background: #004D99; }
        .reset-btn { background: #DC2626; }
        .reset-btn:hover { background: #B91C1C; }

        .completed-task .gantt_task_progress { background: #1F9D55 !important; }
        .inprogress-task .gantt_task_progress { background: #F59E0B !important; }
        .notstarted-task .gantt_task_progress { background: #94A3B8 !important; }
        .milestone-task .gantt_task_content { background: #7C3AED !important; border-radius: 50%; }

        .gantt_task_line { border-radius: 4px; }
        .gantt_grid_scale, .gantt_task_scale { background: #F8FAFC; }
        .gantt_grid_data .gantt_cell { font-family: Inter, sans-serif; font-size: 12px; color: #2D3748; }
        .gantt_task_line { box-shadow: 0 1px 3px rgba(0,0,0,.1); }

        @media (max-width: 768px) {
          .gantt-action-btn { padding: 6px 10px; font-size: 11px; }
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
    saveTask.mutate({ id: editing, ...form, start_date: form.start_date || null });
    setEditing(null);
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #D6DFE8", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#16324F", margin: 0 }}>Task List</h3>
        <span style={{ fontSize: 11, color: "#8BA3B8", fontWeight: 600 }}>{tasks.length} tasks</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Inter, sans-serif" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #E2E8F0" }}>
              <th style={{ textAlign: "left", padding: "8px 6px", color: "#5A6B7D", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>ID</th>
              <th style={{ textAlign: "left", padding: "8px 6px", color: "#5A6B7D", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>Task</th>
              <th style={{ textAlign: "left", padding: "8px 6px", color: "#5A6B7D", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>Owner</th>
              <th style={{ textAlign: "left", padding: "8px 6px", color: "#5A6B7D", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>Start</th>
              <th style={{ textAlign: "center", padding: "8px 6px", color: "#5A6B7D", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>Duration</th>
              <th style={{ textAlign: "center", padding: "8px 6px", color: "#5A6B7D", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>Progress</th>
              <th style={{ textAlign: "center", padding: "8px 6px", color: "#5A6B7D", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>Type</th>
              <th style={{ textAlign: "center", padding: "8px 6px" }}></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid #EDF1F4" }}>
                {editing === t.id ? (
                  <>
                    <td style={{ padding: "4px 6px" }}>{t.id}</td>
                    <td style={{ padding: "4px 6px" }}><input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} style={{ width: "100%", padding: "4px 6px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                    <td style={{ padding: "4px 6px" }}><input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} style={{ width: "100%", padding: "4px 6px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                    <td style={{ padding: "4px 6px" }}><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} style={{ padding: "4px 6px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}><input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: parseInt(e.target.value) || 1 })} style={{ width: 50, padding: "4px 6px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 4, textAlign: "center" }} /></td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}><input type="number" value={form.progress} onChange={(e) => setForm({ ...form, progress: parseInt(e.target.value) || 0 })} style={{ width: 50, padding: "4px 6px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 4, textAlign: "center" }} /></td>
                    <td style={{ padding: "4px 6px" }} colSpan={2}>
                      <button onClick={submitEdit} style={{ padding: "4px 10px", fontSize: 11, background: "#1F9D55", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", marginRight: 4 }}>Save</button>
                      <button onClick={() => setEditing(null)} style={{ padding: "4px 10px", fontSize: 11, background: "#E2E8F0", color: "#5A6B7D", border: "none", borderRadius: 4, cursor: "pointer" }}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "6px", color: "#8BA3B8", fontWeight: 500 }}>{t.id}</td>
                    <td style={{ padding: "6px", color: "#16324F", fontWeight: 600 }}>{t.text}</td>
                    <td style={{ padding: "6px", color: "#4A6380" }}>{t.owner || "—"}</td>
                    <td style={{ padding: "6px", color: "#4A6380", whiteSpace: "nowrap" }}>{t.startDate ? t.startDate.slice(0, 10) : "—"}</td>
                    <td style={{ padding: "6px", textAlign: "center", color: "#4A6380" }}>{t.duration}d</td>
                    <td style={{ padding: "6px", textAlign: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: (t.progress || 0) >= 100 ? "#DCFCE7" : (t.progress || 0) > 0 ? "#FEF9C3" : "#F1F5F9", color: (t.progress || 0) >= 100 ? "#15803D" : (t.progress || 0) > 0 ? "#A16207" : "#64748B" }}>
                        {t.progress || 0}%
                      </span>
                    </td>
                    <td style={{ padding: "6px", textAlign: "center" }}>
                      <span style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px", padding: "2px 8px", borderRadius: 4, background: t.type === "milestone" ? "#EDE9FE" : "#F1F5F9", color: t.type === "milestone" ? "#7C3AED" : "#64748B" }}>{t.type || "task"}</span>
                    </td>
                    <td style={{ padding: "6px", textAlign: "center" }}>
                      <button onClick={() => startEdit(t)} style={{ background: "none", border: "none", color: "#005BAC", cursor: "pointer", fontSize: 11, fontWeight: 600, marginRight: 8 }}>Edit</button>
                      <button onClick={() => { if (confirm("Delete task?")) deleteTask.mutate({ id: t.id }); }} style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Delete</button>
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
  const owners: Record<string, { count: number; completed: number; inProgress: number }> = {};
  tasks.forEach((t) => {
    const o = t.owner || "Unassigned";
    if (!owners[o]) owners[o] = { count: 0, completed: 0, inProgress: 0 };
    owners[o].count++;
    const p = t.progress || 0;
    if (p >= 100) owners[o].completed++;
    else if (p > 0) owners[o].inProgress++;
  });

  return (
    <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #D6DFE8", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#16324F", margin: 0 }}>Resource Allocation</h3>
        <span style={{ fontSize: 11, color: "#8BA3B8", fontWeight: 600 }}>{Object.keys(owners).length} resources</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {Object.entries(owners).map(([name, data]) => (
          <div key={name} style={{ background: "#F8FAFC", borderRadius: 8, padding: 14, border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#16324F", marginBottom: 8 }}>{name}</div>
            <div style={{ display: "flex", gap: 12 }}>
              <div><div style={{ fontSize: 18, fontWeight: 700, color: "#005BAC" }}>{data.count}</div><div style={{ fontSize: 9, color: "#8BA3B8", fontWeight: 600, textTransform: "uppercase" }}>Tasks</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 700, color: "#1F9D55" }}>{data.completed}</div><div style={{ fontSize: 9, color: "#8BA3B8", fontWeight: 600, textTransform: "uppercase" }}>Done</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 700, color: "#F59E0B" }}>{data.inProgress}</div><div style={{ fontSize: 9, color: "#8BA3B8", fontWeight: 600, textTransform: "uppercase" }}>Active</div></div>
            </div>
            <div style={{ marginTop: 8, height: 4, background: "#E2E8F0", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${data.count > 0 ? (data.completed / data.count) * 100 : 0}%`, height: "100%", background: "linear-gradient(90deg, #1F9D55, #34D399)", borderRadius: 2, transition: "width .3s" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
