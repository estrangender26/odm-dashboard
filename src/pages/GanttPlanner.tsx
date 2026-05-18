/* ═══════════════════════════════════════════════════════════════════
   GanttPlanner.tsx — Manila Water Gantt Chart Dashboard
   Architecture: strict hooks-first → callbacks → JSX
   No function definitions before hook declarations.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";

/* ─── Engine imports — pure logic extracted from component ─── */
import {
  GanttTask, GanttLink, parseDate, daysBetween, normProgress,
  DEP_TYPE_MAP, buildTaskTree, flattenVisible, deriveStatus,
} from "@/modules/gantt/engine/schedulingEngine";
import {
  applyDependency, autoSchedule, buildConnectors,
} from "@/modules/gantt/engine/dependencyEngine";
import {
  recalculateParentRollups, getChangedParents,
} from "@/modules/gantt/engine/rollupEngine";
import {
  exportTemplate, exportCSV, exportExcel, parseImportFile, parseImportRow,
} from "@/modules/gantt/engine/persistenceEngine";
import {
  buildHierarchyPayload, computeWbsLevel,
} from "@/modules/gantt/engine/hierarchyEngine";
import {
  calcKpi, statusColor as _statusColor, statusBadgeStyle, rowStatus, fmtMonth, fmtShortDate,
} from "@/modules/gantt/engine/uiUtilsEngine";

/* ═══════════════════════════════════════════════════════════════════
   TYPES (module-level, no hooks)
   ═══════════════════════════════════════════════════════════════════ */

interface TaskForm {
  text: string; owner: string;
  plannedStart: string; plannedEnd: string;
  actualStart: string; actualEnd: string;
  duration: number; progress: number;
  status: string; remarks: string;
  type: string; parent: number;
  /* Scheduling Dependencies */
  predecessorId: number;
  depType: string;
  lagDays: number;
}

interface KpiData {
  totalTasks: number; completed: number; inProgress: number;
  overdue: number; completionRate: number; avgDuration: number;
}

type ZoomLevel = "autofit" | "year" | "quarter" | "month" | "week" | "day";

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS (module-level, no hooks)
   ═══════════════════════════════════════════════════════════════════ */

const EMPTY_FORM: TaskForm = {
  text: "", owner: "", plannedStart: "", plannedEnd: "",
  actualStart: "", actualEnd: "", duration: 1, progress: 0,
  status: "", remarks: "", type: "task", parent: 0,
  predecessorId: 0, depType: "FS", lagDays: 0,
};

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  autofit: "Auto-fit", year: "Year", quarter: "Quarter",
  month: "Month", week: "Week", day: "Day",
};

const ZOOM_DAY_WIDTH: Record<Exclude<ZoomLevel, "autofit">, number> = {
  year: 0.5, quarter: 2, month: 5, week: 16, day: 48,
};

const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

/* ═══════════════════════════════════════════════════════════════════
   MODULE-LEVEL PURE HELPERS (no hooks, no React dependencies)
   ═══════════════════════════════════════════════════════════════════ */

function taskToForm(t: any, links?: any[]): TaskForm {
  // Find existing dependency where this task is the successor
  const existingDep = links?.find((l: any) => l.target === t.id || l.successorTaskId === t.id);
  const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
  return {
    text: t.text || "", owner: t.owner || "",
    plannedStart: t.plannedStart ? String(t.plannedStart).slice(0, 10) : "",
    plannedEnd: t.plannedEnd ? String(t.plannedEnd).slice(0, 10) : "",
    actualStart: t.startDate ? String(t.startDate).slice(0, 10) : "",
    actualEnd: t.endDate ? String(t.endDate).slice(0, 10) : "",
    duration: t.duration || 1, progress: normProgress(t.progress),
    status: rowStatus(t), remarks: t.remarks || "",
    type: t.type || "task", parent: t.parent || 0,
    predecessorId: existingDep?.source || existingDep?.predecessorTaskId || 0,
    depType: typeMap[existingDep?.type] || existingDep?.dependencyType || "FS",
    lagDays: existingDep?.lag || existingDep?.lagDays || 0,
  };
}

function depTypeName(type: string): string { return DEP_TYPE_MAP[type] || type; }

function statusBadge(status: string) {
  const s = statusBadgeStyle(status);
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>{status}</span>;
}

/* ═══════════════════════════════════════════════════════════════════
   SUB-COMPONENTS (module-level, self-contained, no TDZ risk)
   ═══════════════════════════════════════════════════════════════════ */

function Banner({ type, message, onDismiss }: { type: "error" | "success" | "info"; message: string; onDismiss?: () => void }) {
  const s: Record<string, string> = {
    error: "bg-red-50 border-red-200 text-red-800",
    success: "bg-green-50 border-green-200 text-green-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };
  return (
    <div className={`mb-3 px-4 py-3 border rounded-lg text-sm flex items-center gap-2 ${s[type]}`}>
      <span>{type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️"}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && <button onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>}
    </div>
  );
}

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

interface NativeGanttChartProps {
  tasks: GanttTask[];
  selectedTaskId: number | null;
  onSelectTask: (id: number | null) => void;
  selectedIds: Set<number>;
  toggleSelect: (id: number, ctrl: boolean, shift: boolean) => void;
  links: any[];
  onEditTask: (task: GanttTask) => void;
}

interface _TaskNode {
  task: GanttTask; level: number;
  children: _TaskNode[]; isExpanded: boolean; hasChildren: boolean;
}

function _buildTaskTree(tasks: GanttTask[]): _TaskNode[] {
  const taskMap = new Map<number, _TaskNode>();
  const roots: _TaskNode[] = [];
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
  function setLevels(nodes: _TaskNode[], level: number) {
    for (const n of nodes) { n.level = level; setLevels(n.children, level + 1); }
  }
  setLevels(roots, 0);
  return roots;
}

function _flattenVisible(nodes: _TaskNode[]): { task: GanttTask; level: number; hasChildren: boolean }[] {
  const result: { task: GanttTask; level: number; hasChildren: boolean }[] = [];
  function walk(ns: _TaskNode[]) {
    for (const n of ns) {
      result.push({ task: n.task, level: n.level, hasChildren: n.hasChildren });
      if (n.isExpanded && n.children.length > 0) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

function NativeGanttChart({ tasks, selectedTaskId, onSelectTask, selectedIds, toggleSelect, links: _links, onEditTask }: NativeGanttChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("autofit");
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const taskTree = useMemo(() => _buildTaskTree(tasks), [tasks]);
  const applyExpanded = useCallback((nodes: _TaskNode[]): _TaskNode[] => {
    return nodes.map(n => ({ ...n, isExpanded: !expandedIds.has(n.task.id), children: applyExpanded(n.children) }));
  }, [expandedIds]);
  const visibleTree = useMemo(() => applyExpanded(taskTree), [taskTree, applyExpanded]);
  const visibleFlat = useMemo(() => _flattenVisible(visibleTree), [visibleTree]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => { setContainerWidth(Math.max(300, Math.floor(el.clientWidth))); };
    measure();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(Math.max(300, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", measure); };
  }, []);

  const { projectStart, projectEnd, totalDays } = useMemo(() => {
    if (!tasks.length) {
      const ps = new Date(); const pe = new Date(ps.getTime() + 30 * 86400000);
      return { projectStart: ps, projectEnd: pe, totalDays: 30 };
    }
    let ps: Date | null = null; let pe: Date | null = null;
    const consider = (d: Date | null) => { if (!d) return; if (!ps || d < ps) ps = d; if (!pe || d > pe) pe = d; };
    for (const t of tasks) {
      consider(parseDate(t.plannedStart)); consider(parseDate(t.plannedEnd));
      consider(parseDate(t.startDate)); consider(parseDate(t.endDate));
    }
    if (!ps) ps = new Date(); if (!pe) pe = new Date(ps.getTime() + 30 * 86400000);
    ps = new Date(ps.getTime() - 5 * 86400000); pe = new Date(pe.getTime() + 10 * 86400000);
    return { projectStart: ps, projectEnd: pe, totalDays: Math.max(daysBetween(ps, pe), 30) };
  }, [tasks]);

  const dayWidth = useMemo(() => {
    if (zoomLevel === "autofit") return Math.max(0.3, (containerWidth - 40) / totalDays);
    return ZOOM_DAY_WIDTH[zoomLevel];
  }, [zoomLevel, containerWidth, totalDays]);

  const rows = useMemo(() => {
    return visibleFlat.map((v) => {
      const { task, level, hasChildren } = v;
      const pStart = parseDate(task.plannedStart);
      const pEnd = parseDate(task.plannedEnd);
      const aStart = parseDate(task.startDate);
      const aEnd = parseDate(task.endDate);
      const plannedLeft = pStart ? Math.max(0, daysBetween(projectStart, pStart)) * dayWidth : null;
      const plannedWidth = (pStart && pEnd && daysBetween(pStart, pEnd) > 0) ? daysBetween(pStart, pEnd) * dayWidth : null;

      let effAStart = aStart; let effAEnd = aEnd;
      const hasActualStart = !!aStart; const hasActualFinish = !!aEnd;
      const isAutoPopulated = hasActualStart && !hasActualFinish;
      if (isAutoPopulated) { effAEnd = pEnd && TODAY > pEnd ? TODAY : TODAY; }
      const actualLeft = effAStart ? Math.max(0, daysBetween(projectStart, effAStart)) * dayWidth : null;
      const actualWidth = (effAStart && effAEnd && daysBetween(effAStart, effAEnd) > 0)
        ? daysBetween(effAStart, effAEnd) * dayWidth
        : effAStart ? (task.duration || 1) * dayWidth : null;

      return {
        task, level, hasChildren, plannedLeft, plannedWidth, actualLeft, actualWidth,
        isDelayed: pEnd ? TODAY > pEnd && !hasActualFinish : false,
        isMilestone: task.type === "milestone", isAutoPopulated,
      };
    });
  }, [visibleFlat, projectStart, dayWidth]);

  const headerColumns = useMemo(() => {
    const cols: { label: string; left: number; width: number; subLabel?: string }[] = [];
    if (!projectStart) return cols;
    const ps = projectStart; const pe = projectEnd;
    if (zoomLevel === "day") {
      let cur = new Date(ps);
      while (cur <= pe) {
        const dayStart = new Date(cur); const nextDay = new Date(cur.getTime() + 86400000);
        const dayEnd = nextDay < pe ? nextDay : pe;
        const left = daysBetween(ps, dayStart) * dayWidth; const width = Math.max(1, daysBetween(dayStart, dayEnd) * dayWidth);
        const dayNum = dayStart.getDate(); const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dayStart.getMonth()];
        cols.push({ label: `${dayNum}`, subLabel: dayStart.getDay() === 0 || dayStart.getDay() === 6 ? "" : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dayStart.getDay()], left, width });
        cur = nextDay;
      }
    } else if (zoomLevel === "week") {
      let cur = new Date(ps); cur = new Date(cur.getTime() - cur.getDay() * 86400000);
      while (cur <= pe) {
        const weekStart = new Date(cur); const weekEnd = new Date(cur.getTime() + 7 * 86400000);
        const end = weekEnd < pe ? weekEnd : pe; const left = daysBetween(ps, weekStart) * dayWidth; const width = Math.max(1, daysBetween(weekStart, end) * dayWidth);
        cols.push({ label: `Week ${fmtShortDate(weekStart)}`, left, width }); cur = weekEnd;
      }
    } else if (zoomLevel === "month" || zoomLevel === "autofit") {
      let cur = new Date(ps.getFullYear(), ps.getMonth(), 1);
      while (cur <= pe) {
        const monthStart = new Date(cur); const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        const monthEnd = nextMonth < pe ? nextMonth : pe; const left = daysBetween(ps, monthStart) * dayWidth; const width = Math.max(1, daysBetween(monthStart, monthEnd) * dayWidth);
        cols.push({ label: fmtMonth(monthStart), left, width }); cur = nextMonth;
      }
    } else if (zoomLevel === "quarter") {
      let cur = new Date(ps.getFullYear(), Math.floor(ps.getMonth() / 3) * 3, 1);
      while (cur <= pe) {
        const qStart = new Date(cur); const nextQ = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
        const qEnd = nextQ < pe ? nextQ : pe; const left = daysBetween(ps, qStart) * dayWidth; const width = Math.max(1, daysBetween(qStart, qEnd) * dayWidth);
        const qNum = Math.floor(qStart.getMonth() / 3) + 1;
        cols.push({ label: `Q${qNum} ${qStart.getFullYear()}`, left, width }); cur = nextQ;
      }
    } else if (zoomLevel === "year") {
      let cur = new Date(ps.getFullYear(), 0, 1);
      while (cur <= pe) {
        const yStart = new Date(cur); const nextY = new Date(cur.getFullYear() + 1, 0, 1);
        const yEnd = nextY < pe ? nextY : pe; const left = daysBetween(ps, yStart) * dayWidth; const width = Math.max(1, daysBetween(yStart, yEnd) * dayWidth);
        cols.push({ label: String(yStart.getFullYear()), left, width }); cur = nextY;
      }
    }
    return cols;
  }, [projectStart, projectEnd, dayWidth, zoomLevel]);

  const chartWidth = totalDays * dayWidth;
  const rowHeight = 32;
  const headerHeight = zoomLevel === "day" ? 36 : 28;
  const chartHeight = Math.max(260, rows.length * rowHeight + headerHeight + 8);

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
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#FAFBFC", borderBottom: "1px solid #E2E8F0", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2, background: "#E2E8F0", borderRadius: 6, padding: 2 }}>
          <button onClick={() => { const order: ZoomLevel[] = ["year","quarter","month","week","day"]; if (zoomLevel === "autofit") { setZoomLevel("month"); return; } const idx = order.indexOf(zoomLevel); if (idx > 0) setZoomLevel(order[idx - 1]); }} title="Zoom out" style={{ padding: "4px 8px", fontSize: 13, fontWeight: 700, background: "#fff", border: "none", borderRadius: 4, cursor: "pointer", color: "#475569", lineHeight: 1 }}>−</button>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#475569", padding: "0 4px", whiteSpace: "nowrap", minWidth: 44, textAlign: "center" }}>{ZOOM_LABELS[zoomLevel]}</span>
          <button onClick={() => { const order: ZoomLevel[] = ["year","quarter","month","week","day"]; if (zoomLevel === "autofit") { setZoomLevel("month"); return; } const idx = order.indexOf(zoomLevel); if (idx < order.length - 1) setZoomLevel(order[idx + 1]); }} title="Zoom in" style={{ padding: "4px 8px", fontSize: 13, fontWeight: 700, background: "#fff", border: "none", borderRadius: 4, cursor: "pointer", color: "#475569", lineHeight: 1 }}>+</button>
        </div>
        {(["autofit","year","quarter","month","week","day"] as ZoomLevel[]).map((zl) => (
          <button key={zl} onClick={() => setZoomLevel(zl)} style={{ padding: "4px 10px", fontSize: 10, fontWeight: 600, fontFamily: "Inter, sans-serif", background: zoomLevel === zl ? "#005BAC" : "#fff", color: zoomLevel === zl ? "#fff" : "#5A6B7D", border: `1px solid ${zoomLevel === zl ? "#005BAC" : "#D6DFE8"}`, borderRadius: 5, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap" }}>{ZOOM_LABELS[zl]}</button>
        ))}
        <span className="gantt-zoom-info" style={{ marginLeft: "auto", fontSize: 10, color: "#8BA3B8", whiteSpace: "nowrap" }}>{rows.length} tasks · {Math.round(dayWidth * 10) / 10}px/day · {Math.round(chartWidth)}px wide</span>
      </div>

      <div className="gantt-chart-legend" style={{ display: "flex", gap: 10, padding: "4px 10px", background: "#FAFBFC", borderBottom: "1px solid #E2E8F0", fontSize: 10, fontFamily: "Inter, sans-serif", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#93C5FD", borderRadius: 2, border: "1px solid #60A5FA" }} /><span className="gantt-chart-legend-label">Planned</span></span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#86EFAC", borderRadius: 2, border: "1px solid #4ADE80" }} /><span className="gantt-chart-legend-label">Actual (on time)</span></span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 18, height: 8, background: "#FCA5A5", borderRadius: 2, border: "1px solid #F87171" }} /><span className="gantt-chart-legend-label">Actual (delayed)</span></span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, background: "#7C3AED", transform: "rotate(45deg)", borderRadius: 1 }} /><span className="gantt-chart-legend-label">Milestone</span></span>
      </div>

      <div style={{ display: "flex", height: chartHeight, fontFamily: "Inter, sans-serif", fontSize: 12 }}>
        <div className="gantt-task-col" style={{ width: 200, minWidth: 200, borderRight: "1px solid #E2E8F0", background: "#FAFBFC", display: "flex", flexDirection: "column", zIndex: 2 }}>
          <div style={{ height: headerHeight, borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", padding: "0 10px", fontWeight: 700, color: "#475569", fontSize: 11, background: "#F1F5F9" }}>Task Name</div>
          {rows.map(({ task, level, hasChildren }) => {
            const isSelected = selectedTaskId === task.id || selectedIds.has(task.id);
            const rowBg = isSelected ? "#DBEAFE" : hasChildren ? "#E2E8F0" : level > 0 ? "#F8FAFC" : "transparent";
            return (
              <div key={task.id} onClick={(e) => { if ((e.target as HTMLElement).tagName !== "BUTTON") toggleSelect(task.id, e.ctrlKey || e.metaKey, e.shiftKey); }} onDoubleClick={() => onEditTask(task)}
                style={{ height: rowHeight, borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "flex-start", padding: "3px 6px", paddingLeft: `${8 + level * 36}px`, overflow: "hidden", background: rowBg, cursor: "pointer", transition: "background .1s", borderLeft: isSelected ? "3px solid #005BAC" : "3px solid transparent" }}>
                <span className="flex items-start gap-0.5 min-w-0 flex-1" style={{ overflow: "hidden", lineHeight: 1.35 }}>
                  {hasChildren && <button type="button" onClick={() => toggleExpand(task.id)} className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded" style={{ fontSize: 9, lineHeight: 1, padding: 0, marginTop: 1 }}>{expandedIds.has(task.id) ? "▸" : "▾"}</button>}
                  {level > 0 && !hasChildren && <span style={{ fontSize: 10, color: "#94A3B8", marginRight: 2, marginTop: 1, flexShrink: 0, fontFamily: "monospace" }}>└─</span>}
                  {level > 0 && hasChildren && <span style={{ fontSize: 10, color: "#64748B", marginRight: 2, marginTop: 1, flexShrink: 0, fontFamily: "monospace" }}>├─</span>}
                  {level === 0 && !hasChildren && <span className="w-3.5 flex-shrink-0" />}
                  {level > 0 && <span style={{ fontSize: 7, color: "#fff", background: "#005BAC", borderRadius: 3, padding: "0 3px", marginRight: 3, marginTop: 2, flexShrink: 0, fontWeight: 700, lineHeight: 1.4 }}>L{level}</span>}
                  <span className="gantt-task-name" style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", color: hasChildren ? "#1E3A5F" : "#2D3748", fontWeight: hasChildren ? 700 : level > 0 ? 500 : 400, fontSize: hasChildren ? 12 : 11, marginLeft: 2, lineHeight: 1.35, wordBreak: "break-word" }} title={task.text}>{task.text || "Untitled"}</span>
                </span>
              </div>
            );
          })}
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <div ref={timelineRef} style={{ width: chartWidth, position: "relative", transition: "width 0.25s ease-out" }}>
            <div style={{ height: headerHeight, borderBottom: "1px solid #E2E8F0", display: "flex", position: "relative", background: "#F1F5F9" }}>
              {headerColumns.map((col, i) => (
                <div key={i} style={{ position: "absolute", left: col.left, width: col.width, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRight: "1px solid #E2E8F0", fontWeight: 600, color: "#475569", fontSize: zoomLevel === "day" ? 9 : 10, whiteSpace: "nowrap", overflow: "hidden", transition: "left 0.25s ease-out, width 0.25s ease-out" }} title={col.label}>
                  <span>{col.label}</span>{col.subLabel && <span style={{ fontSize: 8, color: "#8BA3B8", fontWeight: 400 }}>{col.subLabel}</span>}
                </div>
              ))}
            </div>
            {headerColumns.map((col, i) => (
              <div key={`grid-${i}`} style={{ position: "absolute", left: col.left, top: headerHeight, width: 1, height: rows.length * rowHeight, background: "#F1F5F9", zIndex: 0, transition: "left 0.25s ease-out" }} />
            ))}
            {(() => {
              const today = new Date();
              if (today < projectStart || today > projectEnd) return null;
              const todayLeft = daysBetween(projectStart, today) * dayWidth;
              return <div style={{ position: "absolute", left: todayLeft, top: 0, width: 2, height: chartHeight - 20, background: "#DC2626", zIndex: 5, opacity: 0.7, pointerEvents: "none", transition: "left 0.25s ease-out" }}><span style={{ position: "absolute", top: 2, left: 4, fontSize: 8, fontWeight: 700, color: "#DC2626", background: "rgba(255,255,255,0.9)", padding: "1px 3px", borderRadius: 2 }}>TODAY</span></div>;
            })()}
            {(() => {
              if (!_links || _links.length === 0) return null;
              const posMap = new Map<number, { left: number; width: number; row: number }>();
              rows.forEach((r, i) => { const barLeft = r.plannedLeft ?? r.actualLeft ?? 0; const barW = r.plannedWidth ?? r.actualWidth ?? 80; posMap.set(r.task.id, { left: barLeft, width: barW, row: i }); });
              const conns = buildConnectors(_links.map((l: any) => ({ id: l.id, source: l.source, target: l.target, type: l.type, lag: l.lag || 0 })), posMap, headerHeight, rowHeight);
              if (conns.length === 0) return null;
              return <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 10, overflow: "visible" }}>{conns.map((c, i) => <g key={i}><line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#94A3B8" strokeWidth={1.5} strokeDasharray="4,3" fill="none" /><polygon points={`${c.x2-5},${c.y2-4} ${c.x2+1},${c.y2} ${c.x2-5},${c.y2+4}`} fill="#94A3B8" /></g>)}</svg>;
            })()}
            {rows.map((row, idx) => {
              const { task, plannedLeft, plannedWidth, actualLeft, actualWidth, isDelayed, isMilestone, isAutoPopulated } = row;
              const top = headerHeight + idx * rowHeight;
              const isSelected = selectedTaskId === task.id || selectedIds.has(task.id);
              return (
                <div key={task.id} onClick={(e) => toggleSelect(task.id, e.ctrlKey || e.metaKey, e.shiftKey)} onDoubleClick={() => onEditTask(task)}
                  style={{ position: "absolute", left: 0, top, width: "100%", height: rowHeight, background: isSelected ? "rgba(219,234,254,0.5)" : "transparent", cursor: "pointer", zIndex: 0 }}>
                  {isMilestone ? (
                    <div style={{ position: "absolute", left: (actualLeft ?? plannedLeft ?? 0) - 6, top: rowHeight / 2 - 6, zIndex: 2, transition: "left 0.25s ease-out" }}><div style={{ width: 12, height: 12, background: "#7C3AED", transform: "rotate(45deg)", borderRadius: 2, boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} /></div>
                  ) : (
                    <>
                      {plannedLeft !== null && plannedWidth !== null && (
                        <div style={{ position: "absolute", left: plannedLeft, top: 4, height: 14, zIndex: 1, transition: "left 0.25s ease-out, width 0.25s ease-out" }}>
                          <div style={{ width: Math.max(plannedWidth, 2), height: 14, background: "rgba(147,197,253,0.35)", border: "1px dashed #60A5FA", borderRadius: 2, position: "relative" }}>
                            {plannedWidth > 40 && <span style={{ position: "absolute", left: 3, top: "50%", transform: "translateY(-50%)", fontSize: 7, fontWeight: 600, color: "#3B82F6", whiteSpace: "nowrap" }}>Planned</span>}
                          </div>
                        </div>
                      )}
                      {actualLeft !== null && actualWidth !== null ? (
                        <div style={{ position: "absolute", left: actualLeft, top: 18, height: 14, zIndex: 2, transition: "left 0.25s ease-out, width 0.25s ease-out" }}>
                          <div style={{ width: Math.max(actualWidth, 2), height: 14, background: isDelayed ? "rgba(252,165,165,0.5)" : isAutoPopulated ? "repeating-linear-gradient(90deg, rgba(245,158,11,0.25) 0px, rgba(245,158,11,0.25) 4px, rgba(251,191,36,0.4) 4px, rgba(251,191,36,0.4) 8px)" : "rgba(134,239,172,0.5)", border: `1px solid ${isDelayed ? "#F87171" : isAutoPopulated ? "#F59E0B" : "#4ADE80"}`, borderRadius: 2, position: "relative" }}>
                            {actualWidth > 40 && <span style={{ position: "absolute", left: 3, top: "50%", transform: "translateY(-50%)", fontSize: 7, fontWeight: 600, color: isDelayed ? "#DC2626" : isAutoPopulated ? "#B45309" : "#15803D", whiteSpace: "nowrap" }}>{isDelayed ? "Delayed" : isAutoPopulated ? "In Progress" : `${normProgress(task.progress)}%`}</span>}
                          </div>
                        </div>
                      ) : plannedLeft !== null && <div style={{ position: "absolute", left: plannedLeft, top: 18, zIndex: 1, transition: "left 0.25s ease-out" }}><span style={{ fontSize: 7, color: "#CBD5E1", fontStyle: "italic" }}>No actual yet</span></div>}
                    </>
                  )}
                  {(!isMilestone) && plannedLeft === null && actualLeft === null && <div style={{ position: "absolute", left: 8, top: 14, zIndex: 5 }}><span style={{ fontSize: 8, color: "#94A3B8", fontStyle: "italic" }}>No dates</span></div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskListTab({ tasks, deleteTask, setBanner, onEditTask, onAddTask }: { tasks: any[]; deleteTask: any; setBanner: (b: {type: "error" | "success" | "info"; message: string} | null) => void; onEditTask: (task: any) => void; onAddTask: () => void }) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const validTasks = tasks.filter((t: any) => t.text && t.text.trim() && t.text.trim() !== "-");
  const taskTree = useMemo(() => buildTaskTree(validTasks), [validTasks]);
  const applyExpanded = useCallback((nodes: any[]): any[] => {
    return nodes.map((n: any) => ({ ...n, isExpanded: !expandedIds.has(n.task.id), children: applyExpanded(n.children) }));
  }, [expandedIds]);
  const visibleTree = useMemo(() => applyExpanded(taskTree), [taskTree, applyExpanded]);
  const visibleFlat = useMemo(() => flattenVisible(visibleTree), [visibleTree]);
  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onAddTask} style={{ padding: "8px 14px", background: "#1F9D55", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Task
        </button>
      </div>
      <div style={{ display: "table", width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "Inter, sans-serif" }}>
        <div style={{ display: "table-row", fontWeight: 700, color: "#1F2937", background: "#E2E8F0", fontSize: 9, letterSpacing: "0.3px", textTransform: "uppercase" }}>
          <div style={{ display: "table-cell", padding: "6px 8px", borderBottom: "2px solid #CBD5E1" }}>Task</div>
          <div style={{ display: "table-cell", padding: "6px 8px", borderBottom: "2px solid #CBD5E1" }}>Owner</div>
          <div style={{ display: "table-cell", padding: "6px 8px", borderBottom: "2px solid #CBD5E1" }}>Planned</div>
          <div style={{ display: "table-cell", padding: "6px 8px", borderBottom: "2px solid #CBD5E1" }}>Actual</div>
          <div style={{ display: "table-cell", padding: "6px 8px", borderBottom: "2px solid #CBD5E1" }}>Duration</div>
          <div style={{ display: "table-cell", padding: "6px 8px", borderBottom: "2px solid #CBD5E1" }}>Progress</div>
          <div style={{ display: "table-cell", padding: "6px 8px", borderBottom: "2px solid #CBD5E1" }}>Status</div>
          <div style={{ display: "table-cell", padding: "6px 8px", borderBottom: "2px solid #CBD5E1" }}>Actions</div>
        </div>
        {visibleFlat.map(({ task, level, hasChildren }: any) => {
          const canExpand = hasChildren;
          return (
            <div key={task.id} style={{ display: "table-row", cursor: "pointer" }} onDoubleClick={() => onEditTask(task)}>
              <div style={{ display: "table-cell", padding: "4px 8px", borderBottom: "1px solid #E2E8F0", paddingLeft: `${10 + level * 16}px` }}>
                {canExpand && <button onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, color: "#64748B", padding: "0 4px 0 0", lineHeight: 1 }}>{expandedIds.has(task.id) ? "▼" : "▶"}</button>}
                <span style={{ fontWeight: 600, color: "#1E293B" }}>{task.text}</span>
              </div>
              <div style={{ display: "table-cell", padding: "4px 8px", borderBottom: "1px solid #E2E8F0", color: "#4B5563" }}>{task.owner || "—"}</div>
              <div style={{ display: "table-cell", padding: "4px 8px", borderBottom: "1px solid #E2E8F0", color: "#6B7280" }}>{task.plannedStart?.slice(5) || "—"} → {task.plannedEnd?.slice(5) || "—"}</div>
              <div style={{ display: "table-cell", padding: "4px 8px", borderBottom: "1px solid #E2E8F0", color: "#6B7280" }}>{task.startDate?.slice(5) || "—"} → {task.endDate?.slice(5) || "—"}</div>
              <div style={{ display: "table-cell", padding: "4px 8px", borderBottom: "1px solid #E2E8F0", color: "#4B5563" }}>{task.duration}</div>
              <div style={{ display: "table-cell", padding: "4px 8px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ width: "100%", height: 4, background: "#E2E8F0", borderRadius: 2 }}><div style={{ width: `${Math.min(100, normProgress(task.progress))}%`, height: 4, background: _statusColor(rowStatus(task)), borderRadius: 2 }} /></div>
                <span style={{ fontSize: 8, color: "#6B7280" }}>{normProgress(task.progress)}%</span>
              </div>
              <div style={{ display: "table-cell", padding: "4px 8px", borderBottom: "1px solid #E2E8F0" }}><span style={{ color: _statusColor(rowStatus(task)), fontWeight: 600, fontSize: 9 }}>{rowStatus(task)}</span></div>
              <div style={{ display: "table-cell", padding: "4px 8px", borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>
                <button onClick={(e) => { e.stopPropagation(); onEditTask(task); }} style={{ fontSize: 9, padding: "2px 6px", background: "#EFF6FF", color: "#005BAC", border: "none", borderRadius: 4, cursor: "pointer", marginRight: 4 }}>Edit</button>
                <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${task.text}"?`)) deleteTask.mutate({ id: task.id }); }} style={{ fontSize: 9, padding: "2px 6px", background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 4, cursor: "pointer" }}>Del</button>
              </div>
            </div>
          );
        })}
      </div>
      {visibleFlat.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF" }}>No tasks found.</div>}
    </div>
  );
}

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
          <div key={o.owner} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", background: "#FAFBFC", borderRadius: 6, border: "1px solid #E2E8F0" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#005BAC15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#005BAC" }}>{o.owner.charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#2D3748" }}>{o.owner}</div>
              <div style={{ fontSize: 11, color: "#8BA3B8" }}>{o.tasks.length} tasks · {o.totalDays}d total · {o.completed}/{o.tasks.length} done</div>
            </div>
            <div style={{ width: 80, height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${o.tasks.length > 0 ? (o.completed / o.tasks.length) * 100 : 0}%`, height: "100%", background: "#1F9D55", borderRadius: 3 }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN GANTT PLANNER COMPONENT
   Strict ordering: useState → useRef → tRPC → useEffect → useCallback → plain functions → JSX
   ═══════════════════════════════════════════════════════════════════ */

export default function GanttPlanner() {
  /* ═══════ SECTION 1: ALL useState hooks (FIRST) ═══════ */
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const [activeTab, setActiveTab] = useState<"gantt" | "tasks" | "resources">("gantt");
  const [kpi, setKpi] = useState<KpiData>({ totalTasks: 0, completed: 0, inProgress: 0, overdue: 0, completionRate: 0, avgDuration: 0 });
  const [saveModal, setSaveModal] = useState(false);
  const [saveMode, setSaveMode] = useState<"new" | "as">("new");
  const [loadModal, setLoadModal] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingProjectId, setLoadingProjectId] = useState<number | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string>("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [importSourceName, setImportSourceName] = useState<string>("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkType, setLinkType] = useState("0");
  const [linkLag, setLinkLag] = useState(0);
  const [depEditorOpen, setDepEditorOpen] = useState(false);
  const [depEditorTask, setDepEditorTask] = useState<number | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);

  /* ═══════ SECTION 2: ALL useRef hooks (SECOND) ═══════ */
  const lastSavedJsonRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const lastSelectedRef = useRef<number | null>(null);

  /* ═══════ SECTION 3: ALL tRPC hooks (THIRD) ═══════ */
  const utils = trpc.useUtils();
  const tasksQuery = trpc.gantt.tasks.useQuery();
  const linksQuery = trpc.gantt.links.useQuery();
  const { refetch: refetchTasks } = tasksQuery;

  const saveTaskMut = trpc.gantt.saveTask.useMutation({
    onSuccess: () => utils.gantt.tasks.invalidate(),
    onError: (e) => setBanner({ type: "error", message: "Save task failed: " + e.message }),
  });
  const deleteTaskMut = trpc.gantt.deleteTask.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });
  const saveLinkMut = trpc.gantt.saveLink.useMutation({
    onSuccess: () => utils.gantt.links.invalidate(),
    onError: (e: any) => console.error("[saveLink] FAILED:", e.message, e.data),
  });
  const deleteLinkMut = trpc.gantt.deleteLink.useMutation({
    onSuccess: () => utils.gantt.links.invalidate(),
    onError: (e: any) => console.error("[deleteLink] FAILED:", e.message),
  });
  const saveLinksBatchMut = trpc.gantt.saveLinksBatch.useMutation({
    onSuccess: () => utils.gantt.links.invalidate(),
    onError: (e: any) => console.error("[saveLinksBatch] FAILED:", e.message),
  });
  const resetMut = trpc.gantt.resetAll.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });
  const seedMut = trpc.gantt.seed.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });

  /* Project save/load hooks */
  const { data: projectsListData } = trpc.ganttProjects.list.useQuery(undefined, { retry: 1 });
  const projectsList = projectsListData?.projects || [];
  const saveProjectMut = trpc.ganttProjects.save.useMutation({
    onSuccess: () => { utils.ganttProjects.list.invalidate(); setSaveModal(false); setProjectName(""); setHasUnsavedChanges(false); setBanner({ type: "success", message: "Project saved." }); },
    onError: (e) => setBanner({ type: "error", message: "Save failed: " + e.message }),
  });
  const loadProjectMut = trpc.ganttProjects.get.useMutation({
    onMutate: ({ id }: { id: number }) => { setLoadingProjectId(id); },
    onSettled: () => { setLoadingProjectId(null); },
    onSuccess: async (data) => {
      try {
        const parsed = JSON.parse(data.tasksData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          await resetMut.mutateAsync(undefined);
          for (const [idx, t] of parsed.entries()) {
            const wbsLevel = computeWbsLevel(t.id ?? 0, parsed, t.parent ?? 0);
            await saveTaskMut.mutateAsync({
              text: t.text || "", owner: t.owner || null,
              start_date: t.startDate || t.start_date || null,
              end_date: t.endDate || t.end_date || null,
              planned_start: t.plannedStart || t.planned_start || t.plannedStartDate || null,
              planned_end: t.plannedEnd || t.planned_end || t.plannedEndDate || null,
              duration: t.duration || 1, progress: normProgress(t.progress),
              wbs_level: wbsLevel,
              parent: t.parent || 0, type: t.type || "task",
              status: t.status || null, remarks: t.remarks || t.notes || null,
              category: t.category || null, open: t.open ?? 1, sortorder: t.sortorder ?? idx,
            });
          }
          // Load dependencies from linksData into gantt_dependencies table
          if (data.linksData) {
            try {
              const linksParsed = JSON.parse(data.linksData);
              if (Array.isArray(linksParsed) && linksParsed.length > 0) {
                const depsToSave = linksParsed.map((l: any) => ({
                  source: l.source || l.predecessorTaskId,
                  target: l.target || l.successorTaskId,
                  type: l.type || l.dependencyType || "0",
                  lag: l.lag || l.lagDays || 0,
                  projectId: data.id,
                })).filter((d: any) => d.source && d.target);
                if (depsToSave.length > 0) {
                  await saveLinksBatchMut.mutateAsync(depsToSave);
                }
              }
            } catch { /* ignore link parse errors */ }
          }
          await utils.gantt.tasks.invalidate();
          await utils.gantt.links.invalidate();
          setBanner({ type: "success", message: `Loaded "${data.name}" — ${parsed.length} task(s).` });
          setCurrentProjectId(data.id);
          setCurrentProjectName(data.name);
          setHasUnsavedChanges(false);
          setImportSourceName("");
          lastSavedJsonRef.current = JSON.stringify(parsed);
        } else {
          setBanner({ type: "info", message: "Project is empty — no tasks to load." });
          setCurrentProjectId(data.id);
          setCurrentProjectName(data.name);
          setHasUnsavedChanges(false);
          setImportSourceName("");
          lastSavedJsonRef.current = "";
        }
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

  /* ═══════ SECTION 4: ALL useEffect hooks (FOURTH) ═══════ */

  /* Restore current project from localStorage */
  useEffect(() => {
    const saved = localStorage.getItem("gantt_current_project");
    if (saved && !currentProjectId) {
      try {
        const p = JSON.parse(saved);
        if (p.id && p.name) { setCurrentProjectId(p.id); setCurrentProjectName(p.name); }
      } catch { /* ignore */ }
    }
  }, []);

  /* Persist current project to localStorage */
  useEffect(() => {
    if (currentProjectId && currentProjectName) {
      localStorage.setItem("gantt_current_project", JSON.stringify({ id: currentProjectId, name: currentProjectName }));
    }
  }, [currentProjectId, currentProjectName]);

  /* Warn before leaving with unsaved changes */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = "You have unsaved changes. Are you sure you want to leave?"; return e.returnValue; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  /* Detect unsaved changes */
  useEffect(() => {
    if (!tasksQuery.data) return;
    const currentJson = JSON.stringify(tasksQuery.data);
    if (lastSavedJsonRef.current && lastSavedJsonRef.current !== currentJson) { setHasUnsavedChanges(true); }
    else if (!lastSavedJsonRef.current && tasksQuery.data.length > 0) { setHasUnsavedChanges(true); }
    else { setHasUnsavedChanges(false); }
  }, [tasksQuery.data]);

  /* KPI update */
  useEffect(() => {
    if (!tasksQuery.data) return;
    setKpi(calcKpi(tasksQuery.data));
  }, [tasksQuery.data]);

  /* Export menu click-outside */
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExportMenu]);

  /* ═══════ SECTION 5: ALL useCallback definitions (FIFTH) ═══════
     Every callback that references hooks must be defined AFTER those hooks. */

  /* Auto-schedule successors after dependency change */
  const runAutoSchedule = useCallback((changedTaskId?: number) => {
    const allTasks = tasksQuery.data || [];
    const allLinks = linksQuery.data || [];
    if (allLinks.length === 0) return;
    const linkObjs = allLinks.map((l: any) => ({ id: l.id, source: l.source, target: l.target, type: l.type, lag: l.lag || 0 }));
    const updates = autoSchedule(allTasks, linkObjs, changedTaskId);
    if (updates.size === 0) return;
    let updated = 0;
    updates.forEach((dates, taskId) => {
      const task = allTasks.find((t: any) => t.id === taskId);
      if (!task) return;
      const payload: any = {
        id: taskId, text: task.text, owner: task.owner || null,
        planned_start: dates.plannedStart, planned_end: dates.plannedEnd,
        start_date: task.startDate || null, end_date: task.endDate || null,
        duration: task.duration || 1, progress: normProgress(task.progress), status: rowStatus(task),
        remarks: task.remarks || null, type: task.type || "task", parent: task.parent || 0,
      };
      saveTaskMut.mutate(payload);
      updated++;
    });
    if (updated > 0) {
      setBanner({ type: "info", message: `Auto-scheduled ${updated} successor task(s).` });
      setTimeout(() => setBanner(null), 3000);
    }
  }, [tasksQuery.data, linksQuery.data, saveTaskMut]);

  /* Recalculate parent rollups and save changed parents */
  const recalcAndSaveParent = useCallback((parentId: number, allTasks: any[]) => {
    if (parentId <= 0) return;
    const rolled = recalculateParentRollups(allTasks);
    const changedParents = getChangedParents(rolled, allTasks);
    changedParents.forEach((p: GanttTask) => {
      saveTaskMut.mutate({
        id: p.id, text: p.text, owner: p.owner || null,
        start_date: p.startDate || null, end_date: p.endDate || null,
        planned_start: p.plannedStart || null, planned_end: p.plannedEnd || null,
        duration: p.duration || 1, progress: normProgress(p.progress),
        parent: p.parent || 0, type: p.type || "project",
        status: p.status || null, remarks: p.remarks || null,
        category: (p as any).category || null,
        open: (p as any).open ?? 1, sortorder: (p as any).sortorder ?? 0,
      });
    });
  }, [saveTaskMut]);

  /* Indent selected task */
  const handleIndent = useCallback(() => {
    if (!selectedTaskId || !tasksQuery.data) return;
    const all = tasksQuery.data;
    const idx = all.findIndex((t: any) => t.id === selectedTaskId);
    if (idx <= 0) { setBanner({ type: "info", message: "Cannot indent the first task." }); return; }
    const target = all[idx];
    const above = all[idx - 1];
    if (target.parent === above.id) { setBanner({ type: "info", message: "Already indented under this task." }); return; }
    const newParent = above.type === "project" || above.parent === 0 ? above.id : above.parent || above.id;
    saveTaskMut.mutate(buildHierarchyPayload(target, newParent, all), {
      onSuccess: () => { refetchTasks().then(() => recalcAndSaveParent(newParent, all)); }
    });
    setBanner({ type: "success", message: `"${target.text}" indented under "${above.text}".` });
  }, [selectedTaskId, tasksQuery.data, saveTaskMut, recalcAndSaveParent, refetchTasks]);

  /* Outdent selected task */
  const handleOutdent = useCallback(() => {
    if (!selectedTaskId || !tasksQuery.data) return;
    const all = tasksQuery.data;
    const target = all.find((t: any) => t.id === selectedTaskId);
    if (!target) return;
    if (!target.parent || target.parent === 0) { setBanner({ type: "info", message: "Already at root level." }); return; }
    const parentTask = all.find((t: any) => t.id === target.parent);
    const newParent = parentTask?.parent || 0;
    const oldParentId = target.parent;
    saveTaskMut.mutate(buildHierarchyPayload(target, newParent, all), {
      onSuccess: () => { refetchTasks().then(() => recalcAndSaveParent(oldParentId, all)); }
    });
    setBanner({ type: "success", message: `"${target.text}" outdented to ${newParent === 0 ? "root" : "parent"} level.` });
  }, [selectedTaskId, tasksQuery.data, saveTaskMut, recalcAndSaveParent, refetchTasks]);

  /* Save project (update existing) */
  const handleSave = useCallback(() => {
    const currentTasks = tasksQuery.data || [];
    if (currentTasks.length === 0) { setBanner({ type: "error", message: "No tasks to save." }); return; }
    if (currentProjectId == null) { setSaveMode("new"); setProjectName(importSourceName); setSaveModal(true); return; }
    const tasksJson = JSON.stringify(currentTasks);
    const linksJson = linksQuery.data ? JSON.stringify(linksQuery.data) : "";
    saveProjectMut.mutate(
      { id: currentProjectId, name: currentProjectName, tasksData: tasksJson, linksData: linksJson || "", description: `${currentTasks.length} tasks` },
      { onSuccess: () => { setHasUnsavedChanges(false); lastSavedJsonRef.current = tasksJson; setBanner({ type: "success", message: `"${currentProjectName}" saved.` }); } }
    );
  }, [currentProjectId, currentProjectName, tasksQuery.data, linksQuery.data, saveProjectMut, importSourceName]);

  /* Save As (always show modal) */
  const handleSaveAs = useCallback(() => {
    setSaveMode("as");
    setProjectName(currentProjectName ? currentProjectName + " Copy" : "");
    setSaveModal(true);
  }, [currentProjectName]);

  /* Execute save from modal */
  const handleSaveProject = useCallback(() => {
    const name = projectName.trim();
    if (!name) return;
    const currentTasks = tasksQuery.data || [];
    if (currentTasks.length === 0) { setBanner({ type: "error", message: "No tasks to save." }); return; }
    if (saveMode === "as") {
      const existing = projectsList.find((p: any) => p.name === name);
      if (existing) {
        const choice = window.confirm(`"${name}" already exists.\n\nOK = Replace existing\nCancel = Keep both (will create new)`);
        if (choice) {
          const tasksJson = JSON.stringify(currentTasks);
          const linksJson = linksQuery.data ? JSON.stringify(linksQuery.data) : "";
          saveProjectMut.mutate(
            { id: existing.id, name, tasksData: tasksJson, linksData: linksJson || "", description: `${currentTasks.length} tasks` },
            { onSuccess: () => { setCurrentProjectId(existing.id); setCurrentProjectName(name); setHasUnsavedChanges(false); setImportSourceName(""); lastSavedJsonRef.current = tasksJson; setBanner({ type: "success", message: `"${name}" replaced.` }); } }
          );
          return;
        }
      }
    }
    const tasksJson = JSON.stringify(currentTasks);
    const linksJson = linksQuery.data ? JSON.stringify(linksQuery.data) : "";
    saveProjectMut.mutate(
      { name, tasksData: tasksJson, linksData: linksJson || "", description: `${currentTasks.length} tasks` },
      { onSuccess: (data: any) => { setCurrentProjectId(data.id); setCurrentProjectName(data.name); setHasUnsavedChanges(false); setImportSourceName(""); lastSavedJsonRef.current = tasksJson; setBanner({ type: "success", message: `"${data.name}" saved.` }); } }
    );
  }, [projectName, saveMode, tasksQuery.data, linksQuery.data, saveProjectMut, projectsList, currentProjectName]);

  /* Close project */
  const handleClose = useCallback(async () => {
    const currentTasks = tasksQuery.data || [];
    if (hasUnsavedChanges && currentTasks.length > 0) {
      const choice = window.confirm("You have unsaved changes.\n\nOK = Save before closing\nCancel = Don't save and close");
      if (choice) { handleSave(); return; }
    }
    setCurrentProjectId(null); setCurrentProjectName(""); setImportSourceName(""); setHasUnsavedChanges(false);
    lastSavedJsonRef.current = ""; localStorage.removeItem("gantt_current_project");
    setSelectedTaskId(null); setSelectedIds(new Set());
    setBanner({ type: "info", message: "Project closed." });
    try { await resetMut.mutateAsync(undefined); await utils.gantt.tasks.invalidate(); await utils.gantt.links.invalidate(); } catch (e) { /* ignore */ }
  }, [hasUnsavedChanges, tasksQuery.data, handleSave, resetMut, utils]);

  /* Open project with unsaved guard */
  const handleOpenClick = useCallback(() => {
    const currentTasks = tasksQuery.data || [];
    if (hasUnsavedChanges && currentTasks.length > 0) {
      const choice = window.confirm("You have unsaved changes.\n\nOK = Save, then open\nCancel = Discard changes and open");
      if (choice) { handleSave(); setTimeout(() => setLoadModal(true), 500); return; }
    }
    setLoadModal(true);
  }, [hasUnsavedChanges, tasksQuery.data, handleSave]);

  /* Multi-select toggle */
  const toggleSelect = useCallback((id: number, ctrlKey: boolean, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedRef.current !== null) {
        const allIds = (tasksQuery.data || []).map((t: any) => t.id);
        const fromIdx = allIds.indexOf(lastSelectedRef.current);
        const toIdx = allIds.indexOf(id);
        if (fromIdx >= 0 && toIdx >= 0) { const [s, e] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]; for (let i = s; i <= e; i++) next.add(allIds[i]); }
      } else if (ctrlKey || multiSelectMode) { next.has(id) ? next.delete(id) : next.add(id); }
      else { next.clear(); next.add(id); }
      return next;
    });
    lastSelectedRef.current = id;
    setSelectedTaskId(id);
  }, [tasksQuery.data, multiSelectMode]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set()); setSelectedTaskId(null); lastSelectedRef.current = null;
  }, []);

  /* ═══════ SECTION 6: PLAIN FUNCTIONS (SIXTH — after all hooks) ═══════ */

  const startEdit = (t: any) => { setEditingId(t.id); setForm(taskToForm(t, linksQuery.data || [])); setShowAdd(false); };
  const startAdd = () => { setEditingId(null); setForm(EMPTY_FORM); setShowAdd(true); };

  const submitForm = useCallback(async () => {
    if (!form.text.trim()) { setBanner({ type: "error", message: "Task Name is required." }); return; }

    /* Capture all form values to locals BEFORE any async work */
    const _predecessorId = form.predecessorId;
    const _depType       = form.depType;
    const _lagDays       = form.lagDays;
    const _parent        = form.parent || 0;
    const _text          = form.text.trim();
    const _owner         = form.owner;
    const _plannedStart  = form.plannedStart;
    const _plannedEnd    = form.plannedEnd;
    const _actualStart   = form.actualStart;
    const _actualEnd     = form.actualEnd;
    const _duration      = form.duration;
    const _progress      = form.progress;
    const _status        = form.status;
    const _remarks       = form.remarks;
    const _type          = form.type;
    const _editingId     = editingId;

    console.log("[submitForm] start  pred=", _predecessorId, "parent=", _parent, "depType=", _depType, "lag=", _lagDays);

    const autoStatus = deriveStatus({
      startDate: _actualStart || undefined, endDate: _actualEnd || undefined,
      plannedEnd: _plannedEnd || undefined,
    } as GanttTask);
    const finalStatus = _status || autoStatus;
    let finalProgress = Math.min(100, Math.max(0, _progress));
    if (_actualEnd && finalProgress < 100) finalProgress = 100;

    const allTasks = tasksQuery.data || [];
    const wbsLevel = computeWbsLevel(_editingId ?? 0, allTasks, _parent);

    const payload: any = {
      text: _text, owner: _owner || null,
      planned_start: _plannedStart || null, planned_end: _plannedEnd || null,
      start_date: _actualStart || null, end_date: _actualEnd || null,
      duration: _duration || 1, progress: finalProgress, status: finalStatus,
      wbs_level: wbsLevel, parent: _parent,
      remarks: _remarks || null, type: _type || "task",
    };
    if (_editingId) payload.id = _editingId;

    try {
      /* 1. Save task */
      const result = await saveTaskMut.mutateAsync(payload);
      const savedTaskId = _editingId || result?.id;
      console.log("[submitForm] task saved  id=", savedTaskId);

      /* 2. Save dependency if predecessor selected */
      if (_predecessorId && savedTaskId && _predecessorId !== savedTaskId) {
        const typeMap: Record<string, string> = { "FS": "0", "SS": "1", "FF": "2", "SF": "3" };
        const typeCode = typeMap[_depType] || "0";
        console.log("[submitForm] saving dep  pred=", _predecessorId, "succ=", savedTaskId, "type=", typeCode, "lag=", _lagDays);

        /* Delete existing dependency where this task is successor */
        const existing = (linksQuery.data || []).find((l: any) => (l.target === savedTaskId || l.successorTaskId === savedTaskId));
        if (existing) {
          console.log("[submitForm] deleting existing dep  id=", existing.id);
          await deleteLinkMut.mutateAsync({ id: existing.id });
        }

        /* Create new dependency */
        await saveLinkMut.mutateAsync({
          source: _predecessorId,
          target: savedTaskId,
          type: typeCode,
          lag: _lagDays,
          projectId: currentProjectId ?? undefined,
        });
        console.log("[submitForm] dependency saved OK");
      }

      /* 3. Auto-schedule */
      runAutoSchedule(_editingId || undefined);

      /* 4. Parent rollups */
      if (_parent > 0) {
        setTimeout(() => recalcAndSaveParent(_parent, tasksQuery.data || allTasks), 300);
      }

      /* 5. Reset form */
      setEditingId(null); setShowAdd(false); setForm(EMPTY_FORM);
      setBanner({ type: "success", message: `"${_text}" saved.` });

    } catch (e: any) {
      console.error("[submitForm] ERROR:", e.message, e);
      setBanner({ type: "error", message: "Save error: " + (e.message || "Unknown error") });
    }
  }, [form, editingId, saveTaskMut, saveLinkMut, deleteLinkMut, runAutoSchedule, tasksQuery.data, linksQuery.data, recalcAndSaveParent, currentProjectId]);

  const handleImportExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = parseImportFile(new Uint8Array(e.target?.result as ArrayBuffer));
      if (!result) { setBanner({ type: "error", message: "No data found in the file." }); return; }
      const { rows } = result;
      let imported = 0; let skipped = 0; const errors: string[] = [];
      rows.forEach((row: any, idx: number) => {
        const { payload, error } = parseImportRow(row, idx);
        if (error) { errors.push(error); return; }
        if (!payload) { skipped++; return; }
        saveTaskMut.mutate(payload);
        imported++;
      });
      const msg = `Imported ${imported} task(s)` + (skipped > 0 ? `, ${skipped} skipped.` : ".");
      setBanner({ type: errors.length > 0 ? "info" : "success", message: msg + (errors.length > 0 ? ` Warnings: ${errors.join("; ")}` : "") });
      setImportSourceName(file.name.replace(/\.[^.]+$/, ""));
    };
    reader.readAsArrayBuffer(file);
  };

  /* ═══════ SECTION 7: JSX RETURN (LAST) ═══════ */

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#F4F7FA" }}>
      {/* Header */}
      <header className="gantt-header" style={{ background: "#16324F", padding: "8px 16px", position: "sticky", top: 0, zIndex: 100 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", flexShrink: 0 }}>
          <ProgramsEngineeringLogo size={48} borderRadius={8} />
          <div>
            <div className="gantt-header-title" style={{ fontSize: "15px", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Gantt Charts</div>
            <div className="gantt-header-sub" style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {currentProjectId && currentProjectName ? `📁 ${currentProjectName}` : "O & M Project Schedule Visualization"}
            </div>
          </div>
        </Link>
        <div className="gantt-header-buttons">
          <div ref={exportMenuRef} style={{ position: "relative", display: "inline-flex" }}>
            <button onClick={() => setShowExportMenu(v => !v)} className="gantt-action-btn export-btn" title="Export options">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Export ▾</span>
            </button>
            {showExportMenu && (
              <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 150, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.15)", minWidth: 180, marginTop: 4, fontFamily: "Inter, sans-serif" }}>
                <button onClick={() => { exportExcel(tasksQuery.data || []); setShowExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", fontSize: 11, fontFamily: "Inter, sans-serif", border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "#1E293B" }} onMouseEnter={e => (e.currentTarget.style.background = "#F1F5F9")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Export Excel
                </button>
                <button onClick={() => { exportCSV(tasksQuery.data || []); setShowExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", fontSize: 11, fontFamily: "Inter, sans-serif", border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "#1E293B" }} onMouseEnter={e => (e.currentTarget.style.background = "#F1F5F9")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Export CSV
                </button>
                <button onClick={() => { exportTemplate(); setShowExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", fontSize: 11, fontFamily: "Inter, sans-serif", border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "#1E293B", borderTop: "1px solid #E2E8F0" }} onMouseEnter={e => (e.currentTarget.style.background = "#F1F5F9")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>Download Template
                </button>
              </div>
            )}
          </div>
          <button onClick={() => fileInputRef.current?.click()} className="gantt-action-btn import-btn" title="Import from Excel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Import Excel</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleImportExcel(e.target.files[0]); }} />
          <button onClick={handleSave} className="gantt-action-btn gantt-save-btn" title={currentProjectId ? `Update "${currentProjectName}"` : "Save project"}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>Save</span>
          </button>
          <button onClick={handleSaveAs} className="gantt-action-btn gantt-saveas-btn" title="Save as new project">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/><line x1="16" y1="8" x2="16" y2="12"/><line x1="14" y1="10" x2="18" y2="10"/></svg><span>Save As</span>
          </button>
          <button onClick={handleOpenClick} className="gantt-action-btn gantt-open-btn" title="Open saved project">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="10 13 7 10 10 7"/></svg><span>Open</span>
          </button>
          {currentProjectId && (
            <button onClick={handleClose} className="gantt-action-btn" title="Close project" style={{ background: hasUnsavedChanges ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg><span>Close</span>
            </button>
          )}
        </div>
      </header>

      {/* Banner */}
      {banner && <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />}

      {/* KPI Cards */}
      <div className="gantt-page-wrap" style={{ padding: "8px 16px 0", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
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
      <div className="gantt-page-wrap" style={{ padding: "8px 16px 0", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: "2px", background: "#E2E8F0", padding: "4px", borderRadius: "8px" }}>
          {(["gantt", "tasks", "resources"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className="gantt-tab-btn" style={{ flex: 1, padding: "5px 10px", border: "none", borderRadius: "5px", fontSize: 11, fontWeight: 600, fontFamily: "Inter, sans-serif", cursor: "pointer", transition: "all .2s", background: activeTab === tab ? "#005BAC" : "transparent", color: activeTab === tab ? "#fff" : "#5A6B7D", boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>
              <span className="tab-emoji">{tab === "gantt" ? "📅" : tab === "tasks" ? "📝" : "👥"}</span>{" "}<span className="tab-label">{tab === "gantt" ? "Gantt Chart" : tab === "tasks" ? "Task List" : "Resources"}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="gantt-page-wrap" style={{ flex: 1, padding: "16px 24px 24px", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {activeTab === "gantt" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "0 2px" }}>
              <span style={{ fontSize: 11, color: "#8BA3B8", fontWeight: 600, marginRight: "auto", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedTaskId ? (() => { const t = tasksQuery.data?.find((x: any) => x.id === selectedTaskId); return t ? `${t.text?.slice(0, 30) || "?"}` : ""; })() : "Click a task to select"}
              </span>
              <button onClick={handleOutdent} disabled={!selectedTaskId} className="gantt-action-btn gantt-outdent-btn" title={selectedTaskId ? "Outdent selected task" : "Select a task first"} style={{ padding: "5px 10px", fontSize: 11 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg><span>Outdent</span>
              </button>
              <button onClick={handleIndent} disabled={!selectedTaskId} className="gantt-action-btn gantt-indent-btn" title={selectedTaskId ? "Indent selected task" : "Select a task first"} style={{ padding: "5px 10px", fontSize: 11 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg><span>Indent</span>
              </button>
              <button onClick={() => setMultiSelectMode(!multiSelectMode)} className="gantt-action-btn" title="Toggle multi-select mode" style={{ padding: "5px 10px", fontSize: 11, background: multiSelectMode ? "#2563EB" : "#3B82F6", color: "#fff", boxShadow: multiSelectMode ? "0 0 0 2px #93C5FD" : "none", opacity: 1 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg><span>{multiSelectMode ? "Multi-ON" : "Multi"}</span>
              </button>
              <button onClick={() => setLinkModalOpen(true)} disabled={selectedIds.size < 2} className="gantt-action-btn" title={selectedIds.size < 2 ? "Select 2+ tasks first" : `Link ${selectedIds.size} selected tasks`} style={{ padding: "5px 10px", fontSize: 11, background: selectedIds.size < 2 ? "#A78BFA" : "#7C3AED" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span>Link</span>
              </button>
              <button onClick={() => { if (selectedTaskId) { setDepEditorTask(selectedTaskId); setDepEditorOpen(true); } }} disabled={!selectedTaskId} className="gantt-action-btn" title={selectedTaskId ? "Edit dependencies" : "Select a task first"} style={{ padding: "5px 10px", fontSize: 11, background: !selectedTaskId ? "#FCD34D" : "#F59E0B" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4m0 14v4m-9.66-3.34l2.83-2.83m11.66-7.66l2.83-2.83M1 12h4m14 0h4M3.34 4.34l2.83 2.83m7.66 11.66l2.83 2.83"/></svg><span>Deps</span>
              </button>
              {selectedIds.size > 0 && (
                <button onClick={clearSelection} className="gantt-action-btn" title="Clear selection" style={{ padding: "5px 10px", fontSize: 11, background: "#EF4444" }}><span>Clear ({selectedIds.size})</span></button>
              )}
            </div>
            <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)", border: "1px solid #D6DFE8", overflow: "hidden" }}>
              <NativeGanttChart tasks={(tasksQuery.data || []) as GanttTask[]} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} selectedIds={selectedIds} toggleSelect={toggleSelect} links={linksQuery.data || []} onEditTask={startEdit} />
            </div>
          </div>
        )}
        {activeTab === "tasks" && <TaskListTab tasks={tasksQuery.data || []} deleteTask={deleteTaskMut} setBanner={setBanner} onEditTask={startEdit} onAddTask={startAdd} />}
        {activeTab === "resources" && <ResourcesTab tasks={tasksQuery.data || []} />}

        {/* Task Edit/Add Form */}
        {(showAdd || editingId) && (
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #D6DFE8", boxShadow: "0 4px 16px rgba(0,0,0,.12)", padding: "12px 16px", margin: "8px 0", fontFamily: "Inter, sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#16324F" }}>{editingId ? "Edit Task" : "Add New Task"}</h4>
              <button onClick={() => { setEditingId(null); setShowAdd(false); }} style={{ background: "none", border: "none", fontSize: 16, color: "#94A3B8", cursor: "pointer", lineHeight: 1, padding: 0 }}>&times;</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "8px 10px" }}>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Task Name *</label><input value={form.text} onChange={e => setForm({...form, text: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} placeholder="Enter task name" /></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Owner</label><input value={form.owner} onChange={e => setForm({...form, owner: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} placeholder="Assignee" /></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Planned Start</label><input type="date" value={form.plannedStart} onChange={e => setForm({...form, plannedStart: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} /></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Planned End</label><input type="date" value={form.plannedEnd} onChange={e => setForm({...form, plannedEnd: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} /></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Actual Start</label><input type="date" value={form.actualStart} onChange={e => setForm({...form, actualStart: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} /></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Actual End</label><input type="date" value={form.actualEnd} onChange={e => setForm({...form, actualEnd: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} /></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Duration</label><input type="number" min={1} value={form.duration} onChange={e => setForm({...form, duration: parseInt(e.target.value)||1})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} /></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Progress %</label><input type="number" min={0} max={100} value={form.progress} onChange={e => setForm({...form, progress: parseInt(e.target.value)||0})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} /></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Status</label><select value={form.status} onChange={e => setForm({...form, status: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }}><option value="">Auto</option><option>Not Started</option><option>In Progress</option><option>In Progress (Delayed)</option><option>Completed</option></select></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Type</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }}><option value="task">Task</option><option value="milestone">Milestone</option><option value="project">Project</option></select></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Parent</label><select value={form.parent||""} onChange={e => setForm({...form, parent: e.target.value?parseInt(e.target.value):0})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }}><option value="">(Root)</option>{(tasksQuery.data||[]).filter((t:any)=>t.id!==editingId).map((t:any)=><option key={t.id} value={t.id}>{t.text}</option>)}</select></div>
              <div><label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Remarks</label><input value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} placeholder="Notes..." /></div>
            </div>

            {/* ── Scheduling Dependencies ── */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>🔗 Scheduling Dependencies</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px 10px" }}>
                <div>
                  <label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Predecessor Task</label>
                  <select value={form.predecessorId || ""} onChange={e => setForm({...form, predecessorId: e.target.value ? parseInt(e.target.value) : 0})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }}>
                    <option value="">(None)</option>
                    {(tasksQuery.data || []).filter((t: any) => t.id !== editingId).map((t: any) => <option key={t.id} value={t.id}>{t.text}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Dependency Type</label>
                  <select value={form.depType} onChange={e => setForm({...form, depType: e.target.value})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }}>
                    <option value="FS">FS — Finish-to-Start</option>
                    <option value="SS">SS — Start-to-Start</option>
                    <option value="FF">FF — Finish-to-Finish</option>
                    <option value="SF">SF — Start-to-Finish</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 9, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Lag / Lead (days)</label>
                  <input type="number" value={form.lagDays} onChange={e => setForm({...form, lagDays: parseInt(e.target.value) || 0})} style={{ width: "100%", padding: "4px 8px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" }} title="Positive = lag (delay), Negative = lead (overlap)" />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={submitForm} style={{ padding: "6px 16px", fontSize: 11, fontWeight: 600, background: "#1F9D55", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontFamily: "Inter" }}>Save</button>
              <button onClick={() => { setEditingId(null); setShowAdd(false); }} style={{ padding: "6px 16px", fontSize: 11, fontWeight: 600, background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 5, cursor: "pointer", fontFamily: "Inter" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Link Tasks Modal */}
      {linkModalOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.4)" }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: 380, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,.25)", fontFamily: "Inter, sans-serif" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px", color: "#1E293B" }}>🔗 Create Dependency</h3>
            <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 12px" }}>
              {(() => { const ids = Array.from(selectedIds); const names = ids.map(id => { const t = (tasksQuery.data || []).find((x: any) => x.id === id); return t ? t.text.slice(0, 20) : `Task ${id}`; }); return `${names.length} tasks selected: ${names.join(", ")}`; })()}
            </p>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Dependency Type</label>
            <select value={linkType} onChange={(e) => setLinkType(e.target.value)} style={{ width: "100%", padding: "8px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 6, marginBottom: 12, fontFamily: "Inter" }}>
              <option value="0">FS — Finish-to-Start</option>
              <option value="1">SS — Start-to-Start</option>
              <option value="2">FF — Finish-to-Finish</option>
              <option value="3">SF — Start-to-Finish</option>
            </select>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Lag (days)</label>
            <input type="number" value={linkLag} onChange={(e) => setLinkLag(parseInt(e.target.value) || 0)} style={{ width: "100%", padding: "8px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 6, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setLinkModalOpen(false); setLinkLag(0); }} style={{ padding: "8px 16px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 8, background: "#F1F5F9", cursor: "pointer", color: "#475569" }}>Cancel</button>
              <button onClick={() => {
                const ids = Array.from(selectedIds);
                let created = 0;
                for (let i = 0; i < ids.length - 1; i++) { saveLinkMut.mutate({ source: ids[i], target: ids[i + 1], type: linkType, lag: linkLag, projectId: currentProjectId ?? undefined }); created++; }
                setTimeout(() => runAutoSchedule(), 500);
                setBanner({ type: "success", message: `Created ${created} link(s) (${depTypeName(linkType)}, lag ${linkLag}d). Successors auto-scheduled.` });
                setLinkModalOpen(false); setLinkLag(0); setLinkType("0");
              }} style={{ padding: "8px 16px", fontSize: 12, border: "none", borderRadius: 8, background: "#005BAC", color: "#fff", cursor: "pointer", fontWeight: 600 }}>Create Links</button>
            </div>
          </div>
        </div>
      )}

      {/* Dependency Editor Modal */}
      {depEditorOpen && depEditorTask && (
        <div style={{ position: "fixed", inset: 0, zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.4)" }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: 440, maxWidth: "90vw", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.25)", fontFamily: "Inter, sans-serif" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px", color: "#1E293B" }}>🔗 Dependencies for {(() => { const t = (tasksQuery.data || []).find((x: any) => x.id === depEditorTask); return t ? t.text?.slice(0, 25) : `Task ${depEditorTask}`; })()}</h3>
            {(() => {
              const myLinks = (linksQuery.data || []).filter((l: any) => l.source === depEditorTask || l.target === depEditorTask);
              if (myLinks.length === 0) return <p style={{ fontSize: 12, color: "#94A3B8" }}>No dependencies.</p>;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {myLinks.map((lk: any) => {
                    const from = (tasksQuery.data || []).find((t: any) => t.id === lk.source);
                    const to = (tasksQuery.data || []).find((t: any) => t.id === lk.target);
                    return (
                      <div key={lk.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#F8FAFC", borderRadius: 6, fontSize: 11 }}>
                        <span style={{ fontWeight: 600, color: "#005BAC" }}>{from?.text?.slice(0, 15) || "?"}</span>
                        <span style={{ color: "#8BA3B8" }}>→</span>
                        <span style={{ fontWeight: 600, color: "#475569" }}>{to?.text?.slice(0, 15) || "?"}</span>
                        <span style={{ background: "#DBEAFE", color: "#1E40AF", fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 4 }}>{depTypeName(lk.type)}</span>
                        {lk.lag ? <span style={{ color: "#F59E0B", fontSize: 9 }}>+{lk.lag}d</span> : null}
                        <button onClick={() => { deleteLinkMut.mutate({ id: lk.id }); }} style={{ marginLeft: "auto", background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 12 }} title="Delete">×</button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => { setDepEditorOpen(false); setDepEditorTask(null); }} style={{ padding: "8px 16px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 8, background: "#F1F5F9", cursor: "pointer", color: "#475569" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Save Project Modal */}
      {saveModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget && !saveProjectMut.isPending) setSaveModal(false); }}>
          <div className="gantt-modal" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.2)", width: "100%", maxWidth: 440, padding: "24px 28px", fontFamily: "Inter, sans-serif", position: "relative", overflow: "hidden" }}>
            {saveProjectMut.isPending && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.85)", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 12 }}>
                <Spinner size={36} color="#1F9D55" /><span style={{ fontSize: 13, fontWeight: 600, color: "#16324F" }}>Saving project...</span><span style={{ fontSize: 11, color: "#94A3B8" }}>Please wait</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#16324F" }}>{saveMode === "as" ? "Save As" : "Save Project"}</h3>
              <button onClick={() => { if (!saveProjectMut.isPending) setSaveModal(false); }} disabled={saveProjectMut.isPending} style={{ background: "none", border: "none", fontSize: 20, color: saveProjectMut.isPending ? "#D1D5DB" : "#94A3B8", cursor: saveProjectMut.isPending ? "not-allowed" : "pointer", lineHeight: 1, padding: 0 }}>&times;</button>
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#5A6B7D" }}>Save the current Gantt chart as a named project you can reopen later.</p>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Project Name *</label>
            <input autoFocus value={projectName} onChange={(e) => setProjectName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && projectName.trim() && !saveProjectMut.isPending) handleSaveProject(); }} placeholder="e.g., Q2 Maintenance Plan" disabled={saveProjectMut.isPending} style={{ width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid #D6DFE8", borderRadius: 6, fontFamily: "Inter, sans-serif", boxSizing: "border-box", marginBottom: 4, opacity: saveProjectMut.isPending ? 0.5 : 1 }} />
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => { if (!saveProjectMut.isPending) setSaveModal(false); }} disabled={saveProjectMut.isPending} style={{ padding: "8px 18px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: saveProjectMut.isPending ? "#F8FAFC" : "#F1F5F9", color: saveProjectMut.isPending ? "#B0B8C4" : "#475569", border: "1px solid #D6DFE8", borderRadius: 6, cursor: saveProjectMut.isPending ? "not-allowed" : "pointer" }}>Cancel</button>
              <button onClick={handleSaveProject} disabled={!projectName.trim() || saveProjectMut.isPending} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 22px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: projectName.trim() && !saveProjectMut.isPending ? "#1F9D55" : "#94A3B8", color: "#fff", border: "none", borderRadius: 6, cursor: projectName.trim() && !saveProjectMut.isPending ? "pointer" : "not-allowed", transition: "all .15s" }}>
                {saveProjectMut.isPending ? <><SpinnerInline color="#fff" />Saving...</> : saveMode === "as" ? "Save As" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Open Project Modal */}
      {loadModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget) setLoadModal(false); }}>
          <div className="gantt-modal" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.2)", width: "100%", maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", fontFamily: "Inter, sans-serif" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#16324F" }}>Open Saved Project</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => { setLoadModal(false); setRenamingId(null); }} style={{ padding: "4px 12px", fontSize: 11, background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer", fontFamily: "Inter" }}>Cancel</button>
                <button onClick={() => { setLoadModal(false); setRenamingId(null); }} style={{ background: "none", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer", lineHeight: 1, padding: 0 }}>&times;</button>
              </div>
            </div>
            <div style={{ padding: "16px 24px", flex: 1, overflow: "auto" }}>
              {projectsListData === undefined ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", gap: 12 }}>
                  <Spinner size={28} color="#005BAC" /><span style={{ fontSize: 12, color: "#94A3B8" }}>Loading saved projects...</span>
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
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#EFF6FF")} onMouseLeave={(e) => (e.currentTarget.style.background = "#FAFBFC")}>
                      <div style={{ fontSize: 20, flexShrink: 0 }}>📁</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {renamingId === p.id ? (
                          <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && renameValue.trim()) { renameProjectMut.mutate({ id: p.id, name: renameValue.trim() }); setRenamingId(null); } if (e.key === "Escape") setRenamingId(null); }} style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #005BAC", borderRadius: 4, fontFamily: "Inter, sans-serif", boxSizing: "border-box" }} />
                        ) : (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#2D3748", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                            <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ""}{p.description ? " · " + p.description : ""}</div>
                          </>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {renamingId === p.id ? (
                          <>
                            <button onClick={() => { if (renameValue.trim()) { renameProjectMut.mutate({ id: p.id, name: renameValue.trim() }); setRenamingId(null); } }} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "#1F9D55", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Save</button>
                            <button onClick={() => setRenamingId(null)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer" }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { if (!loadProjectMut.isPending) loadProjectMut.mutate({ id: p.id }); }} disabled={loadProjectMut.isPending} title="Load" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", fontSize: 11, fontWeight: 600, background: loadingProjectId === p.id ? "#93C5FD" : "#005BAC", color: "#fff", border: "none", borderRadius: 4, cursor: loadProjectMut.isPending ? "not-allowed" : "pointer", transition: "all .2s", minWidth: 52, justifyContent: "center" }}>
                              {loadingProjectId === p.id ? <><SpinnerInline color="#fff" /><span>Loading</span></> : "Open"}
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
      <footer style={{ borderTop: "1px solid #D6DFE8", padding: "16px 24px", textAlign: "right", fontSize: 11, color: "#5A6B7D" }}>Program Oversight Center &copy; 2026</footer>

      {/* AI Assistant */}
      <AIAssistant contextType="gantt" data={tasksQuery.data || []} title="Gantt AI" />

      {/* Styles */}
      <style>{`
        .gantt-action-btn { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; font-size: 11px; font-weight: 600; font-family: Inter, sans-serif; border: none; border-radius: 5px; cursor: pointer; transition: all .15s; white-space: nowrap; color: #fff; line-height: 1.4; }
        .export-btn { background: #1F9D55; } .export-btn:hover { background: #15803D; }
        .import-btn { background: #005BAC; } .import-btn:hover { background: #004D99; }
        .gantt-save-btn { background: #1F9D55; } .gantt-save-btn:hover { background: #15803D; }
        .gantt-saveas-btn { background: #D97706; } .gantt-saveas-btn:hover { background: #B45309; }
        .gantt-open-btn { background: #2563EB; } .gantt-open-btn:hover { background: #1D4ED8; }
        .gantt-indent-btn { background: #7C3AED; } .gantt-indent-btn:hover:not(:disabled) { background: #6D28D9; }
        .gantt-indent-btn:disabled { background: #C4B5FD; cursor: not-allowed; }
        .gantt-outdent-btn { background: #0891B2; } .gantt-outdent-btn:hover:not(:disabled) { background: #0E7490; }
        .gantt-outdent-btn:disabled { background: #A5F3FC; cursor: not-allowed; }
        .gantt-header { display: flex; align-items: center; gap: 16px; flex-wrap: nowrap; }
        .gantt-header-buttons { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
        @keyframes ganttSpin { to { transform: rotate(360deg); } }
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
          .gantt-task-col { width: 180px !important; min-width: 180px !important; }
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
          .gantt-task-col { width: 150px !important; min-width: 150px !important; }
          .gantt-task-name { font-size: 9px !important; }
        }
      `}</style>
    </div>
  );
}
