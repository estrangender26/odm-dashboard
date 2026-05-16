import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";
import * as XLSX from "xlsx";

/* ─── Banner (replaces alert) ─── */
function Banner({ type, message, onDismiss }: { type: "error" | "success" | "info"; message: string; onDismiss?: () => void }) {
  const s: Record<string, string> = { error: "bg-red-50 border-red-200 text-red-800", success: "bg-green-50 border-green-200 text-green-800", info: "bg-blue-50 border-blue-200 text-blue-800" };
  return (
    <div className={`mb-3 px-4 py-3 border rounded-lg text-sm flex items-center gap-2 ${s[type]}`}>
      <span>{type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️"}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && <button onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>}
    </div>
  );
}

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

/* ─── Hierarchy helpers ─── */
interface TaskNode {
  task: GanttTask;
  level: number;
  children: TaskNode[];
  isExpanded: boolean;
  hasChildren: boolean;
}

function buildTaskTree(tasks: GanttTask[]): TaskNode[] {
  const taskMap = new Map<number, TaskNode>();
  const roots: TaskNode[] = [];
  for (const t of tasks) {
    if (!t.text) continue;
    taskMap.set(t.id, { task: t, level: 0, children: [], isExpanded: true, hasChildren: false });
  }
  for (const node of taskMap.values()) {
    if (node.task.parent > 0 && taskMap.has(node.task.parent)) {
      const parentNode = taskMap.get(node.task.parent)!;
      parentNode.children.push(node);
      parentNode.hasChildren = true;
    } else {
      roots.push(node);
    }
  }
  function setLevels(nodes: TaskNode[], level: number) {
    for (const n of nodes) { n.level = level; setLevels(n.children, level + 1); }
  }
  setLevels(roots, 0);
  return roots;
}

function flattenVisible(nodes: TaskNode[]): { task: GanttTask; level: number; hasChildren: boolean }[] {
  const result: { task: GanttTask; level: number; hasChildren: boolean }[] = [];
  function walk(ns: TaskNode[]) {
    for (const n of ns) {
      result.push({ task: n.task, level: n.level, hasChildren: n.hasChildren });
      if (n.isExpanded && n.children.length > 0) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

function autoCalcParent(task: GanttTask, allTasks: GanttTask[]): Partial<GanttTask> | null {
  const children = allTasks.filter(t => t.parent === task.id && t.text);
  if (children.length === 0) return null;
  const childStarts = children.map(c => c.plannedStart).filter(Boolean).map(s => new Date(s!).getTime());
  const childEnds = children.map(c => c.plannedEnd).filter(Boolean).map(s => new Date(s!).getTime());
  const childProgs = children.map(c => c.progress).filter(p => !isNaN(p));
  const updates: Partial<GanttTask> = {};
  if (childStarts.length > 0) updates.plannedStart = new Date(Math.min(...childStarts)).toISOString().slice(0, 10);
  if (childEnds.length > 0) updates.plannedEnd = new Date(Math.max(...childEnds)).toISOString().slice(0, 10);
  if (childProgs.length > 0) updates.progress = Math.round(childProgs.reduce((a, b) => a + b, 0) / childProgs.length);
  return Object.keys(updates).length > 0 ? updates : null;
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

/* ─── Zoom level type ─── */
type ZoomLevel = "autofit" | "year" | "quarter" | "month" | "week" | "day";

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  autofit: "Auto-fit", year: "Year", quarter: "Quarter", month: "Month", week: "Week", day: "Day",
};

// Fixed day widths for each zoom level (px per day)
const ZOOM_DAY_WIDTH: Record<Exclude<ZoomLevel, "autofit">, number> = {
  year: 0.5, quarter: 2, month: 5, week: 16, day: 48,
};

/* ─── Spinner Components ─── */
function Spinner({ size = 24, color = "#005BAC" }: { size?: number; color?: string }) {
  return (
    <div style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "ganttSpin 1s linear infinite" }}>
        <circle cx="12" cy="12" r="10" fill="none" stroke={`${color}30`} strokeWidth="3" />
        <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="3" strokeDasharray="30 70" strokeLinecap="round" />
      </svg>
    </div>
  );
}
function SpinnerInline({ color = "#005BAC" }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" style={{ animation: "ganttSpin 0.8s linear infinite", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke={`${color}50`} strokeWidth="3" />
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="3" strokeDasharray="30 70" strokeLinecap="round" />
    </svg>
  );
}

/* ─── Native Gantt Chart Component — Planned vs Actual dual bars ─── */
interface NativeGanttChartProps {
  tasks: GanttTask[];
  selectedTaskId: number | null;
  onSelectTask: (id: number | null) => void;
}
function NativeGanttChart({ tasks, selectedTaskId, onSelectTask }: NativeGanttChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("autofit");
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  /* Toggle expand/collapse */
  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  /* Build hierarchy tree */
  const taskTree = useMemo(() => buildTaskTree(tasks), [tasks]);

  /* Apply expanded state to tree */
  const applyExpanded = useCallback((nodes: TaskNode[]): TaskNode[] => {
    return nodes.map(n => ({
      ...n,
      isExpanded: !expandedIds.has(n.task.id),
      children: applyExpanded(n.children),
    }));
  }, [expandedIds]);

  const visibleTree = useMemo(() => applyExpanded(taskTree), [taskTree, applyExpanded]);
  const visibleFlat = useMemo(() => flattenVisible(visibleTree), [visibleTree]);
  const visibleTaskIds = useMemo(() => new Set(visibleFlat.map(v => v.task.id)), [visibleFlat]);

  /* ResizeObserver: measure the scroll container (visible area), not the inner timeline */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setContainerWidth(Math.max(300, Math.floor(el.clientWidth)));
    };
    measure();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.max(300, Math.floor(entry.contentRect.width)));
      }
    });
    ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", measure); };
  }, []);

  /* Compute project range */
  const { projectStart, projectEnd, totalDays, rows: baseRows } = useMemo(() => {
    if (!tasks.length) {
      const ps = new Date();
      const pe = new Date(ps.getTime() + 30 * 86400000);
      return { projectStart: ps, projectEnd: pe, totalDays: 30, rows: [] };
    }

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

    ps = new Date(ps.getTime() - 5 * 86400000);
    pe = new Date(pe.getTime() + 10 * 86400000);
    const td = Math.max(daysBetween(ps, pe), 30);

    // Pre-compute date objects for each task (geometry-independent)
    const base = tasks
      .filter((t) => t.type !== "project")
      .map((t) => ({
        task: t,
        plannedStart: parseDate(t.plannedStart),
        plannedEnd: parseDate(t.plannedEnd),
        actualStart: parseDate(t.startDate),
        actualEnd: parseDate(t.endDate),
        isDelayed: parseDate(t.endDate) && parseDate(t.plannedEnd) && parseDate(t.endDate)! > parseDate(t.plannedEnd)!,
        isMilestone: t.type === "milestone",
      }));

    return { projectStart: ps, projectEnd: pe, totalDays: td, rows: base };
  }, [tasks]);

  /* Compute dayWidth based on zoom level */
  const dayWidth = useMemo(() => {
    if (zoomLevel === "autofit") {
      // Auto-fit: divide available width by total days
      return Math.max(0.3, (containerWidth - 40) / totalDays);
    }
    return ZOOM_DAY_WIDTH[zoomLevel];
  }, [zoomLevel, containerWidth, totalDays]);

  /* Compute bar geometry based on dayWidth + hierarchy */
  const rows = useMemo(() => {
    // Build lookup for hierarchy info
    const levelMap = new Map<number, number>();
    const childMap = new Map<number, boolean>();
    for (const v of visibleFlat) {
      levelMap.set(v.task.id, v.level);
      childMap.set(v.task.id, v.hasChildren);
    }
    return baseRows
      .filter(r => visibleTaskIds.has(r.task.id))
      .map((r) => {
        const { plannedStart, plannedEnd, actualStart, actualEnd, isDelayed, isMilestone, task } = r;
        const plannedLeft = plannedStart ? Math.max(0, daysBetween(projectStart, plannedStart)) * dayWidth : null;
        const plannedWidth = (plannedStart && plannedEnd && daysBetween(plannedStart, plannedEnd) > 0)
          ? daysBetween(plannedStart, plannedEnd) * dayWidth : null;
        const actualLeft = actualStart ? Math.max(0, daysBetween(projectStart, actualStart)) * dayWidth : null;
        const actualWidth = (actualStart && actualEnd && daysBetween(actualStart, actualEnd) > 0)
          ? daysBetween(actualStart, actualEnd) * dayWidth
          : actualStart ? (task.duration || 1) * dayWidth : null;
        return {
          task,
          plannedLeft, plannedWidth, actualLeft, actualWidth,
          isDelayed, isMilestone,
          level: levelMap.get(task.id) || 0,
          hasChildren: childMap.get(task.id) || false,
        };
      });
  }, [baseRows, projectStart, dayWidth, visibleTaskIds, visibleFlat]);

  /* ─── Header columns based on zoom level ─── */
  const headerColumns = useMemo(() => {
    const cols: { label: string; left: number; width: number; subLabel?: string }[] = [];
    if (!projectStart) return cols;
    const ps = projectStart;
    const pe = projectEnd;

    if (zoomLevel === "day") {
      // Day zoom: show individual days
      let cur = new Date(ps);
      while (cur <= pe) {
        const dayStart = new Date(cur);
        const nextDay = new Date(cur.getTime() + 86400000);
        const dayEnd = nextDay < pe ? nextDay : pe;
        const left = daysBetween(ps, dayStart) * dayWidth;
        const width = Math.max(1, daysBetween(dayStart, dayEnd) * dayWidth);
        const dayNum = dayStart.getDate();
        const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][dayStart.getMonth()];
        cols.push({
          label: `${dayNum}`,
          subLabel: dayStart.getDay() === 0 || dayStart.getDay() === 6 ? "" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayStart.getDay()],
          left, width,
        });
        cur = nextDay;
      }
    } else if (zoomLevel === "week") {
      // Week zoom: show weeks
      let cur = new Date(ps);
      // Align to Sunday
      const dayOfWeek = cur.getDay();
      cur = new Date(cur.getTime() - dayOfWeek * 86400000);
      while (cur <= pe) {
        const weekStart = new Date(cur);
        const weekEnd = new Date(cur.getTime() + 7 * 86400000);
        const end = weekEnd < pe ? weekEnd : pe;
        const left = daysBetween(ps, weekStart) * dayWidth;
        const width = Math.max(1, daysBetween(weekStart, end) * dayWidth);
        const startFmt = fmtShortDate(weekStart);
        cols.push({ label: `Week ${startFmt}`, left, width });
        cur = weekEnd;
      }
    } else if (zoomLevel === "month" || zoomLevel === "autofit") {
      // Month zoom: show months
      let cur = new Date(ps.getFullYear(), ps.getMonth(), 1);
      while (cur <= pe) {
        const monthStart = new Date(cur);
        const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        const monthEnd = nextMonth < pe ? nextMonth : pe;
        const left = daysBetween(ps, monthStart) * dayWidth;
        const width = Math.max(1, daysBetween(monthStart, monthEnd) * dayWidth);
        cols.push({ label: fmtMonth(monthStart), left, width });
        cur = nextMonth;
      }
    } else if (zoomLevel === "quarter") {
      // Quarter zoom: show quarters
      let cur = new Date(ps.getFullYear(), Math.floor(ps.getMonth() / 3) * 3, 1);
      while (cur <= pe) {
        const qStart = new Date(cur);
        const nextQ = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
        const qEnd = nextQ < pe ? nextQ : pe;
        const left = daysBetween(ps, qStart) * dayWidth;
        const width = Math.max(1, daysBetween(qStart, qEnd) * dayWidth);
        const qNum = Math.floor(qStart.getMonth() / 3) + 1;
        cols.push({ label: `Q${qNum} ${qStart.getFullYear()}`, left, width });
        cur = nextQ;
      }
    } else if (zoomLevel === "year") {
      // Year zoom: show years
      let cur = new Date(ps.getFullYear(), 0, 1);
      while (cur <= pe) {
        const yStart = new Date(cur);
        const nextY = new Date(cur.getFullYear() + 1, 0, 1);
        const yEnd = nextY < pe ? nextY : pe;
        const left = daysBetween(ps, yStart) * dayWidth;
        const width = Math.max(1, daysBetween(yStart, yEnd) * dayWidth);
        cols.push({ label: String(yStart.getFullYear()), left, width });
        cur = nextY;
      }
    }

    return cols;
  }, [projectStart, projectEnd, dayWidth, zoomLevel]);

  const chartWidth = totalDays * dayWidth;
  const rowHeight = 42;
  const headerHeight = zoomLevel === "day" ? 44 : 34;
  const chartHeight = Math.max(300, rows.length * rowHeight + headerHeight + 12);

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
      {/* Toolbar: Zoom controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#FAFBFC", borderBottom: "1px solid #E2E8F0", flexWrap: "wrap" }}>
        {/* Zoom out / in buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, background: "#E2E8F0", borderRadius: 6, padding: 2 }}>
          <button
            onClick={() => {
              const order: ZoomLevel[] = ["year", "quarter", "month", "week", "day"];
              if (zoomLevel === "autofit") { setZoomLevel("month"); return; }
              const idx = order.indexOf(zoomLevel);
              if (idx > 0) setZoomLevel(order[idx - 1]);
            }}
            title="Zoom out"
            style={{ padding: "4px 8px", fontSize: 13, fontWeight: 700, background: "#fff", border: "none", borderRadius: 4, cursor: "pointer", color: "#475569", lineHeight: 1 }}
          >
            −
          </button>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#475569", padding: "0 4px", whiteSpace: "nowrap", minWidth: 44, textAlign: "center" }}>
            {ZOOM_LABELS[zoomLevel]}
          </span>
          <button
            onClick={() => {
              const order: ZoomLevel[] = ["year", "quarter", "month", "week", "day"];
              if (zoomLevel === "autofit") { setZoomLevel("month"); return; }
              const idx = order.indexOf(zoomLevel);
              if (idx < order.length - 1) setZoomLevel(order[idx + 1]);
            }}
            title="Zoom in"
            style={{ padding: "4px 8px", fontSize: 13, fontWeight: 700, background: "#fff", border: "none", borderRadius: 4, cursor: "pointer", color: "#475569", lineHeight: 1 }}
          >
            +
          </button>
        </div>

        {/* Quick zoom level buttons */}
        {(["autofit", "year", "quarter", "month", "week", "day"] as ZoomLevel[]).map((zl) => (
          <button
            key={zl}
            onClick={() => setZoomLevel(zl)}
            style={{
              padding: "4px 10px",
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "Inter, sans-serif",
              background: zoomLevel === zl ? "#005BAC" : "#fff",
              color: zoomLevel === zl ? "#fff" : "#5A6B7D",
              border: `1px solid ${zoomLevel === zl ? "#005BAC" : "#D6DFE8"}`,
              borderRadius: 5,
              cursor: "pointer",
              transition: "all .15s",
              whiteSpace: "nowrap",
            }}
          >
            {ZOOM_LABELS[zl]}
          </button>
        ))}

        <span className="gantt-zoom-info" style={{ marginLeft: "auto", fontSize: 10, color: "#8BA3B8", whiteSpace: "nowrap" }}>
          {rows.length} tasks · {Math.round(dayWidth * 10) / 10}px/day · {Math.round(chartWidth)}px wide
        </span>
      </div>

      {/* Legend */}
      <div className="gantt-chart-legend" style={{ display: "flex", gap: 16, padding: "8px 14px", background: "#FAFBFC", borderBottom: "1px solid #E2E8F0", fontSize: 11, fontFamily: "Inter, sans-serif", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#93C5FD", borderRadius: 2, border: "1px solid #60A5FA" }} /><span className="gantt-chart-legend-label">Planned</span></span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#86EFAC", borderRadius: 2, border: "1px solid #4ADE80" }} /><span className="gantt-chart-legend-label">Actual (on time)</span></span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#FCA5A5", borderRadius: 2, border: "1px solid #F87171" }} /><span className="gantt-chart-legend-label">Actual (delayed)</span></span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, background: "#7C3AED", transform: "rotate(45deg)", borderRadius: 1 }} /><span className="gantt-chart-legend-label">Milestone</span></span>
      </div>

      <div style={{ display: "flex", height: chartHeight, fontFamily: "Inter, sans-serif", fontSize: 12 }}>
        {/* Left: Task names column */}
        <div className="gantt-task-col" style={{ width: 200, minWidth: 200, borderRight: "1px solid #E2E8F0", background: "#FAFBFC", display: "flex", flexDirection: "column", zIndex: 2 }}>
          {/* Header */}
          <div style={{ height: headerHeight, borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", padding: "0 10px", fontWeight: 700, color: "#475569", fontSize: 11, background: "#F1F5F9" }}>
            Task Name
          </div>
          {/* Task rows with hierarchy — multi-line wrapping */}
          {rows.map(({ task, level, hasChildren }) => {
            const isSelected = selectedTaskId === task.id;
            const rowBg = isSelected ? "#DBEAFE" : hasChildren ? "#F1F5F9" : "transparent";
            return (
            <div
              key={task.id}
              onClick={(e) => { if ((e.target as HTMLElement).tagName !== "BUTTON") onSelectTask(isSelected ? null : task.id); }}
              style={{
                height: rowHeight,
                borderBottom: "1px solid #F1F5F9",
                display: "flex",
                alignItems: "flex-start",
                padding: "3px 6px",
                paddingLeft: `${6 + level * 14}px`,
                overflow: "hidden",
                background: rowBg,
                cursor: "pointer",
                transition: "background .1s",
                borderLeft: isSelected ? "3px solid #005BAC" : "3px solid transparent",
              }}
            >
              <span className="flex items-start gap-0.5 min-w-0 flex-1" style={{ overflow: "hidden", lineHeight: 1.35 }}>
                {hasChildren && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(task.id)}
                    className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
                    style={{ fontSize: 9, lineHeight: 1, padding: 0, marginTop: 1 }}
                  >
                    {expandedIds.has(task.id) ? "▸" : "▾"}
                  </button>
                )}
                {!hasChildren && <span className="w-3.5 flex-shrink-0" />}
                <span
                  className="gantt-task-name"
                  style={{
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 2,
                    overflow: "hidden",
                    color: "#2D3748",
                    fontWeight: hasChildren ? 700 : 400,
                    fontSize: 11,
                    marginLeft: 2,
                    lineHeight: 1.35,
                    wordBreak: "break-word",
                  }}
                  title={task.text}
                >
                  {task.text || "Untitled"}
                </span>
              </span>
            </div>
          );})}
        </div>

        {/* Right: Scrollable timeline */}
        <div ref={scrollRef} style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <div ref={timelineRef} style={{ width: chartWidth, position: "relative", transition: "width 0.25s ease-out" }}>
            {/* Header row */}
            <div style={{ height: headerHeight, borderBottom: "1px solid #E2E8F0", display: "flex", position: "relative", background: "#F1F5F9" }}>
              {headerColumns.map((col, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: col.left,
                    width: col.width,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRight: "1px solid #E2E8F0",
                    fontWeight: 600,
                    color: "#475569",
                    fontSize: zoomLevel === "day" ? 9 : 10,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    transition: "left 0.25s ease-out, width 0.25s ease-out",
                  }}
                  title={col.label}
                >
                  <span>{col.label}</span>
                  {col.subLabel && <span style={{ fontSize: 8, color: "#8BA3B8", fontWeight: 400 }}>{col.subLabel}</span>}
                </div>
              ))}
            </div>

            {/* Grid lines */}
            {headerColumns.map((col, i) => (
              <div
                key={`grid-${i}`}
                style={{
                  position: "absolute",
                  left: col.left,
                  top: headerHeight,
                  width: 1,
                  height: rows.length * rowHeight,
                  background: "#F1F5F9",
                  zIndex: 0,
                  transition: "left 0.25s ease-out",
                }}
              />
            ))}

            {/* Today line */}
            {(() => {
              const today = new Date();
              if (today < projectStart || today > projectEnd) return null;
              const todayLeft = daysBetween(projectStart, today) * dayWidth;
              return (
                <div
                  style={{
                    position: "absolute",
                    left: todayLeft,
                    top: 0,
                    width: 2,
                    height: chartHeight - 20,
                    background: "#DC2626",
                    zIndex: 5,
                    opacity: 0.7,
                    pointerEvents: "none",
                    transition: "left 0.25s ease-out",
                  }}
                >
                  <span style={{ position: "absolute", top: 2, left: 4, fontSize: 8, fontWeight: 700, color: "#DC2626", background: "rgba(255,255,255,0.9)", padding: "1px 3px", borderRadius: 2 }}>TODAY</span>
                </div>
              );
            })()}

            {/* Task rows — dual bars */}
            {rows.map((row, idx) => {
              const { task, plannedLeft, plannedWidth, actualLeft, actualWidth, isDelayed, isMilestone } = row;
              const top = headerHeight + idx * rowHeight;
              const isSelected = selectedTaskId === task.id;

              return (
                <div
                  key={task.id}
                  onClick={() => onSelectTask(isSelected ? null : task.id)}
                  style={{
                    position: "absolute",
                    left: 0,
                    top,
                    width: "100%",
                    height: rowHeight,
                    background: isSelected ? "rgba(219,234,254,0.5)" : "transparent",
                    cursor: "pointer",
                    zIndex: 0,
                  }}
                >
                  {isMilestone ? (
                    /* Milestone: diamond only */
                    <div style={{ position: "absolute", left: (actualLeft ?? plannedLeft ?? 0) - 6, top: top + rowHeight / 2 - 6, zIndex: 2, transition: "left 0.25s ease-out" }}>
                      <div style={{ width: 12, height: 12, background: "#7C3AED", transform: "rotate(45deg)", borderRadius: 2, boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                    </div>
                  ) : (
                    <>
                      {/* Planned bar (top) — flush with actual bar below */}
                      {plannedLeft !== null && plannedWidth !== null && (
                        <div style={{ position: "absolute", left: plannedLeft, top: top + 4, height: 14, zIndex: 1, transition: "left 0.25s ease-out, width 0.25s ease-out" }}>
                          <div style={{ width: Math.max(plannedWidth, 2), height: 14, background: "rgba(147,197,253,0.35)", border: "1px dashed #60A5FA", borderRadius: 2, position: "relative" }}>
                            {plannedWidth > 40 && (
                              <span style={{ position: "absolute", left: 3, top: "50%", transform: "translateY(-50%)", fontSize: 7, fontWeight: 600, color: "#3B82F6", whiteSpace: "nowrap" }}>Planned</span>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Actual bar (bottom) — touching planned bar above with zero gap */}
                      {actualLeft !== null && actualWidth !== null ? (
                        <div style={{ position: "absolute", left: actualLeft, top: top + 18, height: 14, zIndex: 2, transition: "left 0.25s ease-out, width 0.25s ease-out" }}>
                          <div style={{ width: Math.max(actualWidth, 2), height: 14, background: isDelayed ? "rgba(252,165,165,0.5)" : "rgba(134,239,172,0.5)", border: `1px solid ${isDelayed ? "#F87171" : "#4ADE80"}`, borderRadius: 2, position: "relative" }}>
                            {actualWidth > 40 && (
                              <span style={{ position: "absolute", left: 3, top: "50%", transform: "translateY(-50%)", fontSize: 7, fontWeight: 600, color: isDelayed ? "#DC2626" : "#15803D", whiteSpace: "nowrap" }}>
                                {isDelayed ? "Delayed" : `${normProgress(task.progress)}%`}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* No actual data yet */
                        plannedLeft !== null && (
                          <div style={{ position: "absolute", left: plannedLeft, top: top + 18, zIndex: 1, transition: "left 0.25s ease-out" }}>
                            <span style={{ fontSize: 7, color: "#CBD5E1", fontStyle: "italic" }}>No actual yet</span>
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
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const [activeTab, setActiveTab] = useState<"gantt" |"tasks"|"resources">("gantt");
  const [kpi, setKpi] = useState<KpiData>({
    totalTasks: 0, completed: 0, inProgress: 0, overdue: 0, completionRate: 0, avgDuration: 0,
  });

  /* tRPC queries — MUST be declared before any callbacks that reference them */
  const tasksQuery = trpc.gantt.tasks.useQuery();
  const linksQuery = trpc.gantt.links.useQuery();
  const utils = trpc.useUtils();

  const saveTaskMut = trpc.gantt.saveTask.useMutation({ onSuccess: () => utils.gantt.tasks.invalidate() });
  const saveTaskBatchMut = trpc.gantt.saveTask.useMutation(); // no auto-invalidate — for batch loading
  const deleteTaskMut = trpc.gantt.deleteTask.useMutation({ onSuccess: () => utils.gantt.tasks.invalidate() });
  const saveLinkMut = trpc.gantt.saveLink.useMutation({ onSuccess: () => utils.gantt.links.invalidate() });
  const deleteLinkMut = trpc.gantt.deleteLink.useMutation({ onSuccess: () => utils.gantt.links.invalidate() });
  const resetMut = trpc.gantt.resetAll.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });
  const seedMut = trpc.gantt.seed.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });

  /* ─── Gantt Project Save/Open hooks ─── */
  const { data: projectsListData } = trpc.ganttProjects.list.useQuery(undefined, { retry: 1 });
  const projectsList = projectsListData?.projects || [];
  const saveProjectMut = trpc.ganttProjects.save.useMutation({
    onSuccess: () => { utils.ganttProjects.list.invalidate(); setSaveModal(false); setProjectName(""); setBanner({ type: "success", message: "Project saved successfully." }); },
    onError: (e) => setBanner({ type: "error", message: "Save failed: " + e.message }),
  });
  const loadProjectMut = trpc.ganttProjects.get.useMutation({
    onMutate: ({ id }: { id: number }) => { setLoadingProjectId(id); },
    onSettled: () => { setLoadingProjectId(null); },
    onSuccess: async (data) => {
      try {
        const parsed = JSON.parse(data.tasksData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Reset first, then batch-insert all tasks with Promise.all
          await resetMut.mutateAsync(undefined);
          const saves = parsed.map((t: any, idx: number) =>
            saveTaskBatchMut.mutateAsync({
              text: t.text || "",
              owner: t.owner || null,
              start_date: t.startDate || t.start_date || null,
              end_date: t.endDate || t.end_date || null,
              planned_start: t.plannedStart || t.planned_start || t.plannedStartDate || null,
              planned_end: t.plannedEnd || t.planned_end || t.plannedEndDate || null,
              duration: t.duration || 1,
              progress: normProgress(t.progress),
              parent: t.parent || 0,
              type: t.type || "task",
              status: t.status || null,
              remarks: t.remarks || t.notes || null,
              category: t.category || null,
              open: t.open ?? 1,
              sortorder: t.sortorder ?? idx,
            })
          );
          await Promise.all(saves);
          // Single invalidation after all tasks are committed
          await utils.gantt.tasks.invalidate();
          await utils.gantt.links.invalidate();
          setBanner({ type: "success", message: `Loaded "${data.name}" — ${parsed.length} task(s).` });
          setCurrentProjectId(data.id);
          setCurrentProjectName(data.name);
        } else {
          setBanner({ type: "info", message: "Project is empty — no tasks to load." });
        }
        setCurrentProjectId(data.id);
        setCurrentProjectName(data.name);
        setLoadModal(false);
      } catch (e: any) { setBanner({ type: "error", message: "Failed to parse project data: " + e.message }); }
    },
    onError: (e) => setBanner({ type: "error", message: "Load failed: " + e.message }),
  });
  const deleteProjectMut = trpc.ganttProjects.delete.useMutation({
    onSuccess: () => utils.ganttProjects.list.invalidate(),
  });
  const renameProjectMut = trpc.ganttProjects.rename.useMutation({
    onSuccess: () => utils.ganttProjects.list.invalidate(),
  });

  /* Save/Open modal state */
  const [saveModal, setSaveModal] = useState(false);
  const [isSaveAs, setIsSaveAs] = useState(false);
  const [loadModal, setLoadModal] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingProjectId, setLoadingProjectId] = useState<number | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  /* ─── Indent / Outdent ─── */
  const handleIndent = useCallback(() => {
    if (!selectedTaskId || !tasksQuery.data) return;
    const all = tasksQuery.data;
    const idx = all.findIndex((t: any) => t.id === selectedTaskId);
    if (idx <= 0) { setBanner({ type: "info", message: "Cannot indent the first task." }); return; }
    const target = all[idx];
    const above = all[idx - 1];
    if (target.parent === above.id) { setBanner({ type: "info", message: "Already indented under this task." }); return; }
    const newParent = above.type === "project" || above.parent === 0 ? above.id : above.parent || above.id;
    saveTaskMut.mutate({
      id: selectedTaskId,
      text: target.text,
      owner: target.owner,
      start_date: target.startDate || null,
      end_date: target.endDate || null,
      planned_start: target.plannedStart || null,
      planned_end: target.plannedEnd || null,
      duration: target.duration || 1,
      progress: normProgress(target.progress),
      parent: newParent,
      type: target.type || "task",
      status: target.status || null,
      remarks: target.remarks || null,
      category: target.category || null,
      open: target.open ?? 1,
      sortorder: target.sortorder ?? idx,
    });
    setBanner({ type: "success", message: `"${target.text}" indented under "${above.text}".` });
  }, [selectedTaskId, tasksQuery.data, saveTaskMut]);

  const handleOutdent = useCallback(() => {
    if (!selectedTaskId || !tasksQuery.data) return;
    const all = tasksQuery.data;
    const target = all.find((t: any) => t.id === selectedTaskId);
    if (!target) return;
    if (!target.parent || target.parent === 0) { setBanner({ type: "info", message: "Already at root level." }); return; }
    const parentTask = all.find((t: any) => t.id === target.parent);
    const newParent = parentTask?.parent || 0;
    saveTaskMut.mutate({
      id: selectedTaskId,
      text: target.text,
      owner: target.owner,
      start_date: target.startDate || null,
      end_date: target.endDate || null,
      planned_start: target.plannedStart || null,
      planned_end: target.plannedEnd || null,
      duration: target.duration || 1,
      progress: normProgress(target.progress),
      parent: newParent,
      type: target.type || "task",
      status: target.status || null,
      remarks: target.remarks || null,
      category: target.category || null,
      open: target.open ?? 1,
      sortorder: target.sortorder ?? 0,
    });
    setBanner({ type: "success", message: `"${target.text}" outdented to ${newParent === 0 ? "root" : "parent"} level.` });
  }, [selectedTaskId, tasksQuery.data, saveTaskMut]);

  /* Quick Save — update existing project without modal */
  const handleQuickSave = useCallback(() => {
    if (!currentProjectId) { setSaveModal(true); setIsSaveAs(false); setProjectName(""); return; }
    const currentTasks = tasksQuery.data || [];
    if (currentTasks.length === 0) { setBanner({ type: "error", message: "No tasks to save. Add tasks first." }); return; }
    const tasksJson = JSON.stringify(currentTasks);
    const linksJson = linksQuery.data ? JSON.stringify(linksQuery.data) : null;
    saveProjectMut.mutate(
      { id: currentProjectId, name: currentProjectName, tasksData: tasksJson, linksData: linksJson, description: `${currentTasks.length} tasks` },
      { onSuccess: () => setBanner({ type: "success", message: `"${currentProjectName}" updated.` }) }
    );
  }, [currentProjectId, currentProjectName, tasksQuery.data, linksQuery.data, saveProjectMut]);

  /* Save As / New Save — show modal then create */
  const handleSaveProject = useCallback(() => {
    const name = projectName.trim();
    if (!name) return;
    const currentTasks = tasksQuery.data || [];
    if (currentTasks.length === 0) { setBanner({ type: "error", message: "No tasks to save. Add tasks first." }); return; }
    const tasksJson = JSON.stringify(currentTasks);
    const linksJson = linksQuery.data ? JSON.stringify(linksQuery.data) : null;
    // Save As always creates new; regular Save (no current project) also creates new
    saveProjectMut.mutate(
      { name, tasksData: tasksJson, linksData: linksJson, description: `${currentTasks.length} tasks` },
      {
        onSuccess: (data: any) => {
          setCurrentProjectId(data.id);
          setCurrentProjectName(data.name);
          setBanner({ type: "success", message: `"${data.name}" saved.` });
        },
      }
    );
  }, [projectName, tasksQuery.data, linksQuery.data, saveProjectMut]);

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
      if (!rows.length) { setBanner({ type: "error", message: "No data found in the file." }); return; }

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

      const msg = `Imported ${imported} task(s)` + (skipped > 0 ? `, ${skipped} skipped.` : ".");
      setBanner({ type: errors.length > 0 ? "info" : "success", message: msg + (errors.length > 0 ? ` Warnings: ${errors.join("; ")}` : "") });
    };
    reader.readAsArrayBuffer(file);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#F4F7FA" }}>
      {/* Header */}
      <header className="gantt-header" style={{ background: "#16324F", padding: "12px 24px", position: "sticky", top: 0, zIndex: 100 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", flexShrink: 0 }}>
          <ProgramsEngineeringLogo size={48} borderRadius={8} />
          <div>
            <div className="gantt-header-title" style={{ fontSize: "15px", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Gantt Charts</div>
            <div className="gantt-header-sub" style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {currentProjectId ? `📁 ${currentProjectName}` : "O & M Project Schedule Visualization"}
            </div>
          </div>
        </Link>
        <div className="gantt-header-buttons">
          <button onClick={exportExcel} className="gantt-action-btn export-btn" title="Export to Excel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Export Excel</span>
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="gantt-action-btn import-btn" title="Import from Excel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Import Excel</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) importExcel(e.target.files[0]); }} />
          <button onClick={() => { if (confirm("Reset all tasks and links?")) { resetMut.mutate(); setCurrentProjectId(null); setCurrentProjectName(""); setSelectedTaskId(null); } }} className="gantt-action-btn reset-btn" title="Reset all data">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span>Reset</span>
          </button>
          <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />
          {/* Save — quick-save existing, or prompt if new. Green = primary save action */}
          <button
            onClick={handleQuickSave}
            className="gantt-action-btn gantt-save-btn"
            title={currentProjectId ? `Update "${currentProjectName}"` : "Save project"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>{currentProjectId ? "Save" : "Save"}</span>
          </button>
          {/* Save As — always create new. Amber = new/copy */}
          <button
            onClick={() => { setSaveModal(true); setIsSaveAs(true); setProjectName(currentProjectName ? currentProjectName + " Copy" : ""); }}
            className="gantt-action-btn gantt-saveas-btn"
            title="Save as new project"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/><line x1="16" y1="8" x2="16" y2="12"/><line x1="14" y1="10" x2="18" y2="10"/></svg>
            <span>Save As</span>
          </button>
          {/* Open — load saved project. Blue = load/open action */}
          <button
            onClick={() => setLoadModal(true)}
            className="gantt-action-btn gantt-open-btn"
            title="Open saved project"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="10 13 7 10 10 7"/></svg>
            <span>Open</span>
          </button>
        </div>
      </header>

      {/* Banner */}
      {banner && <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />}

      {/* KPI Cards */}
      <div className="gantt-page-wrap" style={{ padding: "16px 24px 0", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div className="gantt-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
          <KpiCard label="Total Tasks" value={kpi.totalTasks} icon="📋" color="#005BAC" />
          <KpiCard label="Completed" value={kpi.completed} icon="✅" color="#1F9D55" />
          <KpiCard label="In Progress" value={kpi.inProgress} icon="🔄" color="#F59E0B" />
          <KpiCard label="Overdue" value={kpi.overdue} icon="⚠️" color="#DC2626" />
          <KpiCard label="Completion" value={`${kpi.completionRate}%`} icon="📊" color="#7C3AED" />
          <KpiCard label="Avg Duration" value={`${kpi.avgDuration}d`} icon="⏱️" color="#0EA5E9" />
        </div>
      </div>

      {/* Tab Bar */}
      <div className="gantt-page-wrap" style={{ padding: "16px 24px 0", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: "2px", background: "#E2E8F0", padding: "4px", borderRadius: "8px" }}>
          {(["gantt", "tasks", "resources"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className="gantt-tab-btn" style={{ flex: 1, padding: "8px 16px", border: "none", borderRadius: "6px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", cursor: "pointer", transition: "all .2s", background: activeTab === tab ? "#005BAC" : "transparent", color: activeTab === tab ? "#fff" : "#5A6B7D", boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>
              <span className="tab-emoji">{tab === "gantt" ? "📅" : tab === "tasks" ? "📝" : "👥"}</span>{" "}
              <span className="tab-label">{tab === "gantt" ? "Gantt Chart" : tab === "tasks" ? "Task List" : "Resources"}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="gantt-page-wrap" style={{ flex: 1, padding: "16px 24px 24px", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {activeTab === "gantt" && (
          <div>
            {/* Hierarchy toolbar — right above the chart */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "0 2px" }}>
              <span style={{ fontSize: 11, color: "#8BA3B8", fontWeight: 600, marginRight: "auto" }}>
                {selectedTaskId ? tasksQuery.data?.find((t: any) => t.id === selectedTaskId)?.text : "Click a task to select"}
              </span>
              <button
                onClick={handleOutdent}
                disabled={!selectedTaskId}
                className="gantt-action-btn gantt-outdent-btn"
                title={selectedTaskId ? "Outdent selected task" : "Select a task first"}
                style={{ padding: "5px 10px", fontSize: 11 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
                <span>Outdent</span>
              </button>
              <button
                onClick={handleIndent}
                disabled={!selectedTaskId}
                className="gantt-action-btn gantt-indent-btn"
                title={selectedTaskId ? "Indent selected task" : "Select a task first"}
                style={{ padding: "5px 10px", fontSize: 11 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
                <span>Indent</span>
              </button>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)", border: "1px solid #D6DFE8", overflow: "hidden" }}>
              <NativeGanttChart
                tasks={(tasksQuery.data || []) as GanttTask[]}
                selectedTaskId={selectedTaskId}
                onSelectTask={setSelectedTaskId}
              />
            </div>
          </div>
        )}

        {activeTab === "tasks" && <TaskListTab tasks={tasksQuery.data || []} saveTask={saveTaskMut} deleteTask={deleteTaskMut} setBanner={setBanner} />}

        {activeTab === "resources" && <ResourcesTab tasks={tasksQuery.data || []} />}
      </div>

      {/* ─── Save Project Modal ─── */}
      {saveModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget && !saveProjectMut.isPending) setSaveModal(false); }}>
          <div className="gantt-modal" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.2)", width: "100%", maxWidth: 440, padding: "24px 28px", fontFamily: "Inter, sans-serif", position: "relative", overflow: "hidden" }}>
            {/* Save progress overlay */}
            {saveProjectMut.isPending && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.85)", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 12 }}>
                <Spinner size={36} color="#1F9D55" />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#16324F" }}>Saving project...</span>
                <span style={{ fontSize: 11, color: "#94A3B8" }}>Please wait</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#16324F" }}>{isSaveAs ? "Save As New Project" : "Save Project"}</h3>
              <button onClick={() => { if (!saveProjectMut.isPending) setSaveModal(false); }} disabled={saveProjectMut.isPending} style={{ background: "none", border: "none", fontSize: 20, color: saveProjectMut.isPending ? "#D1D5DB" : "#94A3B8", cursor: saveProjectMut.isPending ? "not-allowed" : "pointer", lineHeight: 1, padding: 0 }}>&times;</button>
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#5A6B7D" }}>Save the current Gantt chart as a named project you can reopen later.</p>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Project Name *</label>
            <input
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && projectName.trim() && !saveProjectMut.isPending) handleSaveProject(); }}
              placeholder="e.g., Q2 Maintenance Plan"
              disabled={saveProjectMut.isPending}
              style={{ width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid #D6DFE8", borderRadius: 6, fontFamily: "Inter, sans-serif", boxSizing: "border-box", marginBottom: 4, opacity: saveProjectMut.isPending ? 0.5 : 1 }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => { if (!saveProjectMut.isPending) setSaveModal(false); }} disabled={saveProjectMut.isPending} style={{ padding: "8px 18px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: saveProjectMut.isPending ? "#F8FAFC" : "#F1F5F9", color: saveProjectMut.isPending ? "#B0B8C4" : "#475569", border: "1px solid #D6DFE8", borderRadius: 6, cursor: saveProjectMut.isPending ? "not-allowed" : "pointer" }}>Cancel</button>
              <button
                onClick={handleSaveProject}
                disabled={!projectName.trim() || saveProjectMut.isPending}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 22px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: projectName.trim() && !saveProjectMut.isPending ? "#1F9D55" : "#94A3B8", color: "#fff", border: "none", borderRadius: 6, cursor: projectName.trim() && !saveProjectMut.isPending ? "pointer" : "not-allowed", transition: "all .15s" }}
              >
                {saveProjectMut.isPending ? (
                  <>
                    <SpinnerInline color="#fff" />
                    Saving...
                  </>
                ) : "Save Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Open Project Modal ─── */}
      {loadModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget) setLoadModal(false); }}>
          <div className="gantt-modal" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.2)", width: "100%", maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", fontFamily: "Inter, sans-serif" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#16324F" }}>Open Saved Project</h3>
              <button onClick={() => { setLoadModal(false); setRenamingId(null); }} style={{ background: "none", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer", lineHeight: 1, padding: 0 }}>&times;</button>
            </div>
            <div style={{ padding: "16px 24px", flex: 1, overflow: "auto" }}>
              {projectsListData === undefined ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", gap: 12 }}>
                  <Spinner size={28} color="#005BAC" />
                  <span style={{ fontSize: 12, color: "#94A3B8" }}>Loading saved projects...</span>
                </div>
              ) : (!projectsList || projectsList.length === 0) ? (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#475569" }}>No saved projects yet</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#94A3B8" }}>Save a project to see it here.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {projectsList.map((p: any) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#FAFBFC", transition: "background .15s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#EFF6FF")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#FAFBFC")}
                    >
                      <div style={{ fontSize: 20, flexShrink: 0 }}>📁</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {renamingId === p.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && renameValue.trim()) { renameProjectMut.mutate({ id: p.id, name: renameValue.trim() }); setRenamingId(null); } if (e.key === "Escape") setRenamingId(null); }}
                            style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #005BAC", borderRadius: 4, fontFamily: "Inter, sans-serif", boxSizing: "border-box" }}
                          />
                        ) : (
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#2D3748", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        )}
                        <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>
                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ""}
                          {p.description ? " · " + p.description : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {renamingId === p.id ? (
                          <>
                            <button onClick={() => { if (renameValue.trim()) { renameProjectMut.mutate({ id: p.id, name: renameValue.trim() }); setRenamingId(null); } }} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "#1F9D55", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Save</button>
                            <button onClick={() => setRenamingId(null)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer" }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { if (!loadProjectMut.isPending) loadProjectMut.mutate({ id: p.id }); }}
                              disabled={loadProjectMut.isPending}
                              title="Load"
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "5px 12px", fontSize: 11, fontWeight: 600,
                                background: loadingProjectId === p.id ? "#93C5FD" : "#005BAC",
                                color: "#fff", border: "none", borderRadius: 4,
                                cursor: loadProjectMut.isPending ? "not-allowed" : "pointer",
                                transition: "all .2s", minWidth: 52, justifyContent: "center",
                              }}
                            >
                              {loadingProjectId === p.id ? (
                                <>
                                  <SpinnerInline color="#fff" />
                                  <span>Loading</span>
                                </>
                              ) : "Open"}
                            </button>
                            <button onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }} title="Rename" style={{ padding: "5px 8px", fontSize: 11, fontWeight: 600, background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", borderRadius: 4, cursor: "pointer" }}>✎</button>
                            <button onClick={() => { if (confirm(`Delete "${p.name}"?`)) deleteProjectMut.mutate({ id: p.id }); }} title="Delete" style={{ padding: "5px 8px", fontSize: 11, fontWeight: 600, background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 4, cursor: "pointer" }}>🗑</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #D6DFE8", padding: "16px 24px", textAlign: "right", fontSize: 11, color: "#5A6B7D" }}>
        Program Oversight Center &copy; 2026
      </footer>

      {/* AI Assistant */}
      <AIAssistant
        contextType="gantt"
        data={tasksQuery.data || []}
        title="Gantt AI"
      />

      {/* Styles */}
      <style>{`
        .gantt-action-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 12px; font-weight: 600; font-family: Inter, sans-serif; border: none; border-radius: 6px; cursor: pointer; transition: all .15s; white-space: nowrap; color: #fff; }
        .export-btn { background: #1F9D55; } .export-btn:hover { background: #15803D; }
        .import-btn { background: #005BAC; } .import-btn:hover { background: #004D99; }
        .reset-btn { background: #DC2626; } .reset-btn:hover { background: #B91C1C; }
        .gantt-save-btn { background: #1F9D55; } .gantt-save-btn:hover { background: #15803D; }
        .gantt-saveas-btn { background: #D97706; } .gantt-saveas-btn:hover { background: #B45309; }
        .gantt-open-btn { background: #2563EB; } .gantt-open-btn:hover { background: #1D4ED8; }
        .gantt-indent-btn { background: #7C3AED; } .gantt-indent-btn:hover:not(:disabled) { background: #6D28D9; }
        .gantt-indent-btn:disabled { background: #C4B5FD; cursor: not-allowed; }
        .gantt-outdent-btn { background: #0891B2; } .gantt-outdent-btn:hover:not(:disabled) { background: #0E7490; }
        .gantt-outdent-btn:disabled { background: #A5F3FC; cursor: not-allowed; }

        /* ─── Responsive header toolbar ─── */
        .gantt-header { display: flex; align-items: center; gap: 16px; flex-wrap: nowrap; }
        .gantt-header-buttons { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }

        @media (max-width: 768px) {
          .gantt-action-btn { padding: 6px 10px; font-size: 11px; }
          .gantt-header { flex-wrap: wrap; gap: 10px; padding: 10px 16px !important; }
          .gantt-header-buttons { margin-left: 0; justify-content: flex-start; width: 100%; gap: 6px; }
          .gantt-page-wrap { padding: 10px 12px !important; }
          .gantt-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; }
          .gantt-tab-btn { padding: 6px 10px !important; font-size: 11px !important; }
          .gantt-modal { max-width: 100% !important; padding: 16px 20px !important; }
          .gantt-chart-legend { gap: 10px !important; font-size: 10px !important; }
          .gantt-chart-legend-label { display: none !important; }
          .gantt-task-col { width: 160px !important; min-width: 160px !important; }
          .gantt-task-name { font-size: 10px !important; }
          .gantt-zoom-info { display: none !important; }
        }

        @media (max-width: 480px) {
          .gantt-action-btn span { display: none; }
          .gantt-action-btn { padding: 6px 8px; }
          .gantt-header { padding: 8px 12px !important; }
          .gantt-header-title { font-size: 13px !important; }
          .gantt-header-sub { font-size: 9px !important; }
          .gantt-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .gantt-tab-btn { padding: 5px 6px !important; font-size: 10px !important; }
          .gantt-tab-btn .tab-label { display: none; }
          .gantt-chart-legend { display: none !important; }
          .gantt-task-col { width: 130px !important; min-width: 130px !important; }
          .gantt-task-name { font-size: 9px !important; }
        }

        @keyframes ganttSpin { to { transform: rotate(360deg); } }
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

function TaskListTab({ tasks, saveTask, deleteTask, setBanner }: { tasks: any[]; saveTask: any; deleteTask: any; setBanner: (b: {type: "error" | "success" | "info"; message: string} | null) => void }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Filter out garbage rows
  const validTasks = tasks.filter((t: any) => t.text && t.text.trim() && t.text.trim() !== "-");

  /* Hierarchy tree */
  const taskTree = useMemo(() => buildTaskTree(validTasks), [validTasks]);
  const applyExpanded = useCallback((nodes: TaskNode[]): TaskNode[] => {
    return nodes.map(n => ({ ...n, isExpanded: !expandedIds.has(n.task.id), children: applyExpanded(n.children) }));
  }, [expandedIds]);
  const visibleTree = useMemo(() => applyExpanded(taskTree), [taskTree, applyExpanded]);
  const visibleFlat = useMemo(() => flattenVisible(visibleTree), [visibleTree]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  /* Parent candidates for dropdown */
  const parentCandidates = useMemo(() => {
    return validTasks.filter((t: any) => !editingId || t.id !== editingId);
  }, [validTasks, editingId]);

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

  /* Auto-calculate parent dates */
  const handleAutoCalc = useCallback(() => {
    if (!editingId) return;
    const task = validTasks.find((t: any) => t.id === editingId);
    if (!task) return;
    const updates = autoCalcParent(task, validTasks);
    if (updates) {
      setForm((prev: TaskForm) => ({
        ...prev,
        ...(updates.plannedStart !== undefined && { plannedStart: String(updates.plannedStart).slice(0, 10) }),
        ...(updates.plannedEnd !== undefined && { plannedEnd: String(updates.plannedEnd).slice(0, 10) }),
        ...(updates.progress !== undefined && { progress: updates.progress as number }),
      }));
    }
  }, [editingId, validTasks]);

  const submitForm = () => {
    if (!form.text.trim()) { setBanner({ type: "error", message: "Task Name is required." }); return; }
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
          <label style={labelStyle}>Parent Task</label>
          <select
            value={form.parent || ""}
            onChange={(e) => setForm({ ...form, parent: e.target.value ? parseInt(e.target.value) : 0 })}
            style={inputStyle}
          >
            <option value="">(Root — no parent)</option>
            {parentCandidates.map((t: any) => (
              <option key={t.id} value={t.id}>{t.text}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} style={inputStyle} placeholder="Notes..." />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={submitForm} style={{ padding: "8px 20px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#1F9D55", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Save</button>
        {editingId && (
          <button type="button" onClick={handleAutoCalc} title="Auto-calculate parent dates from child tasks" style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", borderRadius: 6, cursor: "pointer" }}>
            🔄 Auto-Calc from Children
          </button>
        )}
        <button type="button" onClick={() => { setEditingId(null); setShowAdd(false); }} style={{ padding: "8px 20px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #D6DFE8", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#16324F" }}>Task List</h3>
        <span style={{ fontSize: 12, color: "#8BA3B8" }}>{visibleFlat.length} visible / {validTasks.length} total</span>
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
            {visibleFlat.map(({ task: t, level, hasChildren }) => (
              <tr key={t.id} style={{ borderBottom: "1px solid #F1F5F9", background: hasChildren ? "#F8FAFC" : "transparent" }}>
                <td style={{ padding: "8px", paddingLeft: `${8 + level * 16}px`, color: "#2D3748", fontWeight: hasChildren ? 700 : 400, whiteSpace: "nowrap" }}>
                  <span className="flex items-center gap-1">
                    {hasChildren && (
                      <button type="button" onClick={() => toggleExpand(t.id)} className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded" style={{ fontSize: 10, lineHeight: 1 }}>
                        {expandedIds.has(t.id) ? "▸" : "▾"}
                      </button>
                    )}
                    {!hasChildren && <span className="w-4 flex-shrink-0" />}
                    <span>{t.text}</span>
                  </span>
                </td>
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
