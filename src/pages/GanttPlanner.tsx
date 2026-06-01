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
  GanttTask, parseDate, daysBetween, normProgress,
  DEP_TYPE_MAP, buildTaskTree, flattenVisible, deriveStatus,
} from "@/modules/gantt/engine/schedulingEngine";
import {
  autoSchedule, buildConnectors, calculateDependencyPlannedDates,
  endFromStartAndDuration, normalizeDependencyType, startFromEndAndDuration,
  wouldCreateDependencyCycle,
} from "@/modules/gantt/engine/dependencyEngine";
import {
  recalculateParentRollups, getChangedParents,
} from "@/modules/gantt/engine/rollupEngine";
import {
  exportTemplate, exportCSV, exportExcel, parseImportFile, parseImportRow,
} from "@/modules/gantt/engine/persistenceEngine";
import {
  buildHierarchyPayload, computeWbsLevel, computeWbsLevelMap, calcIndent, calcOutdent, getAncestorIds, validateParentAssignment,
} from "@/modules/gantt/engine/hierarchyEngine";
import {
  isParent, isFieldEditable,
} from "@/modules/gantt/engine/parentEngine";
import {
  calcKpi, statusColor as _statusColor, statusBg as _statusBg, statusBadgeStyle, rowStatus, fmtMonth, fmtShortDate,
} from "@/modules/gantt/engine/uiUtilsEngine";
import {
  buildManualHierarchyOrder, getSiblingOrderDebug, getSiblingOrderState, getTaskParentId, sortTasksForHierarchyDisplay,
} from "@/modules/gantt/engine/taskReorderEngine";

/* LOCAL statusBg — workaround for Vite tree-shaking bug that removes imported function */
const statusBg = (status: string): string => {
  const map: Record<string, string> = {
    "Completed": "#DCFCE7", "In Progress": "#DBEAFE", "In Progress (Delayed)": "#FEE2E2",
    "Not Started": "#F1F5F9", "Delayed": "#FEF3C7", "Overdue": "#FEE2E2",
  };
  return map[status] || "#F1F5F9";
};

/* ═══════════════════════════════════════════════════════════════════
   TYPES (module-level, no hooks)
   ═══════════════════════════════════════════════════════════════════ */

/* ─── UUID helper (module-level, no hooks) ─── */
function generateUid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

interface TaskForm {
  text: string; owner: string;
  plannedStart: string; plannedEnd: string;
  actualStart: string; actualEnd: string;
  duration: number; progress: number;
  status: string; remarks: string;
  type: string; parent: number;
  /* UID-based identity (frontend uses these, NOT raw DB IDs) */
  frontendTaskUid: string;
  parentFrontendUid: string;
  predecessorFrontendUid: string;
  /* Scheduling Dependencies */
  predecessorId: number;
  depType: string;
  lagDays: number;
}

/* ═══════════════════════════════════════════
   EXPLICIT DB ↔ FORM MAPPING FUNCTIONS
   These isolate all field name translation
   in one place for easy maintenance.
   ═══════════════════════════════════════════ */

function mapDbRowToForm(t: any, links?: any[], allTasks?: any[]): TaskForm {
  const existingDep = links?.find((l: any) => l.target === t.id || l.successorTaskId === t.id);
  const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };

  /* DB columns (new) with fallback to backward-compatible aliases */
  const uid = t.frontendTaskUid || t.frontend_task_uid || "";
  let parentUid = t.parentFrontendUid || t.parent_frontend_uid || "";
  let predUid = t.predecessorFrontendUid || t.predecessor_frontend_uid || "";
  const rowPred = t.predecessorTaskId ?? t.predecessor_task_id ?? 0;
  const rowType = t.dependencyType ?? t.dependency_type ?? "FS";
  const rowLag = t.lagDays ?? t.lag_days ?? 0;

  /* Resolve missing UIDs from allTasks lookup */
  if (!parentUid && (t.parentTaskId ?? t.parent) && allTasks) {
    const pTask = allTasks.find((pt: any) => pt.id === (t.parentTaskId ?? t.parent));
    if (pTask) parentUid = pTask.frontendTaskUid || pTask.frontend_task_uid || "";
  }
  if (!predUid && rowPred && allTasks) {
    const pTask = allTasks.find((pt: any) => pt.id === rowPred);
    if (pTask) predUid = pTask.frontendTaskUid || pTask.frontend_task_uid || "";
  }
  if (!predUid && existingDep && allTasks) {
    const pTask = allTasks.find((pt: any) => pt.id === (existingDep.source ?? existingDep.predecessorTaskId));
    if (pTask) predUid = pTask.frontendTaskUid || pTask.frontend_task_uid || "";
  }

  const resolvedPredecessorId = rowPred || existingDep?.source || existingDep?.predecessorTaskId || 0;
  const resolvedDepType = typeMap[existingDep?.type] || rowType;
  const hasDependency = !!resolvedPredecessorId;

  return {
    text: t.taskName ?? t.text ?? "",
    owner: t.owner ?? "",
    plannedStart: (t.plannedStart ?? "").toString().slice(0, 10),
    plannedEnd: (t.plannedFinish ?? t.plannedEnd ?? "").toString().slice(0, 10),
    actualStart: (t.actualStart ?? t.startDate ?? "").toString().slice(0, 10),
    actualEnd: (t.actualFinish ?? t.endDate ?? "").toString().slice(0, 10),
    duration: t.plannedDuration ?? t.duration ?? 1,
    progress: normProgress(t.progressPercent ?? t.progress),
    status: rowStatus(t),
    remarks: t.remarks ?? "",
    type: t.taskType ?? t.type ?? "task",
    parent: t.parentTaskId ?? t.parent ?? 0,
    frontendTaskUid: uid || generateUid(),
    parentFrontendUid: parentUid,
    predecessorFrontendUid: predUid,
    predecessorId: resolvedPredecessorId,
    depType: hasDependency ? resolvedDepType : "NONE",
    lagDays: hasDependency ? (rowLag || existingDep?.lag || 0) : 0,
  };
}

function mapFormToPayload(form: TaskForm, editingId: number | null): Record<string, any> {
  /* Convert TaskForm → backend payload (uses new DB field names) */
  return {
    id: editingId ?? undefined,
    frontend_task_uid: form.frontendTaskUid || generateUid(),
    task_name: form.text.trim(),
    parent_task_id: form.parent || 0,
    predecessor_task_id: form.depType === "NONE" ? null : (form.predecessorId || null),
    dependency_type: form.depType === "NONE" ? null : (form.depType || null),
    lag_days: form.depType === "NONE" ? 0 : (form.lagDays || 0),
    wbs_level: 0, /* computed server-side or by caller */
    sort_order: 0, /* computed server-side or by caller */
    planned_start: form.plannedStart || null,
    planned_finish: form.plannedEnd || null,
    planned_duration: form.duration || 1,
    actual_start: form.actualStart || null,
    actual_finish: form.actualEnd || null,
    actual_duration: form.duration || 1,
    progress_percent: Math.min(100, Math.max(0, form.progress)),
    status: form.status || null,
    owner: form.owner || null,
    category: null,
    notes: form.remarks || null,
    remarks: form.remarks || null,
    task_type: form.type || "task",
    is_milestone: form.type === "milestone" ? 1 : 0,
  };
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
  frontendTaskUid: "", parentFrontendUid: "", predecessorFrontendUid: "",
  predecessorId: 0, depType: "NONE", lagDays: 0,
};

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  autofit: "Auto-fit", year: "Year", quarter: "Quarter",
  month: "Month", week: "Week", day: "Day",
};

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function calcDurationFromDates(start?: string, end?: string): number | null {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e) return null;
  return Math.max(1, daysBetween(s, e) + 1);
}

function calcEndFromStartAndDuration(start?: string, duration?: number): string {
  return start ? endFromStartAndDuration(start, duration) : "";
}

function calcStartFromEndAndDuration(end?: string, duration?: number): string {
  return end ? startFromEndAndDuration(end, duration) : "";
}

const ZOOM_DAY_WIDTH: Record<Exclude<ZoomLevel, "autofit">, number> = {
  year: 0.5, quarter: 2, month: 5, week: 16, day: 48,
};

const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

/* ═══════════════════════════════════════════════════════════════════
   MODULE-LEVEL PURE HELPERS (no hooks, no React dependencies)
   ═══════════════════════════════════════════════════════════════════ */

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

/* ─── Tooltip Data + Component ─── */
interface TooltipData { task: GanttTask; x: number; y: number; visible: boolean; }

function GanttTooltip({ data }: { data: TooltipData }) {
  if (!data.visible) return null;
  const t = data.task;
  const status = rowStatus(t);
  const statusColors: Record<string, string> = {
    "Completed": "#1F9D55", "In Progress": "#005BAC", "In Progress (Delayed)": "#F59E0B",
    "Not Started": "#8BA3B8", "Overdue": "#DC2626", "Delayed": "#DC2626",
  };
  const statusColor = statusColors[status] || "#5A6B7D";
  return (
    <div style={{
      position: "fixed", left: data.x, top: data.y, zIndex: 9999, pointerEvents: "none",
      background: "#fff", border: "1px solid #D6DFE8", borderRadius: 8,
      boxShadow: "0 4px 16px rgba(0,0,0,.12)",
      padding: "10px 14px", minWidth: 180, maxWidth: 260,
      fontFamily: "Inter, sans-serif", fontSize: 11, color: "#1E293B",
      animation: "ganttTooltipIn 0.12s ease-out",
    }}>
      {/* Task name */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
        <div style={{ fontWeight: 700, fontSize: 11, color: "#16324F", lineHeight: 1.3, wordBreak: "break-word" }}>{t.text || "Untitled"}</div>
      </div>
      {/* Compact status + progress line */}
      <div style={{ fontSize: 10, color: "#5A6B7D", marginBottom: 6, display: "flex", gap: 10 }}>
        <span><span style={{ color: statusColor, fontWeight: 600 }}>{status}</span></span>
        <span>{normProgress(t.progress)}%</span>
        <span>{t.duration || "—"}d</span>
      </div>
      {/* Notes (the key info) */}
      <div style={{ fontSize: 10, color: "#5A6B7D", fontStyle: t.remarks ? "normal" : "italic", lineHeight: 1.4, borderTop: "1px solid #E2E8F0", paddingTop: 6 }}>
        {t.remarks || "No notes available"}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ENTERPRISE TOOLBAR / MENU BAR
   MS Project / Primavera-style grouped toolbar
   ═══════════════════════════════════════════ */

interface ToolbarProps {
  currentProjectId: number | null; currentProjectName: string;
  hasUnsavedChanges: boolean;
  onSave: () => void; onSaveAs: () => void; onOpen: () => void; onClose: () => void;
  onImport: () => void;
  onExportExcel: () => void; onExportCSV: () => void; onExportTemplate: () => void;
  onMigrate: () => void; onReset: () => void; onLoadDemo: () => void;
  onIndent?: () => void; onOutdent?: () => void;
  onMoveUp?: () => void; onMoveDown?: () => void;
  moveUpDisabled?: boolean; moveDownDisabled?: boolean; moveDisabledReason?: string;
  onInsertAbove?: () => void; onInsertBelow?: () => void; onInsertChild?: () => void;
  onDelete?: () => void;
  onLink?: () => void; onClear?: () => void;
  multiSelectMode?: boolean; onToggleMulti?: () => void;
  selectedIdsSize?: number;
  tasksExist: boolean;
}

function GanttToolbar({
  currentProjectId, currentProjectName, hasUnsavedChanges,
  onSave, onSaveAs, onOpen, onClose, onImport,
  onExportExcel, onExportCSV, onExportTemplate,
  onMigrate, onReset, onLoadDemo,
  onIndent, onOutdent, onMoveUp, onMoveDown, moveUpDisabled, moveDownDisabled, moveDisabledReason, onInsertAbove, onInsertBelow, onInsertChild,
  onDelete,
  onLink, onClear,
  multiSelectMode, onToggleMulti, selectedIdsSize,
  tasksExist,
}: ToolbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* Dropdown menu button — uses position:fixed to escape overflow:clip */
  const MenuBtn = ({ label, icon, menuKey, children }: { label: string; icon: React.ReactNode; menuKey: string; children: React.ReactNode }) => {
    const btnRef = useRef<HTMLButtonElement>(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    useEffect(() => {
      if (openMenu === menuKey && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left });
      }
    }, [openMenu, menuKey]);
    return (
      <div>
        <button ref={btnRef} onClick={() => setOpenMenu(openMenu === menuKey ? null : menuKey)} style={{ ...btnBase, borderColor: openMenu === menuKey ? "#005BAC" : btnBase.borderColor, background: openMenu === menuKey ? "rgba(255,255,255,0.2)" : btnBase.background }} onMouseEnter={btnHover} onMouseLeave={btnLeave}>
          {icon}<span>{label} ▾</span>
        </button>
        {openMenu === menuKey && (
          <div style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, background: "#fff", border: "1px solid #D6DFE8", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,.18)", minWidth: 180, fontFamily: "Inter, sans-serif", padding: "4px 0" }}>
            {children}
          </div>
        )}
      </div>
    );
  };
  const Mi = ({ icon, label, onClick, danger }: { icon?: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={() => { onClick(); setOpenMenu(null); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 14px", fontSize: 11, fontFamily: "Inter, sans-serif", border: "none", background: "none", cursor: "pointer", textAlign: "left", color: danger ? "#DC2626" : "#1E293B", transition: "background .1s" }} onMouseEnter={e => (e.currentTarget.style.background = "#F1F5F9")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>{icon}{label}</button>
  );

  const btnBase: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
    fontSize: 11, fontWeight: 600, fontFamily: "Inter, sans-serif",
    border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, cursor: "pointer",
    background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.8)", transition: "all .15s", lineHeight: 1,
  };
  const btnHover = (e: React.MouseEvent) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.15)"; };
  const btnLeave = (e: React.MouseEvent) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)"; };
  const sep = <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.12)", margin: "0 2px", flexShrink: 0 }} />;

  return (
    <div style={{ background: "#16324F", position: "sticky", top: 0, zIndex: 100 }}>
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px 4px" }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
          <ProgramsEngineeringLogo size={36} borderRadius={6} />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>Gantt Charts</div>
            <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {currentProjectId && currentProjectName ? currentProjectName : "O & M Project Schedule"}
            </div>
          </div>
        </Link>
        {/* Mobile hamburger */}
        <button className="gantt-mobile-hamburger" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 4 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>

      {/* Toolbar row — desktop */}
      <div className="gantt-desktop-toolbar" style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 12px 6px", overflowX: "auto" }}>

        {/* FILE MENU */}
        <MenuBtn label="File" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>} menuKey="file">
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>} label="Save" onClick={onSave} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#005BAC" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>} label="Import Excel" onClick={onImport} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>} label="Export Excel" onClick={onExportExcel} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>} label="Export CSV" onClick={onExportCSV} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>} label="Download Template" onClick={onExportTemplate} />
        </MenuBtn>

        {/* PROJECT MENU */}
        <MenuBtn label="Project" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>} menuKey="project">
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#005BAC" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>} label="Open" onClick={onOpen} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#005BAC" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>} label="Save As" onClick={onSaveAs} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>} label="Close" onClick={onClose} />
        </MenuBtn>

        {sep}

        {/* TASK MENU */}
        <MenuBtn label="Task" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>} menuKey="task">
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={onInsertAbove ? "#1D4ED8" : "#CBD5E1"} strokeWidth="2"><polyline points="12 5 12 19"/><polyline points="6 11 12 5 18 11"/></svg>} label="Insert Above" onClick={onInsertAbove || (() => {})} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={onInsertBelow ? "#1D4ED8" : "#CBD5E1"} strokeWidth="2"><polyline points="12 5 12 19"/><polyline points="6 13 12 19 18 13"/></svg>} label="Insert Below" onClick={onInsertBelow || (() => {})} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={onInsertChild ? "#15803D" : "#CBD5E1"} strokeWidth="2"><polyline points="12 5 12 19"/><polyline points="6 13 12 19 18 13"/></svg>} label="Insert Child" onClick={onInsertChild || (() => {})} />
          <div style={{ height: 1, background: "#E2E8F0", margin: "4px 8px" }} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>} label="Outdent" onClick={() => onOutdent?.()} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>} label="Indent" onClick={() => onIndent?.()} />
          <div style={{ height: 1, background: "#E2E8F0", margin: "4px 8px" }} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={moveUpDisabled ? "#CBD5E1" : "#0F766E"} strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg>} label="Move Up" onClick={() => moveUpDisabled ? alert(moveDisabledReason || "Select a movable task.") : onMoveUp?.()} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={moveDownDisabled ? "#CBD5E1" : "#0F766E"} strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>} label="Move Down" onClick={() => moveDownDisabled ? alert(moveDisabledReason || "Select a movable task.") : onMoveDown?.()} />
          <div style={{ height: 1, background: "#E2E8F0", margin: "4px 8px" }} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={onDelete ? "#DC2626" : "#CBD5E1"} strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>} label="Delete" onClick={() => {
            if (!onDelete) return alert("Select a task first");
            if (confirm("Delete selected task?")) onDelete();
          }} danger />
        </MenuBtn>

        {sep}

        {/* SELECT MENU */}
        <MenuBtn label="Select" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>} menuKey="select">
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>} label={multiSelectMode ? "Multi-Select: ON" : "Multi-Select: OFF"} onClick={() => onToggleMulti?.()} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>} label={`Clear (${selectedIdsSize || 0})`} onClick={() => onClear?.()} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3730A3" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>} label="Link" onClick={() => onLink?.()} />
        </MenuBtn>

        {sep}

        {/* ADMIN MENU */}
        <MenuBtn label="Admin" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>} menuKey="admin">
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M4 7V4h3M4 17v3h3M20 7V4h-3M20 17v3h-3M9 9h6v6H9z"/></svg>} label="Migrate DB" onClick={onMigrate} />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>} label="Reset Data" onClick={() => { if (confirm("Delete all Gantt data?")) onReset(); }} danger />
          <Mi icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#005BAC" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.66-9.34l2.83 2.83m9.66-2.83l2.83-2.83M4 12h4m12 0h-4M6.34 6.34l2.83 2.83m9.66 0l2.83-2.83"/></svg>} label="Load Demo" onClick={onLoadDemo} />
        </MenuBtn>

        <div style={{ marginLeft: "auto" }} />
        {hasUnsavedChanges && (
          <span style={{ fontSize: 10, color: "#FBBF24", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#FBBF24" }} />Unsaved
          </span>
        )}
      </div>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div ref={mobileRef} style={{ background: "#0F2440", borderTop: "1px solid rgba(255,255,255,0.1)", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          <Mmi label="Save" onClick={() => { onSave(); setMobileMenuOpen(false); }} />
          <Mmi label="Import Excel" onClick={() => { onImport(); setMobileMenuOpen(false); }} />
          <Mmi label="Export Excel" onClick={() => { onExportExcel(); setMobileMenuOpen(false); }} />
          <Mmi label="Open Project" onClick={() => { onOpen(); setMobileMenuOpen(false); }} />
          <Mmi label="Save As" onClick={() => { onSaveAs(); setMobileMenuOpen(false); }} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
          <Mmi label="Move Up" onClick={() => { moveUpDisabled ? alert(moveDisabledReason || "Select a movable task.") : onMoveUp?.(); setMobileMenuOpen(false); }} />
          <Mmi label="Move Down" onClick={() => { moveDownDisabled ? alert(moveDisabledReason || "Select a movable task.") : onMoveDown?.(); setMobileMenuOpen(false); }} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
          <Mmi label="Migrate DB" onClick={() => { onMigrate(); setMobileMenuOpen(false); }} />
          <Mmi label="Reset Data" onClick={() => { if (confirm("Delete all Gantt data?")) { onReset(); setMobileMenuOpen(false); } }} />
          <Mmi label="Load Demo" onClick={() => { onLoadDemo(); setMobileMenuOpen(false); }} />
          <Mmi label="Close Project" onClick={() => { onClose(); setMobileMenuOpen(false); }} />
        </div>
      )}
    </div>
  );
}

function Tbm({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 14px", fontSize: 11, fontFamily: "Inter, sans-serif", border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "#1E293B", transition: "background .1s" }} onMouseEnter={e => (e.currentTarget.style.background = "#F1F5F9")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>{icon}<span>{label}</span></button>
  );
}
function Mmi({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", padding: "10px 14px", fontSize: 13, fontWeight: 500, fontFamily: "Inter, sans-serif", border: "none", background: "none", cursor: "pointer", textAlign: "left", color: "rgba(255,255,255,0.9)", borderRadius: 6, transition: "background .1s", width: "100%" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>{label}</button>
  );
}

/* ═══════════════════════════════════════════
   QUICK ACTION BAR — high-frequency pill buttons
   ═══════════════════════════════════════════ */

interface QuickActionProps {
  onAdd: () => void;
  onInsertAbove?: () => void; onInsertBelow?: () => void; onInsertChild?: () => void;
  onIndent?: () => void; onOutdent?: () => void;
  onMoveUp?: () => void; onMoveDown?: () => void;
  moveUpDisabled?: boolean; moveDownDisabled?: boolean; moveDisabledReason?: string;
  onDelete?: () => void;
  onMulti: () => void; multiSelectMode: boolean;
  onClear: () => void; selectionSize: number;
  onLink: () => void;
  onSave: () => void;
  selectedTaskId: number | null;
  selectedTaskName?: string;
}

function QuickActionBar({
  onAdd, onInsertAbove, onInsertBelow, onInsertChild,
  onIndent, onOutdent, onMoveUp, onMoveDown, moveUpDisabled, moveDownDisabled, moveDisabledReason, onDelete,
  onMulti, multiSelectMode, onClear, selectionSize, onLink, onSave,
  selectedTaskId, selectedTaskName,
}: QuickActionProps) {
  /* ═── Rich Color Palette ──══════════════════════════════════ */
  const pill: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 11px", fontSize: 11, fontWeight: 700,
    fontFamily: "Inter, sans-serif", border: "1px solid",
    borderRadius: 20, cursor: "pointer", transition: "all .15s",
    lineHeight: 1, whiteSpace: "nowrap",
  };
  /* ── Color Presets ── */
  const COLORS = {
    slate:    { bg: "#F1F5F9", border: "#CBD5E1", text: "#334155", hoverBg: "#E2E8F0", hoverBorder: "#94A3B8", shadow: "0 1px 2px rgba(51,65,85,.08)" },
    blue:     { bg: "#EFF6FF", border: "#93C5FD", text: "#1D4ED8", hoverBg: "#DBEAFE", hoverBorder: "#3B82F6", shadow: "0 1px 3px rgba(29,78,216,.12)" },
    green:    { bg: "#1F9D55", border: "#1F9D55", text: "#FFFFFF", hoverBg: "#15803D", hoverBorder: "#15803D", shadow: "0 2px 6px rgba(31,157,85,.30)" },
    red:      { bg: "#FEF2F2", border: "#FCA5A5", text: "#DC2626", hoverBg: "#FEE2E2", hoverBorder: "#EF4444", shadow: "0 1px 3px rgba(220,38,38,.10)" },
    amber:    { bg: "#FFFBEB", border: "#FCD34D", text: "#B45309", hoverBg: "#FEF3C7", hoverBorder: "#F59E0B", shadow: "0 1px 3px rgba(180,83,9,.10)" },
    violet:   { bg: "#F5F3FF", border: "#C4B5FD", text: "#6D28D9", hoverBg: "#EDE9FE", hoverBorder: "#8B5CF6", shadow: "0 1px 3px rgba(109,40,217,.10)" },
    disabled: { bg: "#F8FAFC", border: "#E2E8F0", text: "#94A3B8", hoverBg: "#F8FAFC", hoverBorder: "#E2E8F0", shadow: "none" },
  };
  const applyColors = (c: typeof COLORS.slate): React.CSSProperties => ({
    ...pill, background: c.bg, borderColor: c.border, color: c.text, boxShadow: c.shadow,
  });
  const setHover = (e: React.MouseEvent, c: typeof COLORS.slate) => {
    const t = e.currentTarget; t.style.background = c.hoverBg; t.style.borderColor = c.hoverBorder; t.style.boxShadow = c.shadow.replace(/\d+\.?\d*/g, m => String(parseFloat(m) * 1.5));
  };
  const setLeave = (e: React.MouseEvent, c: typeof COLORS.slate) => {
    const t = e.currentTarget; t.style.background = c.bg; t.style.borderColor = c.border; t.style.boxShadow = c.shadow;
  };
  const disabledPill = (enabled: boolean) => enabled ? {} : { opacity: 0.45, cursor: "not-allowed" as const, ...applyColors(COLORS.disabled) };

  /* Selected task name for context */
  const selName = selectedTaskName || null;

  return (
    <div className="gantt-quick-actions" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {/* Selected task context */}
      {selName && <span style={{ fontSize: 11, fontWeight: 600, color: "#1E3A5F", marginRight: 4, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selName}</span>}

      {/* ── ADD GROUP ── */}
      <button onClick={onAdd} title="Add Task (Ctrl+N)" style={applyColors(COLORS.green)} onMouseEnter={e => { const t = e.currentTarget; t.style.background = COLORS.green.hoverBg; t.style.borderColor = COLORS.green.hoverBorder; t.style.boxShadow = "0 3px 8px rgba(31,157,85,.35)"; }} onMouseLeave={e => { const t = e.currentTarget; t.style.background = COLORS.green.bg; t.style.borderColor = COLORS.green.border; t.style.boxShadow = COLORS.green.shadow; }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add
      </button>
      {selectedTaskId && onDelete && (
        <button onClick={onDelete} title="Delete selected task" style={applyColors(COLORS.red)} onMouseEnter={e => setHover(e, COLORS.red)} onMouseLeave={e => setLeave(e, COLORS.red)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete
        </button>
      )}

      {selectedTaskId && (
        <>
          {onInsertAbove && <button onClick={onInsertAbove} title="Insert Above" style={applyColors(COLORS.blue)} onMouseEnter={e => setHover(e, COLORS.blue)} onMouseLeave={e => setLeave(e, COLORS.blue)}><span style={{ fontSize: 12 }}>⬆</span>Above</button>}
          {onInsertBelow && <button onClick={onInsertBelow} title="Insert Below" style={applyColors(COLORS.blue)} onMouseEnter={e => setHover(e, COLORS.blue)} onMouseLeave={e => setLeave(e, COLORS.blue)}><span style={{ fontSize: 12 }}>⬇</span>Below</button>}
          {onInsertChild && <button onClick={onInsertChild} title="Insert Child" style={applyColors(COLORS.violet)} onMouseEnter={e => setHover(e, COLORS.violet)} onMouseLeave={e => setLeave(e, COLORS.violet)}><span style={{ fontSize: 12 }}>➕</span>Child</button>}
        </>
      )}

      <span style={{ width: 1, height: 16, background: "#94A3B8", margin: "0 2px", flexShrink: 0 }} />

      {/* ── STRUCTURE GROUP ── */}
      <button onClick={onOutdent} disabled={!selectedTaskId || !onOutdent} title="Outdent Task" style={{ ...applyColors(COLORS.slate), ...disabledPill(!!selectedTaskId && !!onOutdent) }} onMouseEnter={!selectedTaskId ? undefined : e => setHover(e, COLORS.slate)} onMouseLeave={!selectedTaskId ? undefined : e => setLeave(e, COLORS.slate)}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>Outdent
      </button>
      <button onClick={onIndent} disabled={!selectedTaskId || !onIndent} title="Indent Task" style={{ ...applyColors(COLORS.slate), ...disabledPill(!!selectedTaskId && !!onIndent) }} onMouseEnter={!selectedTaskId ? undefined : e => setHover(e, COLORS.slate)} onMouseLeave={!selectedTaskId ? undefined : e => setLeave(e, COLORS.slate)}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>Indent
      </button>
      <button onClick={onMoveUp} disabled={moveUpDisabled} title={moveUpDisabled ? (moveDisabledReason || "Cannot move up") : "Move selected task up within its current parent"} style={{ ...applyColors(moveUpDisabled ? COLORS.disabled : COLORS.slate), ...disabledPill(!moveUpDisabled) }} onMouseEnter={moveUpDisabled ? undefined : e => setHover(e, COLORS.slate)} onMouseLeave={moveUpDisabled ? undefined : e => setLeave(e, COLORS.slate)}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>Move Up
      </button>
      <button onClick={onMoveDown} disabled={moveDownDisabled} title={moveDownDisabled ? (moveDisabledReason || "Cannot move down") : "Move selected task down within its current parent"} style={{ ...applyColors(moveDownDisabled ? COLORS.disabled : COLORS.slate), ...disabledPill(!moveDownDisabled) }} onMouseEnter={moveDownDisabled ? undefined : e => setHover(e, COLORS.slate)} onMouseLeave={moveDownDisabled ? undefined : e => setLeave(e, COLORS.slate)}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>Move Down
      </button>

      <span style={{ width: 1, height: 16, background: "#94A3B8", margin: "0 2px", flexShrink: 0 }} />

      {/* ── SELECTION GROUP ── */}
      <button onClick={onMulti} title="Toggle Multi-Select" style={multiSelectMode ? applyColors(COLORS.violet) : applyColors(COLORS.amber)} onMouseEnter={e => setHover(e, multiSelectMode ? COLORS.violet : COLORS.amber)} onMouseLeave={e => setLeave(e, multiSelectMode ? COLORS.violet : COLORS.amber)}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>{multiSelectMode ? "Multi-ON" : "Multi"}
      </button>
      {selectionSize > 0 && (
        <button onClick={onClear} title="Clear Selection" style={applyColors(COLORS.red)} onMouseEnter={e => setHover(e, COLORS.red)} onMouseLeave={e => setLeave(e, COLORS.red)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>Clear ({selectionSize})
        </button>
      )}

      <span style={{ width: 1, height: 16, background: "#94A3B8", margin: "0 2px", flexShrink: 0 }} />

      {/* ── LINK + SAVE ── */}
      <button onClick={onLink} disabled={selectionSize < 2} title="Link Selected Tasks (2+ required)" style={{ ...applyColors(selectionSize >= 2 ? COLORS.blue : COLORS.disabled), ...disabledPill(selectionSize >= 2) }} onMouseEnter={selectionSize >= 2 ? e => setHover(e, COLORS.blue) : undefined} onMouseLeave={selectionSize >= 2 ? e => setLeave(e, COLORS.blue) : undefined}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Link
      </button>
      <button onClick={onSave} title="Save Project" style={applyColors(COLORS.green)} onMouseEnter={e => setHover(e, COLORS.green)} onMouseLeave={e => setLeave(e, COLORS.green)}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>Save
      </button>
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
  onInsertAbove?: (task: GanttTask) => void;
  onInsertBelow?: (task: GanttTask) => void;
  onInsertChild?: (task: GanttTask) => void;
}

/* ─── Insert Dropdown Menu Button ─── */
function InsertMenuButton({ sel, onInsertAbove, onInsertBelow, onInsertChild }: {
  sel: any; onInsertAbove?: (t: any) => void; onInsertBelow?: (t: any) => void; onInsertChild?: (t: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [sel?.id]);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen(!open)} style={{ padding: "5px 10px", fontSize: 10, fontWeight: 600, background: "#EFF6FF", color: "#005BAC", border: "1px solid #BFDBFE", borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
        Insert <span style={{ fontSize: 8 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 2, background: "#fff", border: "1px solid #D6DFE8", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,.12)", zIndex: 50, minWidth: 140, padding: "4px 0" }}>
          {onInsertAbove && <div onClick={() => { onInsertAbove(sel); setOpen(false); }} style={{ padding: "6px 12px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#1E293B", transition: "background .1s" }} onMouseEnter={e => (e.currentTarget.style.background = "#EFF6FF")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>⬆ <span>Insert Above</span></div>}
          {onInsertBelow && <div onClick={() => { onInsertBelow(sel); setOpen(false); }} style={{ padding: "6px 12px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#1E293B", transition: "background .1s" }} onMouseEnter={e => (e.currentTarget.style.background = "#EFF6FF")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>⬇ <span>Insert Below</span></div>}
          {onInsertChild && <div onClick={() => { onInsertChild(sel); setOpen(false); }} style={{ padding: "6px 12px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#1E293B", transition: "background .1s" }} onMouseEnter={e => (e.currentTarget.style.background = "#F0FDF4")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>➕ <span>Insert Child</span></div>}
        </div>
      )}
    </div>
  );
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
  const sortNodes = (nodes: _TaskNode[]) => {
    const sortedTasks = sortTasksForHierarchyDisplay(nodes.map((n) => n.task));
    const position = new Map(sortedTasks.map((task, index) => [task.id, index]));
    nodes.sort((a, b) => (position.get(a.task.id) ?? 0) - (position.get(b.task.id) ?? 0));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);

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

function NativeGanttChart({ tasks, selectedTaskId, onSelectTask, selectedIds, toggleSelect, links: _links, onEditTask, onInsertAbove, onInsertBelow, onInsertChild }: NativeGanttChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("autofit");
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [tooltip, setTooltip] = useState<TooltipData>({ task: {} as GanttTask, x: 0, y: 0, visible: false });
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = useCallback((task: GanttTask, e: React.MouseEvent) => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let x = rect.left + rect.width / 2 + 12;
    let y = rect.top - 10;
    /* Prevent overflow */
    if (x + 260 > window.innerWidth) x = rect.left - 270;
    if (y < 0) y = rect.bottom + 10;
    setTooltip({ task, x, y, visible: true });
  }, []);
  const hideTooltip = useCallback(() => {
    tooltipTimerRef.current = setTimeout(() => setTooltip(prev => ({ ...prev, visible: false })), 150);
  }, []);

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
              const { task, level, hasChildren, plannedLeft, plannedWidth, actualLeft, actualWidth, isDelayed, isMilestone, isAutoPopulated } = row;
              const _isParent = hasChildren;
              const top = headerHeight + idx * rowHeight;
              const isSelected = selectedTaskId === task.id || selectedIds.has(task.id);
              return (
                <div key={task.id} onClick={(e) => toggleSelect(task.id, e.ctrlKey || e.metaKey, e.shiftKey)} onDoubleClick={() => onEditTask(task)}
                  style={{ position: "absolute", left: 0, top, width: "100%", height: rowHeight, background: isSelected ? "rgba(219,234,254,0.5)" : "transparent", cursor: "pointer", zIndex: 0 }}>
                  {isMilestone ? (
                    <div
                      style={{ position: "absolute", left: (actualLeft ?? plannedLeft ?? 0) - 6, top: rowHeight / 2 - 6, zIndex: 2, transition: "left 0.25s ease-out", cursor: "pointer" }}
                      onMouseEnter={e => showTooltip(task, e)} onMouseLeave={hideTooltip} onTouchStart={e => showTooltip(task, e as any)}
                    >
                      <div style={{ width: 12, height: 12, background: "#7C3AED", transform: "rotate(45deg)", borderRadius: 2, boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                    </div>
                  ) : _isParent ? (
                    /* PARENT BAR — Planned bracket (navy) + Actual execution (green) + Variance (red tail) */
                    <>
                      {/* ── PLANNED summary bracket ── */}
                      {plannedLeft !== null && plannedWidth !== null && (
                        <div
                          style={{ position: "absolute", left: plannedLeft, top: rowHeight / 2 - 3, zIndex: 2, transition: "left 0.25s ease-out, width 0.25s ease-out", cursor: "pointer" }}
                          onMouseEnter={e => showTooltip(task, e)} onMouseLeave={hideTooltip} onTouchStart={e => showTooltip(task, e as any)}
                        >
                          <div style={{ position: "relative", width: Math.max(plannedWidth, 4), height: 3, background: "#1E3A8F" }}>
                            {/* Left bracket triangle */}
                            <svg width="7" height="7" viewBox="0 0 7 7" style={{ position: "absolute", left: -3, top: -2 }}>
                              <polygon points="0,0 6,0 3,6" fill="#1E3A8F" />
                            </svg>
                            {/* Right bracket triangle */}
                            <svg width="7" height="7" viewBox="0 0 7 7" style={{ position: "absolute", right: -3, top: -2 }}>
                              <polygon points="0,0 6,0 3,6" fill="#1E3A8F" />
                            </svg>
                          </div>
                        </div>
                      )}
                      {/* ── ACTUAL execution bar (below planned bracket) ── */}
                      {actualLeft !== null && actualWidth !== null && actualWidth > 0 && (
                        <>
                          <div
                            style={{ position: "absolute", left: actualLeft, top: rowHeight / 2 + 3, zIndex: 3, transition: "left 0.25s ease-out, width 0.25s ease-out", cursor: "pointer" }}
                            onMouseEnter={e => showTooltip(task, e)} onMouseLeave={hideTooltip} onTouchStart={e => showTooltip(task, e as any)}
                          >
                            {/* Green actual execution line */}
                            <div style={{ position: "relative", width: Math.max(actualWidth, 2), height: 3, background: "#15803D" }}>
                              {/* Actual start marker */}
                              <svg width="5" height="5" viewBox="0 0 5 5" style={{ position: "absolute", left: -2, top: -1 }}>
                                <polygon points="0,0 4,0 2,4" fill="#15803D" />
                              </svg>
                              {/* Actual end marker */}
                              <svg width="5" height="5" viewBox="0 0 5 5" style={{ position: "absolute", right: -2, top: -1 }}>
                                <polygon points="0,0 4,0 2,4" fill="#15803D" />
                              </svg>
                              {/* Progress % label (compact, only if bar is wide enough) */}
                              {actualWidth > 50 && (
                                <span style={{ position: "absolute", left: "50%", top: -10, transform: "translateX(-50%)", fontSize: 7, fontWeight: 700, color: "#15803D", whiteSpace: "nowrap", background: "rgba(255,255,255,0.85)", padding: "0 2px", borderRadius: 2, lineHeight: 1.2 }}>
                                  {normProgress(task.progress)}%
                                </span>
                              )}
                            </div>
                          </div>
                          {/* ── VARIANCE: subtle red tail when actual exceeds planned ── */}
                          {(() => {
                            const pEndPx = plannedLeft !== null && plannedWidth !== null ? plannedLeft + plannedWidth : 0;
                            const aEndPx = actualLeft! + actualWidth!;
                            if (aEndPx > pEndPx + 2) {
                              return (
                                <div
                                  style={{ position: "absolute", left: pEndPx, top: rowHeight / 2 + 3, width: aEndPx - pEndPx, height: 3, zIndex: 4, background: "repeating-linear-gradient(90deg, #DC2626 0px, #DC2626 3px, transparent 3px, transparent 6px)", opacity: 0.6 }}
                                  title="Actual exceeds planned"
                                />
                              );
                            }
                            return null;
                          })()}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {plannedLeft !== null && plannedWidth !== null && (
                        <div
                          style={{ position: "absolute", left: plannedLeft, top: 4, height: 14, zIndex: 1, transition: "left 0.25s ease-out, width 0.25s ease-out", cursor: "pointer" }}
                          onMouseEnter={e => showTooltip(task, e)} onMouseLeave={hideTooltip} onTouchStart={e => showTooltip(task, e as any)}
                        >
                          <div style={{ width: Math.max(plannedWidth, 2), height: 14, background: "rgba(147,197,253,0.35)", border: "1px dashed #60A5FA", borderRadius: 2, position: "relative" }}>
                            {plannedWidth > 40 && <span style={{ position: "absolute", left: 3, top: "50%", transform: "translateY(-50%)", fontSize: 7, fontWeight: 600, color: "#3B82F6", whiteSpace: "nowrap" }}>Planned</span>}
                          </div>
                        </div>
                      )}
                      {actualLeft !== null && actualWidth !== null ? (
                        <div
                          style={{ position: "absolute", left: actualLeft, top: 18, height: 14, zIndex: 2, transition: "left 0.25s ease-out, width 0.25s ease-out", cursor: "pointer" }}
                          onMouseEnter={e => showTooltip(task, e)} onMouseLeave={hideTooltip} onTouchStart={e => showTooltip(task, e as any)}
                        >
                          <div style={{ width: Math.max(actualWidth, 2), height: 14, background: isDelayed ? "rgba(252,165,165,0.5)" : isAutoPopulated ? "repeating-linear-gradient(90deg, rgba(245,158,11,0.25) 0px, rgba(245,158,11,0.25) 4px, rgba(251,191,36,0.4) 4px, rgba(251,191,36,0.4) 8px)" : "rgba(134,239,172,0.5)", border: `1px solid ${isDelayed ? "#F87171" : isAutoPopulated ? "#F59E0B" : "#4ADE80"}`, borderRadius: 2, position: "relative" }}>
                            {actualWidth > 40 && <span style={{ position: "absolute", left: 3, top: "50%", transform: "translateY(-50%)", fontSize: 7, fontWeight: 600, color: isDelayed ? "#DC2626" : isAutoPopulated ? "#B45309" : "#15803D", whiteSpace: "nowrap" }}>{isDelayed ? "Delayed" : isAutoPopulated ? "In Progress" : `${normProgress(task.progress)}%`}</span>}
                          </div>
                        </div>
                      ) : plannedLeft !== null && <div style={{ position: "absolute", left: plannedLeft, top: 18, zIndex: 1, transition: "left 0.25s ease-out" }}><span style={{ fontSize: 7, color: "#CBD5E1", fontStyle: "italic" }}>No actual yet</span></div>}
                    </>
                  )}
                  {(!isMilestone && !_isParent) && plannedLeft === null && actualLeft === null && <div style={{ position: "absolute", left: 8, top: 14, zIndex: 5 }}><span style={{ fontSize: 8, color: "#94A3B8", fontStyle: "italic" }}>No dates</span></div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tooltip — follows mouse over any bar */}
      <GanttTooltip data={tooltip} />
    </div>
  );
}

interface TaskListTabProps {
  tasks: any[];
  allTasks: any[];
  saveTask: any;
  deleteTask: any;
  setBanner: (b: { type: "error" | "success" | "info"; message: string } | null) => void;
  onEditTask: (task: any) => void;
  onAddTask: () => void;
  onMoveUp?: () => void; onMoveDown?: () => void;
  moveUpDisabled?: boolean; moveDownDisabled?: boolean; moveDisabledReason?: string;
  selectedTaskId?: number | null;
  onSelectTask?: (id: number) => void;
  setTaskList: React.Dispatch<React.SetStateAction<any[]>>;
  links?: any[];
}

const GRID_COLS = [
  { key: "text", label: "Task Name", w: 200, type: "text" },
  { key: "owner", label: "Owner", w: 90, type: "text" },
  { key: "parent", label: "Parent", w: 130, type: "parent" },
  { key: "predecessor", label: "Predecessor", w: 130, type: "predecessor" },
  { key: "depType", label: "Rel", w: 65, type: "dependencyType" },
  { key: "lagDays", label: "Lag", w: 55, type: "number" },
  { key: "plannedStart", label: "Planned Start", w: 110, type: "date" },
  { key: "plannedEnd", label: "Planned End", w: 110, type: "date" },
  { key: "actualStart", label: "Actual Start", w: 110, type: "date" },
  { key: "actualEnd", label: "Actual End", w: 110, type: "date" },
  { key: "duration", label: "Dur", w: 45, type: "number" },
  { key: "progress", label: "%", w: 45, type: "number" },
  { key: "status", label: "Status", w: 110, type: "status" },
  { key: "type", label: "Type", w: 70, type: "text" },
  { key: "notes", label: "Notes", w: 140, type: "text" },
];
const STATUS_OPTS = ["Not Started", "In Progress", "In Progress (Delayed)", "Completed", "Overdue", "Delayed", "Planned"];
const CALC_FIELDS = ["plannedStart", "plannedEnd", "actualStart", "actualEnd", "duration", "progress"];

function TaskListTab({ tasks, allTasks, saveTask, deleteTask, setBanner, onEditTask, onAddTask, onMoveUp, onMoveDown, moveUpDisabled, moveDownDisabled, moveDisabledReason, selectedTaskId, onSelectTask, setTaskList, links = [] }: TaskListTabProps) {
  const displayTasks = useMemo(() => sortTasksForHierarchyDisplay(tasks), [tasks]);
  const [editing, setEditing] = useState<{ rowId: number; colKey: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const inpRef = useRef<any>(null);
  useEffect(() => { if (editing) { setTimeout(() => { inpRef.current?.focus(); inpRef.current?.select?.(); }, 0); } }, [editing]);

  const isParentR = (t: any) => isParent(t.id, allTasks);
  const isReadOnly = (t: any, ck: string) => isParentR(t) && CALC_FIELDS.includes(ck);

  const getVal = (t: any, ck: string) => {
    if (ck === "parent") return String(t.parent ?? t.parentTaskId ?? 0);
    if (ck === "predecessor") return String(t.predecessorTaskId ?? t.predecessor_task_id ?? t.predecessorId ?? 0);
    if (ck === "depType") return normalizeDependencyType(t.dependencyType ?? t.dependency_type ?? (t.predecessorTaskId || t.predecessor_task_id ? "FS" : "NONE"));
    if (ck === "lagDays") return String(t.lagDays ?? t.lag_days ?? 0);
    return t[ck] ?? "";
  };

  const beginEdit = (t: any, col: any) => {
    if (isReadOnly(t, col.key)) return;
    setEditing({ rowId: t.id, colKey: col.key });
    setEditVal(getVal(t, col.key));
  };

  const applyTaskListDateMath = (task: any, colKey: string, nextVal: any) => {
    const nextTask = { ...task, [colKey]: nextVal };
    const safeDuration = Math.max(1, Number(nextTask.duration) || 1);
    nextTask.duration = safeDuration;

    const startKeys: Array<"plannedStart" | "actualStart"> = ["plannedStart", "actualStart"];
    const endKeyByStart = { plannedStart: "plannedEnd", actualStart: "actualEnd" } as const;

    if (colKey === "duration") {
      for (const startKey of startKeys) {
        const endKey = endKeyByStart[startKey];
        if (nextTask[startKey]) nextTask[endKey] = calcEndFromStartAndDuration(nextTask[startKey], safeDuration);
        else if (nextTask[endKey]) nextTask[startKey] = calcStartFromEndAndDuration(nextTask[endKey], safeDuration);
      }
      return nextTask;
    }

    if (colKey === "plannedStart" || colKey === "plannedEnd") {
      const dur = calcDurationFromDates(nextTask.plannedStart, nextTask.plannedEnd);
      if (dur !== null) nextTask.duration = Math.max(1, dur);
      else if (colKey === "plannedStart" && nextTask.plannedStart && safeDuration > 0) nextTask.plannedEnd = calcEndFromStartAndDuration(nextTask.plannedStart, safeDuration);
      else if (colKey === "plannedEnd" && nextTask.plannedEnd && safeDuration > 0) nextTask.plannedStart = calcStartFromEndAndDuration(nextTask.plannedEnd, safeDuration);
      return nextTask;
    }

    if (colKey === "actualStart" || colKey === "actualEnd") {
      const dur = calcDurationFromDates(nextTask.actualStart, nextTask.actualEnd);
      if (dur !== null) nextTask.duration = Math.max(1, dur);
      else if (colKey === "actualStart" && nextTask.actualStart && safeDuration > 0) nextTask.actualEnd = calcEndFromStartAndDuration(nextTask.actualStart, safeDuration);
      else if (colKey === "actualEnd" && nextTask.actualEnd && safeDuration > 0) nextTask.actualStart = calcStartFromEndAndDuration(nextTask.actualEnd, safeDuration);
      return nextTask;
    }

    return nextTask;
  };

  const doSave = async (t: any, col: any) => {
    if (!editing || editing.rowId !== t.id || editing.colKey !== col.key) return;
    let v: any = editVal;
    if (col.type === "number") { v = parseInt(v) || 0; if (col.key === "progress") v = Math.min(100, Math.max(0, v)); }
    if (col.key === "parent" || col.key === "predecessor") v = parseInt(v) || 0;
    if (col.key === "depType") v = normalizeDependencyType(v);
    /* ── Build partial payload with ONLY the changed field ──
       The backend now does partial merge for UPDATE — only provided
       fields are written; all others are preserved. */
    const payload: any = { id: t.id };
    if (col.key === "text") payload.task_name = v;
    else if (col.key === "owner") payload.owner = v || null;
    else if (col.key === "parent") payload.parent_task_id = v;
    else if (col.key === "predecessor") payload.predecessor_task_id = v || null;
    else if (col.key === "depType") payload.dependency_type = v === "NONE" ? null : v;
    else if (col.key === "lagDays") payload.lag_days = v;
    else if (col.key === "plannedStart") payload.planned_start = v || null;
    else if (col.key === "plannedEnd") payload.planned_finish = v || null;
    else if (col.key === "actualStart") payload.actual_start = v || null;
    else if (col.key === "actualEnd") payload.actual_finish = v || null;
    else if (col.key === "duration") payload.planned_duration = v;
    else if (col.key === "progress") payload.progress_percent = v;
    else if (col.key === "status") payload.status = v || null;
    else if (col.key === "type") { payload.task_type = v; payload.is_milestone = v === "milestone" ? 1 : 0; }
    else if (col.key === "notes") payload.notes = v || null;
    payload.frontend_task_uid = t.frontendTaskUid || t.frontend_task_uid || undefined;
    let updatedTask = applyTaskListDateMath(t, col.key, v);

    const nextPredId = col.key === "predecessor" ? v : (updatedTask.predecessorTaskId ?? updatedTask.predecessor_task_id ?? updatedTask.predecessorId ?? 0);
    const nextDepType = normalizeDependencyType(col.key === "depType" ? v : (updatedTask.dependencyType ?? updatedTask.dependency_type ?? (nextPredId ? "FS" : "NONE")));
    const nextLagDays = col.key === "lagDays" ? v : (updatedTask.lagDays ?? updatedTask.lag_days ?? 0);

    if (["predecessor", "depType", "lagDays", "duration"].includes(col.key)) {
      payload.predecessor_task_id = nextDepType === "NONE" ? null : (nextPredId || null);
      payload.dependency_type = nextDepType === "NONE" ? null : nextDepType;
      payload.lag_days = nextDepType === "NONE" ? 0 : nextLagDays;
      updatedTask = {
        ...updatedTask,
        predecessorTaskId: payload.predecessor_task_id,
        dependencyType: payload.dependency_type,
        lagDays: payload.lag_days,
      };
    }

    if (nextPredId && nextDepType !== "NONE") {
      const linkObjs = links.map((l: any) => ({ source: l.source ?? l.predecessorTaskId, target: l.target ?? l.successorTaskId }));
      if (wouldCreateDependencyCycle(nextPredId, t.id, linkObjs)) {
        setBanner({ type: "error", message: "Dependency cycle blocked. Select a different predecessor." });
        setEditing(null);
        return;
      }
      if (!isParentR(t)) {
        const predecessor = allTasks.find((x: any) => x.id === nextPredId);
        const scheduled = calculateDependencyPlannedDates({ predecessor, successor: { ...updatedTask, duration: updatedTask.duration }, type: nextDepType, lagDays: nextLagDays });
        if (scheduled.skipped) setBanner({ type: "info", message: scheduled.reason });
        else updatedTask = { ...updatedTask, plannedStart: scheduled.plannedStart, plannedEnd: scheduled.plannedEnd, duration: scheduled.duration };
      }
    }

    if (updatedTask.duration !== t.duration) payload.planned_duration = updatedTask.duration;
    if (updatedTask.plannedStart !== t.plannedStart) payload.planned_start = updatedTask.plannedStart || null;
    if (updatedTask.plannedEnd !== t.plannedEnd) payload.planned_finish = updatedTask.plannedEnd || null;
    if (updatedTask.actualStart !== t.actualStart) payload.actual_start = updatedTask.actualStart || null;
    if (updatedTask.actualEnd !== t.actualEnd) payload.actual_finish = updatedTask.actualEnd || null;

    setTaskList(prev => prev.map((row: any) => row.id === t.id ? updatedTask : row));

    try { await saveTask.mutateAsync(payload); setDirty(p => { const n = new Set(p); n.delete(t.id); return n; }); }
    catch (e: any) { setBanner({ type: "error", message: "Save failed: " + e.message }); setTaskList(prev => prev.map((row: any) => row.id === t.id ? t : row)); }
    setEditing(null);
  };

  const onKey = (e: React.KeyboardEvent, t: any, col: any, ci: number, ri: number) => {
    if (e.key === "Enter") { e.preventDefault(); doSave(t, col); }
    else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
    else if (e.key === "Tab") { e.preventDefault(); doSave(t, col); const ni = e.shiftKey ? (ci - 1 + GRID_COLS.length) % GRID_COLS.length : (ci + 1) % GRID_COLS.length; const nr = e.shiftKey ? (ni === GRID_COLS.length - 1 ? ri - 1 : ri) : (ni === 0 ? ri + 1 : ri); if (nr >= 0 && nr < tasks.length) beginEdit(tasks[nr], GRID_COLS[ni]); }
  };

  const renderCell = (t: any, col: any, ci: number, ri: number) => {
    const isEd = editing?.rowId === t.id && editing?.colKey === col.key;
    const isRo = isReadOnly(t, col.key);
    const val = getVal(t, col.key);

    if (isRo) return <span style={{ color: "#94A3B8", fontStyle: "italic" }}>{val || "—"}</span>;
    if (isEd) {
      const inpStyle = { width: "100%", fontSize: 11, padding: "3px 4px", border: "1.5px solid #005BAC", borderRadius: 4, fontFamily: "Inter", boxSizing: "border-box" as const, outline: "none", background: "#fff" };
      if (col.type === "date") return <input ref={inpRef} type="date" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => doSave(t, col)} onKeyDown={e => onKey(e, t, col, ci, ri)} style={inpStyle} />;
      if (col.type === "number") return <input ref={inpRef} type="number" min={col.key === "progress" ? 0 : undefined} max={col.key === "progress" ? 100 : undefined} value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => doSave(t, col)} onKeyDown={e => onKey(e, t, col, ci, ri)} style={inpStyle} />;
      if (col.key === "parent") return (
        <select ref={inpRef} value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => doSave(t, col)} onKeyDown={e => onKey(e, t, col, ci, ri)} style={inpStyle}>
          <option value="0">(Root)</option>
          {allTasks.filter((x: any) => x.id !== t.id).map((x: any) => <option key={x.id} value={x.id}>{(x.taskName ?? x.text ?? `Task ${x.id}`).slice(0, 25)}</option>)}
        </select>
      );
      if (col.key === "predecessor") return (
        <select ref={inpRef} value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => doSave(t, col)} onKeyDown={e => onKey(e, t, col, ci, ri)} style={inpStyle}>
          <option value="0">(None)</option>
          {allTasks.filter((x: any) => x.id !== t.id).map((x: any) => <option key={x.id} value={x.id}>{(x.taskName ?? x.text ?? `Task ${x.id}`).slice(0, 25)}</option>)}
        </select>
      );
      if (col.key === "depType") return (
        <select ref={inpRef} value={editVal || "NONE"} onChange={e => setEditVal(e.target.value)} onBlur={() => doSave(t, col)} onKeyDown={e => onKey(e, t, col, ci, ri)} style={inpStyle}>
          <option value="NONE">None</option>
          <option value="FS">FS</option>
          <option value="SS">SS</option>
          <option value="FF">FF</option>
          <option value="SF">SF</option>
        </select>
      );
      if (col.key === "status") return (
        <select ref={inpRef} value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => doSave(t, col)} onKeyDown={e => onKey(e, t, col, ci, ri)} style={inpStyle}>
          {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      );
      if (col.key === "type") return (
        <select ref={inpRef} value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => doSave(t, col)} onKeyDown={e => onKey(e, t, col, ci, ri)} style={inpStyle}>
          <option value="task">Task</option>
          <option value="milestone">Milestone</option>
          <option value="project">Project</option>
        </select>
      );
      return <input ref={inpRef} type="text" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => doSave(t, col)} onKeyDown={e => onKey(e, t, col, ci, ri)} style={inpStyle} />;
    }

    /* display */
    if (col.key === "status") return <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 10, background: statusBg(val), color: _statusColor(val), fontSize: 9, fontWeight: 600 }}>{rowStatus(t)}</span>;
    if (col.key === "progress") return <span style={{ fontWeight: 700, color: normProgress(val) >= 100 ? "#1F9D55" : "#005BAC" }}>{normProgress(val)}%</span>;
    if (col.key === "parent") { const rt = allTasks.find((x: any) => x.id === (parseInt(val) || 0)); return <span style={{ color: rt ? "#1E293B" : "#94A3B8" }}>{rt ? (rt.taskName ?? rt.text ?? `T${rt.id}`).slice(0, 18) : (val !== "0" && val ? "?" : "—")}</span>; }
    if (col.key === "predecessor") { const rt = allTasks.find((x: any) => x.id === (parseInt(val) || 0)); return <span style={{ color: rt ? "#1E293B" : "#94A3B8" }}>{rt ? (rt.taskName ?? rt.text ?? `T${rt.id}`).slice(0, 18) : (val !== "0" && val ? (t.predecessorName ? t.predecessorName.slice(0, 18) : "?") : "—")}</span>; }
    if (col.key === "depType") return <span style={{ color: val && val !== "NONE" ? "#7C3AED" : "#94A3B8", fontWeight: 700 }}>{val || "NONE"}</span>;
    if (col.key === "lagDays") return <span style={{ color: Number(val) < 0 ? "#DC2626" : Number(val) > 0 ? "#F59E0B" : "#94A3B8" }}>{Number(val) || 0}</span>;
    return <span style={{ color: val ? "#1E293B" : "#94A3B8" }}>{val || "—"}</span>;
  };

  return (
    <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,.08)", border: "1px solid #D6DFE8", overflow: "hidden", display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #D6DFE8", flexShrink: 0 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", margin: 0 }}>Task Grid ({displayTasks.length})</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#8BA3B8" }}>Click cell · Tab navigate · Enter save · Esc cancel</span>
          <button onClick={onMoveUp} disabled={moveUpDisabled} title={moveUpDisabled ? (moveDisabledReason || "Cannot move up") : "Move selected task up within its current parent"} style={{ padding: "5px 9px", background: moveUpDisabled ? "#F1F5F9" : "#E0F2FE", color: moveUpDisabled ? "#94A3B8" : "#0369A1", border: "1px solid #BAE6FD", borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: moveUpDisabled ? "not-allowed" : "pointer", fontFamily: "Inter" }}>↑ Move Up</button>
          <button onClick={onMoveDown} disabled={moveDownDisabled} title={moveDownDisabled ? (moveDisabledReason || "Cannot move down") : "Move selected task down within its current parent"} style={{ padding: "5px 9px", background: moveDownDisabled ? "#F1F5F9" : "#E0F2FE", color: moveDownDisabled ? "#94A3B8" : "#0369A1", border: "1px solid #BAE6FD", borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: moveDownDisabled ? "not-allowed" : "pointer", fontFamily: "Inter" }}>↓ Move Down</button>
          <button onClick={onAddTask} style={{ padding: "5px 10px", background: "#1F9D55", color: "#fff", border: "none", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "Inter", display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add
          </button>
        </div>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: "Inter, sans-serif", tableLayout: "fixed" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            <tr style={{ background: "#F1F5F9", borderBottom: "2px solid #CBD5E1" }}>
              <th style={{ width: 54, minWidth: 54, textAlign: "center", padding: "5px 6px", fontSize: 9, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.4px", borderRight: "1px solid #E2E8F0" }}>Select</th>
              {GRID_COLS.map(col => <th key={col.key} style={{ width: col.w, minWidth: col.w, textAlign: col.type === "number" ? "center" : "left", padding: "5px 6px", fontSize: 9, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.4px", borderRight: "1px solid #E2E8F0" }}>{col.label}</th>)}
              <th style={{ width: 50, minWidth: 50, textAlign: "center", padding: "5px 6px", fontSize: 9, fontWeight: 700, color: "#475569" }}>×</th>
            </tr>
          </thead>
          <tbody>
            {displayTasks.map((t: any, ri: number) => {
              const isP = isParentR(t);
              return (
                <tr key={t.id} style={{ borderBottom: "1px solid #F1F5F9", background: selectedTaskId === t.id ? "#DBEAFE" : isP ? "#EFF6FF" : dirty.has(t.id) ? "#FEF9C3" : "transparent" }}>
                  <td style={{ padding: "3px 5px", textAlign: "center", borderRight: "1px solid #F1F5F9" }}>
                    <button onClick={() => onSelectTask?.(t.id)} title="Select for Move Up/Down" style={{ padding: "2px 6px", fontSize: 9, fontWeight: 700, background: selectedTaskId === t.id ? "#005BAC" : "#EFF6FF", color: selectedTaskId === t.id ? "#fff" : "#005BAC", border: "1px solid #93C5FD", borderRadius: 4, cursor: "pointer" }}>{selectedTaskId === t.id ? "✓" : "Select"}</button>
                  </td>
                  {GRID_COLS.map((col, ci) => (
                    <td key={col.key} onClick={() => beginEdit(t, col)} style={{ padding: "3px 5px", borderRight: "1px solid #F1F5F9", cursor: isReadOnly(t, col.key) ? "default" : "text", overflow: "hidden" }}>
                      {renderCell(t, col, ci, ri)}
                    </td>
                  ))}
                  <td style={{ padding: "3px 5px", textAlign: "center" }}>
                    <button onClick={() => { const name = (t.taskName ?? t.text) || "this task"; if (confirm("Delete " + name + "?")) { deleteTask.mutate({ id: t.id }); setBanner({ type: "success", message: "Deleted" }); } }} style={{ padding: "1px 4px", fontSize: 9, fontWeight: 700, background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 3, cursor: "pointer" }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  /* Export menu state removed — handled by GanttToolbar */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [taskList, setTaskList] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
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
  /* exportMenuRef removed — handled by GanttToolbar */
  const lastSelectedRef = useRef<number | null>(null);

  /* ═══════ SECTION 3: ALL tRPC hooks (THIRD) ═══════ */
  const utils = trpc.useUtils();
  const tasksQuery = trpc.gantt.tasks.useQuery();
  const linksQuery = trpc.gantt.links.useQuery();
  const { refetch: refetchTasks } = tasksQuery;
  const { refetch: refetchLinks } = linksQuery;

  useEffect(() => {
    const err = tasksQuery.error || linksQuery.error;
    if (err) {
      setBanner({ type: "error", message: `Failed to load Gantt data: ${err.message}` });
    }
  }, [tasksQuery.error, linksQuery.error]);

  const saveTaskMut = trpc.gantt.saveTask.useMutation({
    onSuccess: () => {
      utils.gantt.tasks.invalidate();
      /* BUG B FIX: Mark that we just saved. The useEffect below will clear
         the unsaved indicator when fresh data arrives after refetch. */
      lastSavedJsonRef.current = "__JUST_SAVED__";
    },
    onError: (e) => setBanner({ type: "error", message: "Save task failed: " + e.message }),
  });
  const deleteTaskMut = trpc.gantt.deleteTask.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });
  const saveLinkMut = trpc.gantt.saveLink.useMutation({
    onSuccess: () => utils.gantt.links.invalidate(),
    onError: (e: any) => console.error("[saveLink] FAILED:", e.message, e.data),
  });
  const saveLinkByUidMut = trpc.gantt.saveLinkByUid.useMutation({
    onSuccess: () => utils.gantt.links.invalidate(),
    onError: (e: any) => console.error("[saveLinkByUid] FAILED:", e.message, e.data),
  });
  const deleteLinkMut = trpc.gantt.deleteLink.useMutation({
    onSuccess: () => utils.gantt.links.invalidate(),
    onError: (e: any) => console.error("[deleteLink] FAILED:", e.message),
  });
  const saveLinksBatchMut = trpc.gantt.saveLinksBatch.useMutation({
    onSuccess: () => utils.gantt.links.invalidate(),
    onError: (e: any) => console.error("[saveLinksBatch] FAILED:", e.message),
  });
  const reorderTasksMut = trpc.gantt.reorderTasks.useMutation({
    onSuccess: () => utils.gantt.tasks.invalidate(),
    onError: (e: any) => console.error("[reorderTasks] FAILED:", e.message),
  });
  const resetMut = trpc.gantt.resetGantt.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); },
  });
  const migrateMut = trpc.gantt.migrate.useMutation({
    onSuccess: () => { utils.gantt.tasks.invalidate(); utils.gantt.links.invalidate(); setBanner({ type: "success", message: "DB migrated. Refresh the page." }); },
    onError: (e: any) => setBanner({ type: "error", message: "Migrate failed: " + e.message }),
  });
  const seedMut = trpc.gantt.seed.useMutation({
    onSuccess: (data: any) => {
      utils.gantt.tasks.invalidate();
      utils.gantt.links.invalidate();
      if (data?.seeded) {
        setBanner({ type: "success", message: `Demo data loaded: ${data.count || 7} tasks created.` });
      } else if (data?.reason) {
        setBanner({ type: "info", message: `Seed skipped: ${data.reason}. Use Reset DB first if you want fresh demo data.` });
      }
    },
    onError: (e: any) => setBanner({ type: "error", message: "Demo load failed: " + e.message }),
  });

  /* Project save/load hooks */
  const { data: projectsListData } = trpc.ganttProjects.list.useQuery(undefined, { retry: 1 });
  const projectsList = projectsListData?.projects || [];
  const normalizeProjectId = useCallback((value: unknown): number | null => {
    if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) return null;
      const parsed = Number(trimmed);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  }, []);
  const getProjectId = useCallback((projectLike: any): number | null => {
    return normalizeProjectId(projectLike?.id ?? projectLike?.projectId);
  }, [normalizeProjectId]);
  const saveProjectMut = trpc.ganttProjects.save.useMutation({
    onSuccess: async (data) => {
      await utils.ganttProjects.list.invalidate();
      setSaveModal(false);
      setProjectName("");
      setHasUnsavedChanges(false);
      if (data?.id) {
        setCurrentProjectId(data.id);
        setCurrentProjectName(data.name);
      }
    },
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

          /* PASS 1: Create all tasks with parent=0, track old→new ID mapping */
          const idMap = new Map<number, number>(); // oldId → newId
          for (const [idx, t] of parsed.entries()) {
            const result = await saveTaskMut.mutateAsync({
              frontend_task_uid: t.frontendTaskUid || t.frontend_task_uid || generateUid(),
              text: t.text || "", owner: t.owner || null,
              start_date: t.startDate || t.start_date || null,
              end_date: t.endDate || t.end_date || null,
              planned_start: t.plannedStart || t.planned_start || t.plannedStartDate || null,
              planned_finish: t.plannedEnd || t.planned_end || t.plannedEndDate || null,
              duration: t.duration || 1, progress: normProgress(t.progress),
              wbs_level: 1, /* temporary, will update in pass 2 */
              parent: 0, /* temporary, will update in pass 2 */
              type: t.type || "task",
              status: t.status || null, remarks: t.remarks || t.notes || null,
              category: t.category || null, open: t.open ?? 1, sortorder: t.sortorder ?? t.sortOrder ?? t.sort_order ?? idx,
            });
            idMap.set(t.id, result.id);
          }

          /* PASS 2: Update parent references using new IDs */
          const freshTasks = await refetchTasks();
          for (const t of parsed) {
            const newId = idMap.get(t.id);
            const oldParent = t.parent || 0;
            const newParent = oldParent > 0 ? (idMap.get(oldParent) || 0) : 0;
            const wbsLevel = computeWbsLevel(t.id ?? 0, parsed, oldParent);
            if (newId && (newParent !== 0 || oldParent === 0)) {
              await saveTaskMut.mutateAsync({
                id: newId,
                text: t.text || "", owner: t.owner || null,
                start_date: t.startDate || t.start_date || null,
                end_date: t.endDate || t.end_date || null,
                planned_start: t.plannedStart || t.planned_start || null,
                planned_finish: t.plannedEnd || t.planned_end || null,
                duration: t.duration || 1, progress: normProgress(t.progress),
                wbs_level: wbsLevel,
                parent: newParent,
                parent_task_id: newParent,
                type: t.type || "task",
                status: t.status || null, remarks: t.remarks || t.notes || null,
                category: t.category || null, open: t.open ?? 1, sortorder: t.sortorder ?? t.sortOrder ?? t.sort_order ?? 0,
              });
            }
          }

          // Load dependencies from linksData into gantt_dependencies table
          if (data.linksData) {
            try {
              const linksParsed = JSON.parse(data.linksData);
              if (Array.isArray(linksParsed) && linksParsed.length > 0) {
                const depsToSave = linksParsed.map((l: any) => ({
                  source: idMap.get(l.source || l.predecessorTaskId) || l.source,
                  target: idMap.get(l.target || l.successorTaskId) || l.target,
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
          setSelectedTaskId(null);
          setSelectedIds(new Set());
          setEditingId(null);
          setShowAdd(false);
          setForm(EMPTY_FORM);
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
    onError: (e) => {
      const isMissingProject = /project not found/i.test(e.message);
      if (isMissingProject) {
        setBanner({
          type: "info",
          message: "Project could not be opened right now. It was not removed; please retry or refresh.",
        });
        return;
      }
      setBanner({ type: "error", message: "Load failed: " + e.message });
    },
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
        const restoredId = getProjectId(p);
        if (restoredId && p?.name) { setCurrentProjectId(restoredId); setCurrentProjectName(p.name); }
      } catch { /* ignore */ }
    }
  }, [currentProjectId, getProjectId]);

  /* Validate restored project against current server list */
  useEffect(() => {
    if (!currentProjectId || projectsListData === undefined) return;
    const exists = projectsList.some((p: any) => getProjectId(p) === currentProjectId);
    if (!exists) {
      setCurrentProjectId(null);
      setCurrentProjectName("");
      localStorage.removeItem("gantt_current_project");
      setBanner({ type: "info", message: "Your previously selected project was removed, so we cleared it." });
    }
  }, [currentProjectId, projectsListData, projectsList, getProjectId]);

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
    /* BUG B FIX: If we just saved, accept the fresh data as the new baseline */
    if (lastSavedJsonRef.current === "__JUST_SAVED__") {
      lastSavedJsonRef.current = JSON.stringify(tasksQuery.data);
      setHasUnsavedChanges(false);
      return;
    }
    const currentJson = JSON.stringify(tasksQuery.data);
    if (lastSavedJsonRef.current && lastSavedJsonRef.current !== currentJson) { setHasUnsavedChanges(true); }
    else if (!lastSavedJsonRef.current && tasksQuery.data.length > 0) { setHasUnsavedChanges(true); }
    else { setHasUnsavedChanges(false); }
  }, [tasksQuery.data]);

  /* KPI update + taskList sync */
  useEffect(() => {
    if (!tasksQuery.data) return;
    setKpi(calcKpi(tasksQuery.data));
    setTaskList(sortTasksForHierarchyDisplay(tasksQuery.data));
  }, [tasksQuery.data]);

  /* Clear stale selections/editing when refetched hierarchy no longer contains those tasks. */
  useEffect(() => {
    if (!tasksQuery.data) return;
    const liveIds = new Set(tasksQuery.data.map((t: any) => t.id));
    if (selectedTaskId && !liveIds.has(selectedTaskId)) setSelectedTaskId(null);
    setSelectedIds(prev => {
      const next = new Set(Array.from(prev).filter(id => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (editingId && !liveIds.has(editingId)) {
      setEditingId(null);
      setShowAdd(false);
      setForm(EMPTY_FORM);
      setBanner({ type: "info", message: "Selection was cleared because the task hierarchy changed." });
    }
  }, [tasksQuery.data, selectedTaskId, editingId]);

  /* ── BUG #8 FIX: Auto-clear unsaved flag when refetched data matches DB ── */
  useEffect(() => {
    if (!tasksQuery.data || tasksQuery.isFetching) return;
    /* After a successful save mutation, the DB data comes back clean.
       If the current data matches what we last saved, clear the unsaved flag. */
    const currentJson = JSON.stringify(tasksQuery.data);
    if (lastSavedJsonRef.current && lastSavedJsonRef.current === currentJson) {
      setHasUnsavedChanges(false);
    }
  }, [tasksQuery.isFetching]);

  /* Export menu click-outside removed — handled by GanttToolbar */

  const selectedForMove = useMemo(() => {
    if (selectedIds.size > 1) return null;
    if (selectedIds.size === 1) return Array.from(selectedIds)[0];
    return selectedTaskId;
  }, [selectedIds, selectedTaskId]);

  const moveOrderState = useMemo(() => {
    return getSiblingOrderState(tasksQuery.data || [], selectedForMove);
  }, [tasksQuery.data, selectedForMove]);

  const moveDisabledReason = useMemo(() => {
    if (selectedIds.size > 1) return "Move Up/Down is disabled for multi-select. Select one task to avoid crossing hierarchy boundaries.";
    if (!selectedForMove || !moveOrderState.task) return "Select one task to move.";
    return "";
  }, [selectedIds.size, selectedForMove, moveOrderState.task]);

  const canMoveUp = !!selectedForMove && !moveDisabledReason && moveOrderState.index > 0;
  const canMoveDown = !!selectedForMove && !moveDisabledReason && moveOrderState.index >= 0 && moveOrderState.index < moveOrderState.count - 1;

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
        planned_start: dates.plannedStart, planned_finish: dates.plannedEnd,
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
        planned_start: p.plannedStart || null, planned_finish: p.plannedEnd || null,
        duration: p.duration || 1, progress: normProgress(p.progress),
        parent: p.parent || 0, type: p.type || "project",
        status: p.status || null, remarks: p.remarks || null,
        category: (p as any).category || null,
        open: (p as any).open ?? 1, sortorder: (p as any).sortorder ?? 0,
      });
    });
  }, [saveTaskMut]);

  const saveHierarchyState = useCallback(async (nextTasks: any[], touchedParentIds: number[]) => {
    const wbsLevels = computeWbsLevelMap(nextTasks);
    const hierarchyUpdates = nextTasks
      .filter((task: any) => task.__hierarchyDirty || (task.wbs_level ?? task.wbsLevel ?? 0) !== wbsLevels.get(task.id))
      .map((task: any) => ({
        id: task.id,
        parent: task.parent || 0,
        parent_task_id: task.parent || 0,
        wbs_level: wbsLevels.get(task.id) || 1,
      }));

    for (const payload of hierarchyUpdates) {
      await saveTaskMut.mutateAsync(payload);
    }

    const rolled = recalculateParentRollups(nextTasks.map(({ __hierarchyDirty, ...task }: any) => task));
    const changedParents = getChangedParents(rolled, nextTasks);
    for (const parent of changedParents) {
      await saveTaskMut.mutateAsync({
        id: parent.id, text: parent.text, owner: parent.owner || null,
        start_date: parent.startDate || null, end_date: parent.endDate || null,
        planned_start: parent.plannedStart || null, planned_finish: parent.plannedEnd || null,
        duration: parent.duration || 1, progress: normProgress(parent.progress),
        parent: parent.parent || 0, type: parent.type || "project",
        status: parent.status || null, remarks: parent.remarks || null,
        category: (parent as any).category || null,
        open: (parent as any).open ?? 1, sortorder: (parent as any).sortorder ?? 0,
      });
    }

    await utils.gantt.tasks.invalidate();
    const fresh = await refetchTasks();
    setTaskList(fresh.data || []);
    return fresh.data || [];
  }, [saveTaskMut, utils, refetchTasks]);

  const getHierarchySelection = useCallback((): number[] => {
    const chosen = selectedIds.size > 0 ? Array.from(selectedIds) : (selectedTaskId ? [selectedTaskId] : []);
    const order = new Map((tasksQuery.data || []).map((t: any, index: number) => [t.id, index]));
    return chosen.filter(id => order.has(id)).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }, [selectedIds, selectedTaskId, tasksQuery.data]);

  const validateMultiHierarchySelection = useCallback((ids: number[], all: any[]): string | null => {
    for (const id of ids) {
      const ancestors = getAncestorIds(id, all);
      if (ids.some(other => other !== id && ancestors.has(other))) {
        return "Multi-select hierarchy changes cannot include both a parent and its child.";
      }
    }
    return null;
  }, []);

  /* Indent selected task(s): hierarchy only; dependencies are intentionally untouched. */
  const handleIndent = useCallback(async () => {
    if (!tasksQuery.data) return;
    const all = tasksQuery.data;
    const selected = getHierarchySelection();
    if (selected.length === 0) { setBanner({ type: "error", message: "Select a task to indent." }); return; }
    const multiError = validateMultiHierarchySelection(selected, all);
    if (multiError) { setBanner({ type: "error", message: multiError }); return; }

    try {
      let nextTasks = all.map((t: any) => ({ ...t }));
      const touchedParents = new Set<number>();

      if (selected.length === 1) {
        const result = calcIndent(selected[0], nextTasks);
        if (!result) { setBanner({ type: "error", message: "Cannot indent this task. Select a task below a valid parent candidate." }); return; }
        const validation = validateParentAssignment(result.targetTask.id, result.newParent, nextTasks);
        if (!validation.valid) { setBanner({ type: "error", message: validation.message || "Invalid indent." }); return; }
        touchedParents.add(result.oldParentId || 0); touchedParents.add(result.newParent);
        nextTasks = nextTasks.map((task: any) => task.id === result.targetTask.id ? { ...task, parent: result.newParent, __hierarchyDirty: true } : task);
        setExpandedIds(prev => { const n = new Set(prev); n.add(result.newParent); return n; });
        await saveHierarchyState(nextTasks, Array.from(touchedParents).filter(Boolean));
        setBanner({ type: "success", message: `"${result.targetTask.text}" indented under "${result.aboveTask?.text}".` });
        return;
      }

      const selectedTasks = selected.map(id => nextTasks.find((t: any) => t.id === id)).filter(Boolean);
      const parentId = selectedTasks[0]?.parent || 0;
      if (!selectedTasks.every((task: any) => (task.parent || 0) === parentId)) {
        setBanner({ type: "error", message: "Multi-select indent requires tasks with the same current parent." });
        return;
      }
      const firstIndex = nextTasks.findIndex((t: any) => t.id === selected[0]);
      const newParentTask = firstIndex > 0 ? nextTasks[firstIndex - 1] : null;
      if (!newParentTask || selected.includes(newParentTask.id) || (newParentTask.parent || 0) !== parentId) {
        setBanner({ type: "error", message: "Multi-select indent requires an unselected sibling immediately above the selection." });
        return;
      }
      for (const taskId of selected) {
        const validation = validateParentAssignment(taskId, newParentTask.id, nextTasks);
        if (!validation.valid) { setBanner({ type: "error", message: validation.message || "Invalid indent." }); return; }
      }
      touchedParents.add(parentId); touchedParents.add(newParentTask.id);
      nextTasks = nextTasks.map((task: any) => selected.includes(task.id) ? { ...task, parent: newParentTask.id, __hierarchyDirty: true } : task);
      setExpandedIds(prev => { const n = new Set(prev); n.add(newParentTask.id); return n; });
      await saveHierarchyState(nextTasks, Array.from(touchedParents).filter(Boolean));
      setBanner({ type: "success", message: `${selected.length} task(s) indented under "${newParentTask.text}".` });
    } catch (e: any) {
      setBanner({ type: "error", message: "Indent failed: " + (e?.message || "Unknown error") });
    }
  }, [tasksQuery.data, getHierarchySelection, validateMultiHierarchySelection, saveHierarchyState]);

  /* Outdent selected task(s): hierarchy only; dependencies are intentionally untouched. */
  const handleOutdent = useCallback(async () => {
    if (!tasksQuery.data) return;
    const all = tasksQuery.data;
    const selected = getHierarchySelection();
    if (selected.length === 0) { setBanner({ type: "error", message: "Select a task to outdent." }); return; }
    const multiError = validateMultiHierarchySelection(selected, all);
    if (multiError) { setBanner({ type: "error", message: multiError }); return; }

    try {
      let nextTasks = all.map((t: any) => ({ ...t }));
      const selectedTasks = selected.map(id => nextTasks.find((t: any) => t.id === id)).filter(Boolean);
      if (selectedTasks.some((task: any) => !task.parent)) {
        setBanner({ type: "error", message: "Cannot outdent root-level task(s)." });
        return;
      }
      if (selected.length > 1) {
        const parentId = selectedTasks[0]?.parent || 0;
        if (!selectedTasks.every((task: any) => (task.parent || 0) === parentId)) {
          setBanner({ type: "error", message: "Multi-select outdent requires tasks with the same current parent." });
          return;
        }
      }

      const touchedParents = new Set<number>();
      for (const taskId of selected) {
        const result = calcOutdent(taskId, nextTasks);
        if (!result) { setBanner({ type: "error", message: "Cannot outdent root-level task(s)." }); return; }
        const validation = validateParentAssignment(result.targetTask.id, result.newParent, nextTasks);
        if (!validation.valid) { setBanner({ type: "error", message: validation.message || "Invalid outdent." }); return; }
        touchedParents.add(result.oldParentId || 0); touchedParents.add(result.newParent);
        nextTasks = nextTasks.map((task: any) => task.id === result.targetTask.id ? { ...task, parent: result.newParent, __hierarchyDirty: true } : task);
      }
      await saveHierarchyState(nextTasks, Array.from(touchedParents).filter(Boolean));
      setBanner({ type: "success", message: selected.length === 1 ? `"${selectedTasks[0].text}" outdented.` : `${selected.length} task(s) outdented.` });
    } catch (e: any) {
      setBanner({ type: "error", message: "Outdent failed: " + (e?.message || "Unknown error") });
    }
  }, [tasksQuery.data, getHierarchySelection, validateMultiHierarchySelection, saveHierarchyState]);

  /* Save project (update existing) */
  const handleSave = useCallback(async () => {
    const currentTasks = tasksQuery.data || [];
    if (currentTasks.length === 0) { setBanner({ type: "error", message: "No tasks to save." }); return; }
    if (currentProjectId == null) { setSaveMode("new"); setProjectName(importSourceName); setSaveModal(true); return; }
    const tasksJson = JSON.stringify(currentTasks);
    const linksJson = linksQuery.data ? JSON.stringify(linksQuery.data) : "";
    try {
      const saved = await saveProjectMut.mutateAsync(
        { id: currentProjectId, name: currentProjectName, tasksData: tasksJson, linksData: linksJson || "", description: `${currentTasks.length} tasks` }
      );
      if (!saved?.id) throw new Error("No project ID returned from save");
      setCurrentProjectId(saved.id);
      setCurrentProjectName(saved.name);
      setHasUnsavedChanges(false);
      lastSavedJsonRef.current = tasksJson;
      setBanner({ type: "success", message: `"${saved.name}" saved.` });
    } catch (e: any) {
      setBanner({ type: "error", message: "Save failed: " + (e?.message || "Unknown error") });
    }
  }, [currentProjectId, currentProjectName, tasksQuery.data, linksQuery.data, saveProjectMut, importSourceName]);

  /* Save As (always show modal) */
  const handleSaveAs = useCallback(() => {
    setSaveMode("as");
    setProjectName(currentProjectName ? currentProjectName + " Copy" : "");
    setSaveModal(true);
  }, [currentProjectName]);

  /* Execute save from modal */
  const handleSaveProject = useCallback(async () => {
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
          try {
            const saved = await saveProjectMut.mutateAsync(
              { id: existing.id, name, tasksData: tasksJson, linksData: linksJson || "", description: `${currentTasks.length} tasks` }
            );
            if (!saved?.id) throw new Error("No project ID returned from save");
            setCurrentProjectId(saved.id);
            setCurrentProjectName(saved.name);
            setHasUnsavedChanges(false);
            setImportSourceName("");
            lastSavedJsonRef.current = tasksJson;
            setBanner({ type: "success", message: `"${saved.name}" replaced.` });
            return;
          } catch (e: any) {
            setBanner({ type: "error", message: "Save failed: " + (e?.message || "Unknown error") });
            return;
          }
        }
      }
    }
    const tasksJson = JSON.stringify(currentTasks);
    const linksJson = linksQuery.data ? JSON.stringify(linksQuery.data) : "";
    try {
      const data: any = await saveProjectMut.mutateAsync(
        { name, tasksData: tasksJson, linksData: linksJson || "", description: `${currentTasks.length} tasks` }
      );
      if (!data?.id) throw new Error("No project ID returned from save");
      setCurrentProjectId(data.id);
      setCurrentProjectName(data.name);
      setHasUnsavedChanges(false);
      setImportSourceName("");
      lastSavedJsonRef.current = tasksJson;
      setBanner({ type: "success", message: `"${data.name}" saved.` });
    } catch (e: any) {
      setBanner({ type: "error", message: "Save failed: " + (e?.message || "Unknown error") });
    }
  }, [projectName, saveMode, tasksQuery.data, linksQuery.data, saveProjectMut, projectsList, currentProjectName]);

  /* Close project */
  const handleClose = useCallback(async () => {
    const currentTasks = tasksQuery.data || [];
    const currentLinks = linksQuery.data || [];
    const hasSessionData = currentTasks.length > 0 || currentLinks.length > 0 || currentProjectId !== null || !!currentProjectName || !!importSourceName;
    const shouldConfirmDiscard = hasUnsavedChanges || (currentProjectId === null && (currentTasks.length > 0 || currentLinks.length > 0));

    if (shouldConfirmDiscard && !window.confirm("Discard unsaved changes?")) return;

    setSaveModal(false);
    setLoadModal(false);
    setRenamingId(null);
    setRenameValue("");
    setCurrentProjectId(null);
    setCurrentProjectName("");
    setProjectName("");
    setImportSourceName("");
    setHasUnsavedChanges(false);
    lastSavedJsonRef.current = "";
    localStorage.removeItem("gantt_current_project");

    setSelectedTaskId(null);
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    lastSelectedRef.current = null;
    setMultiSelectMode(false);
    setEditingId(null);
    setShowAdd(false);
    setForm(EMPTY_FORM);
    setTaskList([]);
    setActiveTab("gantt");
    setLinkModalOpen(false);
    setLinkType("0");
    setLinkLag(0);
    setDepEditorOpen(false);
    setDepEditorTask(null);
    setKpi({ totalTasks: 0, completed: 0, inProgress: 0, overdue: 0, completionRate: 0, avgDuration: 0 });

    if (!hasSessionData) {
      setBanner({ type: "info", message: "Project closed." });
      return;
    }

    setBanner({ type: "info", message: "Project closed — clearing data..." });
    try {
      await resetMut.mutateAsync(undefined);
      await utils.gantt.tasks.invalidate();
      await utils.gantt.links.invalidate();
      setBanner({ type: "info", message: "Project closed." });
    } catch (e) { setBanner({ type: "error", message: "Close failed — refresh the page." }); }
  }, [currentProjectId, currentProjectName, hasUnsavedChanges, importSourceName, linksQuery.data, resetMut, tasksQuery.data, utils]);

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

  const moveSelectedTask = useCallback(async (direction: "up" | "down") => {
    if (selectedIds.size > 1) {
      setBanner({ type: "info", message: "Move Up/Down is disabled for multi-select. Select one task to keep hierarchy and parent assignments safe." });
      return;
    }
    const selected = selectedIds.size === 1 ? Array.from(selectedIds)[0] : selectedTaskId;
    if (!selected) { setBanner({ type: "info", message: "Select one task to move." }); return; }

    const liveTasks = tasksQuery.data || [];
    console.debug("[Gantt reorder] before sibling order", getSiblingOrderDebug(liveTasks, selected));
    const updates = buildManualHierarchyOrder(liveTasks, selected, direction);
    if (!updates) {
      setBanner({ type: "info", message: direction === "up" ? "Selected task is already first among its siblings." : "Selected task is already last among its siblings." });
      return;
    }

    const updatedSortOrderById = new Map(updates.map((update) => [update.id, update.sort_order]));
    const optimisticTasks = liveTasks.map((task: any) => {
      const nextSortOrder = updatedSortOrderById.get(task.id);
      return {
        ...task,
        sortorder: nextSortOrder ?? task.sortorder,
        sortOrder: nextSortOrder ?? task.sortOrder,
        sort_order: nextSortOrder ?? task.sort_order,
      };
    });
    console.debug("[Gantt reorder] after sibling order", getSiblingOrderDebug(optimisticTasks, selected));
    console.debug("[Gantt reorder] persisted sort_order", updates.map(({ id, sort_order }) => ({ id, sort_order })));

    const originalParents = new Map(liveTasks.map((task: any) => [task.id, getTaskParentId(task)]));
    if (updates.some((item) => originalParents.get(item.id) !== item.parent)) {
      setBanner({ type: "error", message: "Move blocked because it would change a task parent." });
      return;
    }

    try {
      await reorderTasksMut.mutateAsync(updates.map(({ id, sort_order }) => ({ id, sort_order })));
      await utils.gantt.tasks.invalidate();
      const fresh = await refetchTasks();
      const renderedAfterRefetch = sortTasksForHierarchyDisplay(fresh.data || []);
      console.debug("[Gantt reorder] rendered order after refetch", renderedAfterRefetch.map((task: any) => ({
        id: task.id,
        text: task.text ?? task.taskName ?? `Task ${task.id}`,
        parent: getTaskParentId(task),
        sort_order: task.sortorder ?? task.sortOrder ?? task.sort_order,
      })));
      setTaskList(renderedAfterRefetch);
      setSelectedTaskId(selected);
      setSelectedIds(new Set([selected]));
      setHasUnsavedChanges(true);
      setBanner({ type: "success", message: direction === "up" ? "Task moved up within its current parent." : "Task moved down within its current parent." });
    } catch (e: any) {
      setBanner({ type: "error", message: "Move failed: " + (e?.message || "Unknown error") });
    }
  }, [selectedIds, selectedTaskId, tasksQuery.data, reorderTasksMut, utils, refetchTasks]);

  /* ═══════ SECTION 6: PLAIN FUNCTIONS (SIXTH — after all hooks) ═══════ */

  const startEdit = async (t: any) => {
    /* Look up fresh task from taskList by ID — avoid stale data from TaskListTab */
    const freshTask = taskList.find((ft: any) => ft.id === t.id) || t;
    /* Refetch links to get latest dependency data */
    const freshLinks = await refetchLinks();
    const newForm = mapDbRowToForm(freshTask, freshLinks.data || [], taskList);
    /* Validate predecessor ID exists in current task list — clear if stale/deleted */
    if (newForm.predecessorId && !taskList.some((tl: any) => tl.id === newForm.predecessorId)) {
      console.log("[startEdit] clearing stale predecessorId=", newForm.predecessorId);
      newForm.predecessorId = 0;
      newForm.predecessorFrontendUid = "";
      newForm.depType = "NONE";
      newForm.lagDays = 0;
    }
    setEditingId(t.id);
    setForm(newForm);
    setShowAdd(false);
  };
  const startAdd = () => {
    setEditingId(null);
    const newForm = { ...EMPTY_FORM, frontendTaskUid: generateUid() };
    setForm(newForm);
    setShowAdd(true);
  };

  /* ─── INSERT TASK HELPERS ─── */
  const normalizeSortOrder = useCallback(async (tasks: any[]) => {
    /* Sort by current sortorder, then assign sequential integers */
    const sorted = [...tasks].sort((a, b) => (a.sortorder ?? a.id) - (b.sortorder ?? b.id));
    const reorders = sorted.map((t, i) => ({ id: t.id, sort_order: (i + 1) * 10 }));
    if (reorders.length > 0) {
      try { await reorderTasksMut.mutateAsync(reorders); } catch { /* non-critical */ }
    }
  }, [reorderTasksMut]);

  const insertTaskAbove = useCallback(async (targetTask: any) => {
    const currentTasks = tasksQuery.data || [];
    const targetSort = targetTask.sortorder ?? targetTask.sort_order ?? currentTasks.length * 10;
    const newUid = generateUid();
    const newSort = targetSort - 5; /* insert between */
    const payload = {
      frontend_task_uid: newUid,
      text: "New Task",
      duration: 1, progress: 0,
      sortorder: newSort,
      wbs_level: targetTask.wbs_level ?? targetTask.wbsLevel ?? 0,
      type: "task", parent: targetTask.parent ?? 0,
      parent_frontend_uid: targetTask.parentFrontendUid || targetTask.parent_frontend_uid || null,
      start_date: null, end_date: null,
      planned_start: null, planned_finish: null,
      status: "Not Started",
    };
    try {
      await saveTaskMut.mutateAsync(payload);
      await utils.gantt.tasks.invalidate();
      const fresh = await refetchTasks();
      const freshArr = fresh.data || [];
      setTaskList(freshArr);
      await normalizeSortOrder(freshArr);
      /* Find and edit the new task */
      const newTask = freshArr.find((t: any) => (t.frontendTaskUid || t.frontend_task_uid) === newUid);
      if (newTask) startEdit(newTask);
      else setBanner({ type: "success", message: "Task inserted above." });
    } catch (e: any) { setBanner({ type: "error", message: "Insert failed: " + e.message }); }
  }, [tasksQuery.data, saveTaskMut, utils, refetchTasks, normalizeSortOrder, startEdit]);

  const insertTaskBelow = useCallback(async (targetTask: any) => {
    const currentTasks = tasksQuery.data || [];
    const targetSort = targetTask.sortorder ?? targetTask.sort_order ?? currentTasks.length * 10;
    const newUid = generateUid();
    const newSort = targetSort + 5; /* insert between */
    const payload = {
      frontend_task_uid: newUid,
      text: "New Task",
      duration: 1, progress: 0,
      sortorder: newSort,
      wbs_level: targetTask.wbs_level ?? targetTask.wbsLevel ?? 0,
      type: "task", parent: targetTask.parent ?? 0,
      parent_frontend_uid: targetTask.parentFrontendUid || targetTask.parent_frontend_uid || null,
      start_date: null, end_date: null,
      planned_start: null, planned_finish: null,
      status: "Not Started",
    };
    try {
      await saveTaskMut.mutateAsync(payload);
      await utils.gantt.tasks.invalidate();
      const fresh = await refetchTasks();
      const freshArr = fresh.data || [];
      setTaskList(freshArr);
      await normalizeSortOrder(freshArr);
      const newTask = freshArr.find((t: any) => (t.frontendTaskUid || t.frontend_task_uid) === newUid);
      if (newTask) startEdit(newTask);
      else setBanner({ type: "success", message: "Task inserted below." });
    } catch (e: any) { setBanner({ type: "error", message: "Insert failed: " + e.message }); }
  }, [tasksQuery.data, saveTaskMut, utils, refetchTasks, normalizeSortOrder, startEdit]);

  const insertTaskChild = useCallback(async (targetTask: any) => {
    const currentTasks = tasksQuery.data || [];
    const parentId = targetTask.id;
    const parentUid = targetTask.frontendTaskUid || targetTask.frontend_task_uid || "";
    /* Find max sortorder among existing children */
    const siblings = currentTasks.filter((t: any) => (t.parent ?? 0) === parentId);
    const maxSort = siblings.length > 0
      ? Math.max(...siblings.map((t: any) => t.sortorder ?? t.sort_order ?? 0))
      : (targetTask.sortorder ?? targetTask.sort_order ?? 0);
    const newUid = generateUid();
    const payload = {
      frontend_task_uid: newUid,
      text: "New Subtask",
      duration: 1, progress: 0,
      sortorder: maxSort + 10,
      wbs_level: (targetTask.wbs_level ?? targetTask.wbsLevel ?? 0) + 1,
      type: "task", parent: parentId,
      parent_frontend_uid: parentUid || null,
      start_date: null, end_date: null,
      planned_start: null, planned_finish: null,
      status: "Not Started",
    };
    try {
      await saveTaskMut.mutateAsync(payload);
      await utils.gantt.tasks.invalidate();
      const fresh = await refetchTasks();
      const freshArr = fresh.data || [];
      setTaskList(freshArr);
      await normalizeSortOrder(freshArr);
      /* Auto-expand parent */
      setExpandedIds(prev => { const n = new Set(prev); n.add(parentId); return n; });
      const newTask = freshArr.find((t: any) => (t.frontendTaskUid || t.frontend_task_uid) === newUid);
      if (newTask) startEdit(newTask);
      else setBanner({ type: "success", message: "Child task inserted." });
    } catch (e: any) { setBanner({ type: "error", message: "Insert child failed: " + e.message }); }
  }, [tasksQuery.data, saveTaskMut, utils, refetchTasks, normalizeSortOrder, startEdit]);

  const submitForm = useCallback(async () => {
    if (!form.text.trim()) { setBanner({ type: "error", message: "Task Name is required." }); return; }
    setIsSaving(true);

    /* Capture all form values to locals BEFORE any async work */
    const depIsNone      = form.depType === "NONE";
    const _predecessorId = depIsNone ? 0 : form.predecessorId;
    const _depType       = depIsNone ? null : form.depType;
    const _lagDays       = depIsNone ? 0 : form.lagDays;
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
    /* UID-based identity — stable across saves */
    const _taskUid       = form.frontendTaskUid || generateUid();
    let _parentUid       = form.parentFrontendUid || "";
    let _predUid         = form.predecessorFrontendUid || "";

    /* Fallback: resolve UID from DB ID if UID missing (e.g. task from before UID migration) */
    if (!_parentUid && _parent && taskList) {
      const pTask = taskList.find((t: any) => t.id === _parent);
      if (pTask) _parentUid = pTask.frontendTaskUid || pTask.frontend_task_uid || "";
    }
    if (!_predUid && _predecessorId && taskList) {
      const pTask = taskList.find((t: any) => t.id === _predecessorId);
      if (pTask) _predUid = pTask.frontendTaskUid || pTask.frontend_task_uid || "";
    }

    if (_editingId && _predecessorId && _depType) {
      const linkObjs = (linksQuery.data || []).map((l: any) => ({ source: l.source ?? l.predecessorTaskId, target: l.target ?? l.successorTaskId }));
      if (wouldCreateDependencyCycle(_predecessorId, _editingId, linkObjs)) {
        setIsSaving(false);
        setBanner({ type: "error", message: "Dependency cycle blocked. Select a different predecessor." });
        return;
      }
    }

    const autoStatus = deriveStatus({
      startDate: _actualStart || undefined, endDate: _actualEnd || undefined,
      plannedEnd: _plannedEnd || undefined,
    } as GanttTask);
    const finalStatus = _status || autoStatus;
    /* BUG 7 FIX: Respect user's explicit progress setting. Only force 100% when
       actual end is set AND progress was left at 0 (not explicitly set). */
    let finalProgress = Math.min(100, Math.max(0, _progress));
    if (_actualEnd && _progress === 0 && !_status) finalProgress = 100;

    const allTasks = tasksQuery.data || [];
    if (_editingId && _parent > 0) {
      const validation = validateParentAssignment(_editingId, _parent, allTasks);
      if (!validation.valid) {
        setIsSaving(false);
        setBanner({ type: "error", message: validation.message || "Invalid parent assignment." });
        return;
      }
    }
    const wbsLevel = computeWbsLevel(_editingId ?? 0, allTasks, _parent);

    /* ── PHASE 1: Save task with clean payload ── */
    /* DEBUG: log raw form state */
    console.log("[DEBUG] === FORM STATE ===");
    console.log("[DEBUG] form.text (task name):", JSON.stringify(form.text));
    console.log("[DEBUG] form.plannedStart:", JSON.stringify(form.plannedStart));
    console.log("[DEBUG] form.plannedEnd:", JSON.stringify(form.plannedEnd));
    console.log("[DEBUG] form.owner:", JSON.stringify(form.owner));
    const payload: any = mapFormToPayload(form, _editingId);
    console.log("[DEBUG] payload before overrides:", JSON.stringify(payload, null, 2));
    /* Override with computed values */
    payload.frontend_task_uid = _taskUid;
    payload.status = finalStatus;
    payload.progress_percent = finalProgress;
    payload.wbs_level = wbsLevel;
    payload.parent_task_id = _parent;
    payload.predecessor_task_id = _predecessorId || null;
    payload.dependency_type = _depType || null;
    payload.lag_days = _lagDays;
    console.log("[DEBUG] payload AFTER overrides (sent to API):", JSON.stringify(payload, null, 2));

    let depSaveError: string | null = null;
    try {
      const result = await saveTaskMut.mutateAsync(payload);
      const savedTaskId = _editingId || result?.id;
      console.log("[save] task saved id=", savedTaskId, "uid=", _taskUid);

      /* ── PHASE 2: Refetch to get fresh DB state with resolved IDs ── */
      const [freshTasks, freshLinks] = await Promise.all([refetchTasks(), refetchLinks()]);
      const freshTaskArr = freshTasks.data || [];
      const freshLinkArr = freshLinks.data || [];
      setTaskList(freshTaskArr);

      /* ── PHASE 3: Save dependency ── */
      const succForDelete = freshTaskArr.find((t: any) => (t.frontendTaskUid || t.frontend_task_uid) === _taskUid) || freshTaskArr.find((t: any) => t.id === savedTaskId);
      if (succForDelete) {
        const existing = freshLinkArr.find((l: any) => l.target === succForDelete.id || l.successorTaskId === succForDelete.id);
        if (existing) {
          try { await deleteLinkMut.mutateAsync({ id: existing.id }); } catch { /* ignore */ }
        }
      }

      if ((_predUid || _predecessorId) && _predecessorId !== savedTaskId && _depType) {
        const typeMap: Record<string, string> = { "FS": "0", "SS": "1", "FF": "2", "SF": "3" };
        const typeCode = typeMap[_depType] || "0";

        /* Try UID-based save first, fall back to DB-ID-based save */
        if (_predUid && _predUid !== _taskUid) {
          try {
            await saveLinkByUidMut.mutateAsync({
              sourceUid: _predUid, targetUid: _taskUid,
              type: typeCode, lag: _lagDays,
              projectId: currentProjectId ?? undefined,
            });
            console.log("[save] dependency saved by UID:", _predUid, "→", _taskUid);
          } catch (depErr: any) {
            /* UID save failed — try DB-ID fallback */
            console.warn("[save] UID dep save failed, trying DB-ID fallback:", depErr.message);
            try {
              await saveLinkMut.mutateAsync({
                source: _predecessorId, target: savedTaskId,
                type: typeCode, lag: _lagDays,
                projectId: currentProjectId ?? undefined,
              });
              console.log("[save] dependency saved by DB ID (fallback):", _predecessorId, "→", savedTaskId);
            } catch (fallbackErr: any) {
              depSaveError = fallbackErr.message || "Dependency save failed";
              console.error("[save] DB-ID fallback also failed:", depSaveError);
            }
          }
        } else if (_predecessorId && savedTaskId) {
          /* No UID — use DB-ID-based save directly */
          try {
            await saveLinkMut.mutateAsync({
              source: _predecessorId, target: savedTaskId,
              type: typeCode, lag: _lagDays,
              projectId: currentProjectId ?? undefined,
            });
            console.log("[save] dependency saved by DB ID:", _predecessorId, "→", savedTaskId);
          } catch (depErr: any) {
            depSaveError = depErr.message || "Dependency save failed";
            console.error("[save] DB-ID dep save failed (non-blocking):", depSaveError);
          }
        }
      }

      /* ── PHASE 4: Rebuild form from fresh data ── */
      const savedTask = freshTaskArr.find((t: any) => (t.frontendTaskUid || t.frontend_task_uid) === _taskUid);
      if (savedTask) {
        const newForm = mapDbRowToForm(savedTask, freshLinkArr, freshTaskArr);
        setEditingId(savedTask.id);
        setForm(newForm);
        setShowAdd(false);
      }

      /* ── PHASE 5: Auto-schedule + rollups ── */
      runAutoSchedule(savedTaskId);
      if (_parent > 0) recalcAndSaveParent(_parent, freshTaskArr);

      setBanner({ type: "success", message: `"${_text}" saved.${depSaveError ? " (Dep: " + depSaveError + ")" : ""}` });

    } catch (e: any) {
      console.error("[save] ERROR:", e.message, e);
      setBanner({ type: "error", message: "Save error: " + (e.message || "Unknown error") });
    } finally {
      setIsSaving(false);
    }
  }, [form, editingId, saveTaskMut, saveLinkByUidMut, saveLinkMut, deleteLinkMut, runAutoSchedule, tasksQuery.data, taskList, recalcAndSaveParent, currentProjectId, refetchTasks, refetchLinks, linksQuery.data]);

  const handleImportExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const result = parseImportFile(new Uint8Array(e.target?.result as ArrayBuffer));
      if (!result) { setBanner({ type: "error", message: "No data found in the file." }); return; }
      const { rows } = result;
      let imported = 0; let skipped = 0; const errors: string[] = [];
      const idMap = new Map<number, number>();
      const pendingDeps: Array<{ source: number; target: number; type: string; lag: number; projectId?: number }> = [];
      const depTypeMap: Record<string, string> = { FS: "0", SS: "1", FF: "2", SF: "3", "0": "0", "1": "1", "2": "2", "3": "3" };

      for (const [idx, row] of rows.entries()) {
        const { payload, error } = parseImportRow(row, idx);
        if (error) { errors.push(error); continue; }
        if (!payload) { skipped++; continue; }

        const saved = await saveTaskMut.mutateAsync(payload);
        imported++;

        const rowTaskId = parseInt(String(row["Task ID"] || row["task_id"] || row["id"] || ""), 10);
        if (!Number.isNaN(rowTaskId) && rowTaskId > 0) idMap.set(rowTaskId, saved.id);

        const depRaw = row["Dependency"] || row["dependency"] || row["predecessorId"] || row["predecessor"] || row["Predecessor"] || "";
        const depId = parseInt(String(depRaw), 10);
        if (!Number.isNaN(depId) && depId > 0 && !Number.isNaN(rowTaskId) && rowTaskId > 0) {
          const rawType = String(row["Dependency Type"] || row["dependency_type"] || row["dependencyType"] || row["linkType"] || row["link_type"] || "FS").toUpperCase();
          const depType = depTypeMap[rawType] || "0";
          const lagRaw = row["Lag (days)"] || row["lag"] || row["lagDays"] || row["lag_days"] || 0;
          const lag = parseInt(String(lagRaw), 10) || 0;
          pendingDeps.push({ source: depId, target: rowTaskId, type: depType, lag, projectId: currentProjectId ?? undefined });
        }
      }

      if (pendingDeps.length > 0) {
        const existing = (await refetchLinks()).data || [];
        const existingKeys = new Set(existing.map((l: any) => `${l.source}->${l.target}|${String(l.type || "0")}|${parseInt(String(l.lag || 0), 10) || 0}`));
        const dedup = new Set<string>();
        const depsToSave = pendingDeps
          .map((d) => ({ ...d, source: idMap.get(d.source) || 0, target: idMap.get(d.target) || 0 }))
          .filter((d) => d.source > 0 && d.target > 0)
          .filter((d) => {
            const key = `${d.source}->${d.target}|${d.type}|${d.lag}`;
            if (existingKeys.has(key) || dedup.has(key)) return false;
            dedup.add(key);
            return true;
          });

        if (depsToSave.length > 0) await saveLinksBatchMut.mutateAsync(depsToSave);
      }

      const msg = `Imported ${imported} task(s)` + (skipped > 0 ? `, ${skipped} skipped.` : ".");
      setBanner({ type: errors.length > 0 ? "info" : "success", message: msg + (errors.length > 0 ? ` Warnings: ${errors.join("; ")}` : "") });
      setImportSourceName(file.name.replace(/\.[^.]+$/, ""));
      await utils.gantt.tasks.invalidate();
      await utils.gantt.links.invalidate();
    };
    reader.readAsArrayBuffer(file);
  };

  /* ═══════ SECTION 7: JSX RETURN (LAST) ═══════ */

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#F4F7FA" }}>
      {/* Header + Enterprise Toolbar */}
      <GanttToolbar
        currentProjectId={currentProjectId} currentProjectName={currentProjectName}
        hasUnsavedChanges={hasUnsavedChanges}
        onSave={handleSave} onSaveAs={handleSaveAs} onOpen={handleOpenClick} onClose={handleClose}
        onImport={() => fileInputRef.current?.click()}
        onExportExcel={() => exportExcel(tasksQuery.data || [])}
        onExportCSV={() => exportCSV(tasksQuery.data || [])}
        onExportTemplate={exportTemplate}
        onMigrate={() => migrateMut.mutate()}
        onReset={() => resetMut.mutate()}
        onLoadDemo={() => seedMut.mutate()}
        onIndent={handleIndent} onOutdent={handleOutdent}
        onMoveUp={() => moveSelectedTask("up")} onMoveDown={() => moveSelectedTask("down")}
        moveUpDisabled={!canMoveUp} moveDownDisabled={!canMoveDown} moveDisabledReason={moveDisabledReason}
        onInsertAbove={selectedTaskId ? () => { const t = taskList.find((x: any) => x.id === selectedTaskId); if (t) insertTaskAbove(t); } : undefined}
        onInsertBelow={selectedTaskId ? () => { const t = taskList.find((x: any) => x.id === selectedTaskId); if (t) insertTaskBelow(t); } : undefined}
        onInsertChild={selectedTaskId ? () => { const t = taskList.find((x: any) => x.id === selectedTaskId); if (t) insertTaskChild(t); } : undefined}
        onDelete={selectedTaskId ? () => { const t = taskList.find((x: any) => x.id === selectedTaskId); if (t && confirm(`Delete "${t.text || 'this task'}"?`)) deleteTaskMut.mutate({ id: selectedTaskId }); } : undefined}
        onLink={() => setLinkModalOpen(true)}
        onClear={clearSelection}
        multiSelectMode={multiSelectMode} onToggleMulti={() => setMultiSelectMode(!multiSelectMode)}
        selectedIdsSize={selectedIds.size}
        tasksExist={(tasksQuery.data || []).length > 0}
      />

      {/* Quick Action Bar — sticky below main toolbar */}
      <div className="gantt-quick-action-sticky" style={{ position: "sticky", top: 76, zIndex: 90, background: "#F1F5F9", borderBottom: "1px solid #D6DFE8", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <div className="gantt-page-wrap" style={{ padding: "6px 16px", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <QuickActionBar
          onAdd={startAdd}
          onInsertAbove={selectedTaskId ? () => { const t = taskList.find((x: any) => x.id === selectedTaskId); if (t) insertTaskAbove(t); } : undefined}
          onInsertBelow={selectedTaskId ? () => { const t = taskList.find((x: any) => x.id === selectedTaskId); if (t) insertTaskBelow(t); } : undefined}
          onInsertChild={selectedTaskId ? () => { const t = taskList.find((x: any) => x.id === selectedTaskId); if (t) insertTaskChild(t); } : undefined}
          onIndent={handleIndent} onOutdent={handleOutdent}
          onMoveUp={() => moveSelectedTask("up")} onMoveDown={() => moveSelectedTask("down")}
          moveUpDisabled={!canMoveUp} moveDownDisabled={!canMoveDown} moveDisabledReason={moveDisabledReason}
          onDelete={selectedTaskId ? () => { const t = taskList.find((x: any) => x.id === selectedTaskId); if (t && confirm(`Delete "${t.text || 'this task'}"?`)) deleteTaskMut.mutate({ id: selectedTaskId }); } : undefined}
          onMulti={() => setMultiSelectMode(!multiSelectMode)} multiSelectMode={multiSelectMode}
          onClear={clearSelection} selectionSize={selectedIds.size}
          onLink={() => setLinkModalOpen(true)}
          onSave={handleSave}
          selectedTaskId={selectedTaskId}
          selectedTaskName={selectedTaskId ? taskList.find((t: any) => t.id === selectedTaskId)?.text?.slice(0, 22) || undefined : undefined}
        />
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleImportExcel(e.target.files[0]); }} />

      {/* Banner */}
      {banner && <div className="gantt-banner-wrap"><Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} /></div>}

      {/* KPI Cards */}
      <div className="gantt-page-wrap gantt-kpi-wrap" style={{ padding: "8px 16px 0", maxWidth: 1600, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
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
          <div style={{ marginTop: 8 }}>
            <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)", border: "1px solid #D6DFE8", overflow: "hidden" }}>
              <NativeGanttChart tasks={sortTasksForHierarchyDisplay((tasksQuery.data || []) as GanttTask[])} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} selectedIds={selectedIds} toggleSelect={toggleSelect} links={linksQuery.data || []} onEditTask={startEdit} onInsertAbove={insertTaskAbove} onInsertBelow={insertTaskBelow} onInsertChild={insertTaskChild} />
            </div>
          </div>
        )}
        {activeTab === "tasks" && <TaskListTab tasks={taskList} allTasks={tasksQuery.data || []} saveTask={saveTaskMut} deleteTask={deleteTaskMut} setBanner={setBanner} onEditTask={startEdit} onAddTask={startAdd} onMoveUp={() => moveSelectedTask("up")} onMoveDown={() => moveSelectedTask("down")} moveUpDisabled={!canMoveUp} moveDownDisabled={!canMoveDown} moveDisabledReason={moveDisabledReason} selectedTaskId={selectedForMove} onSelectTask={(id) => { setSelectedTaskId(id); setSelectedIds(new Set([id])); lastSelectedRef.current = id; }} setTaskList={setTaskList} links={linksQuery.data || []} />}
        {activeTab === "resources" && <ResourcesTab tasks={tasksQuery.data || []} />}

        {/* Task Edit/Add Modal */}
        {(showAdd || editingId) && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "Inter, sans-serif" }}
            onClick={(e) => { if (e.target === e.currentTarget) { setEditingId(null); setShowAdd(false); } }}
          >
            {(() => {
              const editingTask = editingId ? taskList.find((t: any) => t.id === editingId) : null;
              const editingIsParent = editingTask ? isParent(editingTask.id, taskList) : false;
              const applyFormDependencySchedule = (nextForm: TaskForm): TaskForm => {
                if (editingIsParent || nextForm.depType === "NONE" || !nextForm.predecessorId) return nextForm;
                const linkObjs = (linksQuery.data || []).map((l: any) => ({ source: l.source ?? l.predecessorTaskId, target: l.target ?? l.successorTaskId }));
                if (editingId && wouldCreateDependencyCycle(nextForm.predecessorId, editingId, linkObjs)) {
                  setBanner({ type: "error", message: "Dependency cycle blocked. Select a different predecessor." });
                  return { ...nextForm, predecessorId: 0, predecessorFrontendUid: "", depType: "NONE", lagDays: 0 };
                }
                const predecessor = taskList.find((t: any) => t.id === nextForm.predecessorId);
                const scheduled = calculateDependencyPlannedDates({ predecessor, successor: { duration: nextForm.duration, plannedStart: nextForm.plannedStart, plannedEnd: nextForm.plannedEnd }, type: nextForm.depType, lagDays: nextForm.lagDays });
                if (scheduled.skipped) {
                  setBanner({ type: "info", message: scheduled.reason });
                  return nextForm;
                }
                return { ...nextForm, plannedStart: scheduled.plannedStart, plannedEnd: scheduled.plannedEnd, duration: scheduled.duration };
              };
              return (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #D6DFE8", boxShadow: "0 20px 60px rgba(0,0,0,.25)", width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, position: "sticky", top: 0, background: "#fff", padding: "4px 0", zIndex: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#16324F" }}>{editingId ? "Edit Task" : "Add New Task"}</h4>
                  {editingIsParent && <span style={{ fontSize: 9, fontWeight: 700, color: "#1E3A8F", background: "#DBEAFE", padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Summary Task</span>}
                </div>
                <button onClick={() => { setEditingId(null); setShowAdd(false); }} style={{ background: "none", border: "none", fontSize: 22, color: "#94A3B8", cursor: "pointer", lineHeight: 1, padding: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, transition: "background .15s" }} onMouseEnter={e => (e.currentTarget.style.background = "#F1F5F9")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>&times;</button>
              </div>

              {editingIsParent && (
                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: "#1E40AF" }}>
                  <span style={{ fontWeight: 700 }}>Auto-calculated:</span> Start, End, Duration, and Progress are calculated from child tasks.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px 12px" }}>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Task Name *</label><input value={form.text} onChange={e => setForm({...form, text: e.target.value})} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box" }} placeholder="Enter task name" /></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Owner</label><input value={form.owner} onChange={e => setForm({...form, owner: e.target.value})} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box" }} placeholder="Assignee" /></div>

                {/* Dates — disabled for parent tasks */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: editingIsParent ? "#94A3B8" : "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>
                    Planned Start {editingIsParent && <span style={{ fontWeight: 400, fontSize: 9, color: "#94A3B8" }}>(auto)</span>}
                  </label>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input type="date" value={form.plannedStart} onChange={e => setForm(prev => {
                      const plannedStart = e.target.value;
                      const duration = Math.max(1, Number(prev.duration) || 1);
                      const plannedEnd = plannedStart ? calcEndFromStartAndDuration(plannedStart, duration) : prev.plannedEnd;
                      return applyFormDependencySchedule({ ...prev, plannedStart, plannedEnd, duration });
                    })} disabled={editingIsParent} style={{ flex: 1, padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box", background: editingIsParent ? "#F8FAFC" : "#fff", color: editingIsParent ? "#94A3B8" : "#1E293B", cursor: editingIsParent ? "not-allowed" : "text" }} />
                    {!editingIsParent && form.plannedStart && <button onClick={() => setForm({...form, plannedStart: ""})} style={{ padding: "4px 8px", fontSize: 13, lineHeight: 1, background: "#F1F5F9", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer", color: "#64748B" }} title="Clear date">×</button>}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: editingIsParent ? "#94A3B8" : "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>
                    Planned End {editingIsParent && <span style={{ fontWeight: 400, fontSize: 9, color: "#94A3B8" }}>(auto)</span>}
                  </label>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input type="date" value={form.plannedEnd} onChange={e => setForm(prev => {
                      const plannedEnd = e.target.value;
                      const duration = calcDurationFromDates(prev.plannedStart, plannedEnd) ?? Math.max(1, Number(prev.duration) || 1);
                      const plannedStart = plannedEnd && !prev.plannedStart ? calcStartFromEndAndDuration(plannedEnd, duration) : prev.plannedStart;
                      return applyFormDependencySchedule({ ...prev, plannedStart, plannedEnd, duration });
                    })} disabled={editingIsParent} style={{ flex: 1, padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box", background: editingIsParent ? "#F8FAFC" : "#fff", color: editingIsParent ? "#94A3B8" : "#1E293B", cursor: editingIsParent ? "not-allowed" : "text" }} />
                    {!editingIsParent && form.plannedEnd && <button onClick={() => setForm({...form, plannedEnd: ""})} style={{ padding: "4px 8px", fontSize: 13, lineHeight: 1, background: "#F1F5F9", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer", color: "#64748B" }} title="Clear date">×</button>}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: editingIsParent ? "#94A3B8" : "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>
                    Actual Start {editingIsParent && <span style={{ fontWeight: 400, fontSize: 9, color: "#94A3B8" }}>(auto)</span>}
                  </label>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input type="date" value={form.actualStart} onChange={e => setForm(prev => {
                      const actualStart = e.target.value;
                      const duration = Math.max(1, Number(prev.duration) || 1);
                      const actualEnd = prev.actualEnd || (actualStart ? calcEndFromStartAndDuration(actualStart, duration) : "");
                      return { ...prev, actualStart, duration, actualEnd };
                    })} disabled={editingIsParent} style={{ flex: 1, padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box", background: editingIsParent ? "#F8FAFC" : "#fff", color: editingIsParent ? "#94A3B8" : "#1E293B", cursor: editingIsParent ? "not-allowed" : "text" }} />
                    {!editingIsParent && form.actualStart && <button onClick={() => setForm({...form, actualStart: ""})} style={{ padding: "4px 8px", fontSize: 13, lineHeight: 1, background: "#F1F5F9", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer", color: "#64748B" }} title="Clear date">×</button>}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: editingIsParent ? "#94A3B8" : "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>
                    Actual End {editingIsParent && <span style={{ fontWeight: 400, fontSize: 9, color: "#94A3B8" }}>(auto)</span>}
                  </label>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input type="date" value={form.actualEnd} onChange={e => setForm(prev => {
                      const actualEnd = e.target.value;
                      const duration = calcDurationFromDates(prev.actualStart, actualEnd) ?? Math.max(1, Number(prev.duration) || 1);
                      return { ...prev, actualEnd, duration };
                    })} disabled={editingIsParent} style={{ flex: 1, padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box", background: editingIsParent ? "#F8FAFC" : "#fff", color: editingIsParent ? "#94A3B8" : "#1E293B", cursor: editingIsParent ? "not-allowed" : "text" }} />
                    {!editingIsParent && form.actualEnd && <button onClick={() => setForm({...form, actualEnd: ""})} style={{ padding: "4px 8px", fontSize: 13, lineHeight: 1, background: "#F1F5F9", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer", color: "#64748B" }} title="Clear date">×</button>}
                  </div>
                </div>

                {/* Duration + Progress — disabled for parent tasks */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: editingIsParent ? "#94A3B8" : "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>
                    Duration {editingIsParent && <span style={{ fontWeight: 400, fontSize: 9, color: "#94A3B8" }}>(auto)</span>}
                  </label>
                  <input type="number" min={1} value={form.duration} onChange={e => setForm(prev => {
                    const duration = Math.max(1, parseInt(e.target.value) || 1);
                    const plannedEnd = prev.plannedStart ? calcEndFromStartAndDuration(prev.plannedStart, duration) : prev.plannedEnd;
                    const actualEnd = prev.actualStart ? calcEndFromStartAndDuration(prev.actualStart, duration) : prev.actualEnd;
                    return applyFormDependencySchedule({ ...prev, duration, plannedEnd, actualEnd });
                  })} disabled={editingIsParent} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box", background: editingIsParent ? "#F8FAFC" : "#fff", color: editingIsParent ? "#94A3B8" : "#1E293B", cursor: editingIsParent ? "not-allowed" : "text" }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: editingIsParent ? "#94A3B8" : "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>
                    Progress % {editingIsParent && <span style={{ fontWeight: 400, fontSize: 9, color: "#94A3B8" }}>(auto)</span>}
                  </label>
                  <input type="number" min={0} max={100} value={form.progress} onChange={e => setForm({...form, progress: parseInt(e.target.value)||0})} disabled={editingIsParent} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box", background: editingIsParent ? "#F8FAFC" : "#fff", color: editingIsParent ? "#94A3B8" : "#1E293B", cursor: editingIsParent ? "not-allowed" : "text" }} />
                </div>

                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Status</label><select value={form.status} onChange={e => setForm({...form, status: e.target.value})} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box" }}><option value="">Auto</option><option>Not Started</option><option>In Progress</option><option>In Progress (Delayed)</option><option>Completed</option></select></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Type</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box" }}><option value="task">Task</option><option value="milestone">Milestone</option><option value="project">Project</option></select></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Parent</label><select value={form.parent||""} onChange={e => {
  const pid = e.target.value ? parseInt(e.target.value) : 0;
  const pTask = pid ? (taskList||[]).find((t:any)=>t.id===pid) : null;
  setForm({...form, parent: pid, parentFrontendUid: pTask ? (pTask.frontendTaskUid||pTask.frontend_task_uid||"") : ""});
}} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box" }}><option value="">(Root)</option>{(taskList||[]).filter((t:any)=>t.id!==editingId).map((t:any)=><option key={t.id} value={t.id}>{t.text}</option>)}</select></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Remarks</label><input value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box" }} placeholder="Notes..." /></div>
              </div>

              {/* ── Scheduling Dependencies ── */}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>🔗 Scheduling Dependencies</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px 12px" }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Predecessor Task</label>
                    <select value={form.predecessorId || ""} onChange={e => {
                      const pid = e.target.value ? parseInt(e.target.value) : 0;
                      const pTask = pid ? (taskList || []).find((t: any) => t.id === pid) : null;
                      setForm(prev => applyFormDependencySchedule({
                        ...prev,
                        predecessorId: pid,
                        predecessorFrontendUid: pTask ? (pTask.frontendTaskUid || pTask.frontend_task_uid || "") : "",
                        depType: pid ? (prev.depType === "NONE" ? "FS" : prev.depType) : "NONE",
                        lagDays: pid ? prev.lagDays : 0,
                      }));
                    }} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box" }}>
                      <option value="">(None)</option>
                      {(taskList || []).filter((t: any) => t.id !== editingId).map((t: any) => <option key={t.id} value={t.id}>{t.text}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Dependency Type</label>
                    <select value={form.depType} onChange={e => {
                      const nextType = e.target.value;
                      if (nextType === "NONE") {
                        setForm({ ...form, depType: "NONE", predecessorId: 0, predecessorFrontendUid: "", lagDays: 0 });
                        return;
                      }
                      setForm(prev => applyFormDependencySchedule({ ...prev, depType: nextType }));
                    }} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box" }}>
                      <option value="NONE">None</option>
                      <option value="FS">FS — Finish-to-Start</option>
                      <option value="SS">SS — Start-to-Start</option>
                      <option value="FF">FF — Finish-to-Finish</option>
                      <option value="SF">SF — Start-to-Finish</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 3 }}>Lag / Lead (days)</label>
                    <input type="number" value={form.lagDays} onChange={e => setForm(prev => applyFormDependencySchedule({ ...prev, lagDays: parseInt(e.target.value) || 0 }))} disabled={form.depType === "NONE"} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #D6DFE8", borderRadius: 5, fontFamily: "Inter", boxSizing: "border-box", background: form.depType === "NONE" ? "#F8FAFC" : "#fff", color: form.depType === "NONE" ? "#94A3B8" : "#1E293B" }} title="Positive = lag (delay), Negative = lead (overlap)" />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16, paddingTop: 12, borderTop: "1px solid #F1F5F9", justifyContent: "flex-end" }}>
                <button onClick={() => { setEditingId(null); setShowAdd(false); }} style={{ padding: "8px 18px", fontSize: 12, fontWeight: 600, background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 6, cursor: "pointer", fontFamily: "Inter" }}>Cancel</button>
                <button onClick={submitForm} disabled={isSaving} style={{ padding: "8px 22px", fontSize: 12, fontWeight: 600, background: isSaving ? "#86EFAC" : "#1F9D55", color: "#fff", border: "none", borderRadius: 6, cursor: isSaving ? "not-allowed" : "pointer", fontFamily: "Inter", display: "inline-flex", alignItems: "center", gap: 6, transition: "background .15s" }}>
                  {isSaving && <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "ganttSpin 0.6s linear infinite" }} />}
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
            );
            })()}
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
                            <button onClick={() => {
                              if (loadProjectMut.isPending) return;
                              const selectedId = getProjectId(p);
                              if (!selectedId) {
                                setBanner({ type: "error", message: "Cannot open this project because its ID is invalid." });
                                return;
                              }
                              loadProjectMut.mutate({ id: selectedId });
                            }} disabled={loadProjectMut.isPending} title="Load" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", fontSize: 11, fontWeight: 600, background: loadingProjectId === p.id ? "#93C5FD" : "#005BAC", color: "#fff", border: "none", borderRadius: 4, cursor: loadProjectMut.isPending ? "not-allowed" : "pointer", transition: "all .2s", minWidth: 52, justifyContent: "center" }}>
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
      <AIAssistant
        contextType="gantt"
        data={taskList}
        metadata={{ currentProjectId, currentProjectName, source: "live-task-store" }}
        title="Gantt AI"
      />

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
        @keyframes ganttTooltipIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        /* Toolbar responsive */
        .gantt-desktop-toolbar { display: flex; }
        .gantt-mobile-hamburger { display: none !important; }
        .toolbar-label { display: inline; }
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
          /* Toolbar: icon-only mode at 768px */
          .toolbar-label { display: none !important; }
          .gantt-desktop-toolbar { gap: 2px !important; padding: "4px 8px" !important; overflow-x: auto !important; }
        }
        @media (max-width: 540px) {
          /* Only at very small widths: show hamburger, hide desktop bar */
          .gantt-desktop-toolbar { display: none !important; }
          .gantt-mobile-hamburger { display: flex !important; }
        }

        @media (max-width: 540px) {
          .gantt-quick-action-sticky { top: 58px !important; }
          .gantt-quick-action-sticky .gantt-page-wrap { padding: 6px 10px !important; }
          .gantt-quick-actions {
            display: flex !important;
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch;
            gap: 6px !important;
            align-items: center !important;
            padding-bottom: 1px;
          }
          .gantt-quick-actions::-webkit-scrollbar { height: 0; }
          .gantt-quick-actions > button {
            width: auto !important;
            justify-content: center;
            min-height: 28px;
            padding: 4px 9px !important;
            flex: 0 0 auto !important;
          }
          .gantt-quick-actions > span[style*="width: 1px"] {
            display: none !important;
          }
          .gantt-quick-actions > button:disabled {
            display: none !important;
          }
          .gantt-quick-actions > span {
            flex: 0 0 auto;
            margin-right: 0 !important;
            max-width: 120px !important;
          }
          .gantt-banner-wrap { margin-top: 4px; }
          .gantt-kpi-wrap { padding-top: 0 !important; }
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
