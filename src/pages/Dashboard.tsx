import React, { useState, useCallback, useRef, useMemo, Fragment } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

// ── Types ──
const VALID_OPS = ["", "Operator", "AMD in-house", "Outsourced SLA"] as const;
const VALID_FAM = ["", "Fully Familiar", "Partially Familiar", "Requires Guidance", "Not Familiar"] as const;

interface PendingChange {
  taskId: number;
  operations?: string;
  amd?: string;
  ard?: string;
  procedureFamiliarity?: string;
}

interface Banner {
  type: "error" | "success" | "info";
  message: string;
}

interface ImportRejectedRow {
  row: number;
  eq?: string;
  task?: string;
  reason: string;
}

interface ImportResultSummary {
  status: "success" | "error";
  updated: number;
  unchanged: number;
  total: number;
  rejected: ImportRejectedRow[];
  message: string;
}

// ── Helpers ──
function getFreqBadgeClass(f: string) {
  const fl = f.toLowerCase();
  if (fl.includes("daily")) return "bg-green-100 text-green-800";
  if (fl.includes("weekly")) return "bg-blue-100 text-blue-800";
  if (fl.includes("monthly")) return "bg-yellow-100 text-yellow-800";
  if (fl.includes("quarter")) return "bg-purple-100 text-purple-800";
  if (fl.includes("half") || fl.includes("semi")) return "bg-orange-100 text-orange-800";
  if (fl.includes("year") || fl.includes("annual")) return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-600";
}

function getPersBadgeClass(p: string) {
  const pl = p.toLowerCase();
  if (pl.includes("outsourc")) return "bg-gray-200 text-gray-700";
  if (pl.includes("in-house") || pl.includes("in house")) return "bg-blue-50 text-blue-700";
  if (pl.includes("operator")) return "bg-green-100 text-green-700";
  return "bg-gray-100 text-gray-600";
}

function getInitials(n: string) {
  return n.split(/[\s\-\(\[\/]+/).filter((w) => w).map((w) => w[0]).join("").substring(0, 3).toUpperCase();
}

function csvEsc(s: string | null | undefined) {
  if (!s && s !== "0") return "";
  const st = String(s).replace(/"/g, '""');
  if (st.includes(",") || st.includes('"') || st.includes("\n")) return '"' + st + '"';
  return st;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  while (i < text.length) {
    const row: string[] = [];
    while (i < text.length) {
      let val = "";
      if (text[i] === '"') {
        i++;
        while (i < text.length) {
          if (text[i] === '"' && text[i + 1] === '"') { val += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else { val += text[i]; i++; }
        }
      } else {
        while (i < text.length && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") { val += text[i]; i++; }
      }
      row.push(val);
      if (text[i] === ",") { i++; }
      else { break; }
    }
    if (row.length > 0) rows.push(row);
    while (i < text.length && (text[i] === "\n" || text[i] === "\r")) i++;
  }
  return rows;
}

// ── Friendly error message mapper ──
function friendlyError(err: any): string {
  const msg = err?.message || "";
  if (msg.includes("connection")) return "Unable to connect to the server. Please check your network and try again.";
  if (msg.includes("timeout")) return "The server took too long to respond. Please try again.";
  if (msg.includes("column") || msg.includes("does not exist")) return "A database column is missing. The system will auto-recover shortly.";
  if (msg.includes("permission") || msg.includes("unauthorized")) return "You do not have permission to perform this action.";
  if (msg.includes("not found")) return "The requested data was not found.";
  return "Something went wrong. Please refresh the page or try again later.";
}

function normalizeImportHeader(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collectErrorMessages(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || seen.has(value)) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (value instanceof Error) seen.add(value);
  if (typeof value !== "object") return [String(value)];

  seen.add(value);
  const record = value as Record<string, unknown>;
  return [
    typeof record.message === "string" ? record.message : "",
    ...collectErrorMessages(record.error, seen),
    ...collectErrorMessages(record.response, seen),
    ...collectErrorMessages(record.data, seen),
    ...collectErrorMessages(record.cause, seen),
    ...collectErrorMessages(record.json, seen),
  ].filter((msg) => msg.trim());
}


function findImportFailure(value: unknown, seen = new Set<unknown>()): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record.success === false && Array.isArray(record.skipped)) return record;
  return (
    findImportFailure(record.importFailure, seen) ||
    findImportFailure(record.data, seen) ||
    findImportFailure(record.error, seen) ||
    findImportFailure(record.response, seen) ||
    findImportFailure(record.cause, seen) ||
    findImportFailure(record.json, seen)
  );
}

function rejectedRowsFromImportFailure(err: unknown): ImportRejectedRow[] {
  const importFailure = findImportFailure(err);
  const skipped = importFailure?.skipped;
  if (!Array.isArray(skipped)) return [];
  return skipped.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const rowNumber = Number(record.row);
    const reason = typeof record.reason === "string" ? record.reason : "Rejected by import validation";
    return [{
      row: Number.isFinite(rowNumber) ? rowNumber : 0,
      eq: typeof record.eq === "string" ? record.eq : undefined,
      task: typeof record.task === "string" ? record.task : undefined,
      reason,
    }];
  });
}

function parseRejectedRows(message: string): ImportRejectedRow[] {
  return message.split("; ").flatMap((part) => {
    const match = part.match(/Row (\d+) rejected(?: \[(.*?)\])?(?: "(.*?)")?: (.*?)(?:\. Required fix: (.*))?$/);
    if (!match) return [];
    return [{
      row: Number(match[1]),
      eq: match[2],
      task: match[3],
      reason: match[5] ? `${match[4]}. Required fix: ${match[5]}` : match[4],
    }];
  });
}

function importErrorMessage(err: unknown): string {
  const importFailure = findImportFailure(err);
  if (typeof importFailure?.message === "string" && importFailure.message.trim()) return importFailure.message.trim();

  const messages = collectErrorMessages(err);
  const surfaced = messages.find((msg) =>
    msg.startsWith("Import validation failed") ||
    msg.startsWith("Import mapping failed") ||
    msg.startsWith("Import database transaction failed") ||
    msg.startsWith("Unexpected maintenance planning import failure")
  );
  if (surfaced) return surfaced;

  const nested = messages.find((msg) => msg && msg !== "[object Object]");
  if (nested) return nested;

  return friendlyError(err);
}

// ── Inline Banner component ──
function InlineBanner({ type, message, onDismiss }: { type: "error" | "success" | "info"; message: string; onDismiss?: () => void }) {
  const styles = {
    error: "bg-red-50 border-red-200 text-red-800",
    success: "bg-green-50 border-green-200 text-green-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };
  const icons = { error: "⚠️", success: "✅", info: "ℹ️" };
  return (
    <div className={`mb-3 px-4 py-3 border rounded-lg text-sm flex items-center gap-2 ${styles[type]}`}>
      <span>{icons[type]}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"htt" | "aglipay">("htt");
  const [search, setSearch] = useState("");
  const [equipFilter, setEquipFilter] = useState("");
  const [freqFilter, setFreqFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [familiarityFilter, setFamiliarityFilter] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [pending, setPending] = useState<Record<number, Partial<{ operations: string; amd: string; ard: string; procedureFamiliarity: string }>>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<Banner | null>(null);
  const [importProgress, setImportProgress] = useState<{ show: boolean; text: string; sub: string; pct: number } | null>(null);
  const [importSummary, setImportSummary] = useState<ImportResultSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── tRPC Queries ──
  const {
    data: rawData,
    isLoading,
    error: listError,
  } = trpc.tasks.list.useQuery(
    {
      dataset: activeTab,
      search: search || undefined,
      equipFilter: equipFilter || undefined,
      freqFilter: freqFilter || undefined,
      personFilter: personFilter || undefined,
    },
    {
      refetchInterval: 30000,
      staleTime: 0,
      onSuccess: () => setLastSync(new Date()),
      onError: (err) => {
        console.error("[Dashboard] list query error:", err);
        setBanner({ type: "error", message: friendlyError(err) });
      },
    }
  );

  const { data: filtersData } = trpc.tasks.filters.useQuery(
    { dataset: activeTab },
    { refetchInterval: 30000 }
  );

  const { data: famSummary } = trpc.tasks.familiaritySummary.useQuery(
    { dataset: activeTab },
    { refetchInterval: 30000 }
  );

  const { data: stats } = trpc.tasks.stats.useQuery(
    { dataset: activeTab },
    { refetchInterval: 30000 }
  );

  // ── Client-side familiarity filter ──
  const data = useMemo(() => {
    if (!rawData) return rawData;
    if (!familiarityFilter) return rawData;
    const filteredGroups = rawData.groups.map((g) => ({
      ...g,
      tasks: g.tasks.filter((t) => (t as any).procedureFamiliarity === familiarityFilter),
    })).filter((g) => g.tasks.length > 0);
    const totalTasks = filteredGroups.reduce((sum, g) => sum + g.tasks.length, 0);
    return { ...rawData, groups: filteredGroups, totalTasks };
  }, [rawData, familiarityFilter]);

  const bulkUpdateMutation = trpc.tasks.bulkUpdate.useMutation({
    onSuccess: (res) => {
      utils.tasks.list.invalidate();
      utils.tasks.export.invalidate();
      setBanner({ type: "success", message: `${res.updated} changes saved successfully.` });
      setPending({});
      setEditMode(false);
    },
    onError: (err) => {
      console.error("Save failed:", err);
      setBanner({ type: "error", message: "Save failed: " + friendlyError(err) });
    },
  });

  const importMutation = trpc.tasks.import.useMutation({
    onSuccess: (res) => {
      utils.tasks.list.invalidate();
      utils.tasks.export.invalidate();
      const unchanged = res.unchanged ?? res.total - res.updated;
      const message = res.message || `Import complete: ${res.updated} row${res.updated === 1 ? "" : "s"} updated, ${unchanged} unchanged, 0 rows rejected.`;
      setImportSummary({ status: "success", updated: res.updated, unchanged, total: res.total, rejected: [], message });
      setBanner({ type: "success", message });
      setImportProgress(null);
    },
    onError: (err) => {
      const message = importErrorMessage(err);
      const rejected = rejectedRowsFromImportFailure(err);
      const parsedRejected = rejected.length > 0 ? rejected : parseRejectedRows(message);
      console.error("[tasks/import] thrown exception stack", err instanceof Error ? err.stack : err);
      console.error("[tasks/import] mutation error object", err);
      setImportSummary({ status: "error", updated: 0, unchanged: 0, total: 0, rejected: parsedRejected, message });
      setBanner({ type: "error", message: "Import failed: " + message });
      setImportProgress(null);
    },
  });

  // ── Derived state ──
  const totalTasks = data?.totalTasks ?? 0;
  const totalGroups = data?.groups?.length ?? 0;
  const allVisibleSelected = totalTasks > 0 && !!data?.groups?.every((g) => g.tasks?.every((t) => selected.has(t.id)));
  const tabLabel = activeTab === "htt" ? "HTT STP" : "Aglipay STP";

  // ── Callbacks ──
  const toggleGroup = useCallback((name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((taskId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data?.groups) return;
    const allIds = new Set<number>();
    data.groups.forEach((g) => g.tasks?.forEach((t) => allIds.add(t.id)));
    setSelected(allIds);
  }, [data]);

  const deselectAll = useCallback(() => setSelected(new Set()), []);
  const expandAll = useCallback(() => setCollapsedGroups(new Set()), []);
  const collapseAll = useCallback(() => {
    if (!data?.groups) return;
    setCollapsedGroups(new Set(data.groups.map((g) => g.equipment?.name).filter(Boolean) as string[]));
  }, [data]);

  const startEdit = useCallback(() => { setEditMode(true); setPending({}); }, []);
  const cancelEdit = useCallback(() => { setEditMode(false); setPending({}); }, []);

  const saveEdit = useCallback(() => {
    const updates = Object.entries(pending)
      .filter(([, v]) => v.operations !== undefined || v.amd !== undefined || v.ard !== undefined || v.procedureFamiliarity !== undefined)
      .map(([taskId, v]) => ({
        taskId: Number(taskId),
        ...(v.operations !== undefined ? { operations: v.operations || null } : {}),
        ...(v.amd !== undefined ? { amd: v.amd || null } : {}),
        ...(v.ard !== undefined ? { ard: v.ard || null } : {}),
        ...(v.procedureFamiliarity !== undefined ? { procedureFamiliarity: v.procedureFamiliarity || null } : {}),
      }));
    if (updates.length > 0) {
      setPending({});
      setEditMode(false);
      bulkUpdateMutation.mutate(updates);
    } else {
      setEditMode(false);
    }
  }, [pending, bulkUpdateMutation]);

  const onDropdownChange = useCallback((taskId: number, field: string, value: string) => {
    setPending((prev) => ({ ...prev, [taskId]: { ...prev[taskId], [field]: value } }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setEquipFilter("");
    setFreqFilter("");
    setPersonFilter("");
    setFamiliarityFilter("");
  }, []);

  // ── Export ──
  const handleExport = useCallback(async (selectedOnly: boolean) => {
    if (selectedOnly && selected.size === 0) {
      setBanner({ type: "info", message: "Select one or more tasks before using Export Selected." });
      return;
    }

    try {
      const selectedIds = selectedOnly ? Array.from(selected) : undefined;
      const result = await utils.tasks.export.fetch({
        dataset: activeTab,
        selectedIds,
      });
      if (!result?.length) {
        setBanner({ type: "info", message: selectedOnly ? "None of the selected tasks were found to export." : "No data to export for this facility." });
        return;
      }

      const headers = [
        "task_id",
        "task_code",
        "Facility/Dataset",
        "Facility/Program",
        "System/Category",
        "Equipment Code",
        "Equipment Name",
        "Task Description",
        "Frequency",
        "Responsible Personnel",
        "Operations",
        "AMD",
        "ARD",
        "Procedure Familiarity",
      ];
      const rows = result.map((row: any) => [
        row.task_id || row.taskId || row.id || "",
        row.task_code || row.taskCode || "",
        row.dataset || activeTab,
        row.facilityProgram || tabLabel,
        row.systemCategory || "",
        row.equipmentCode || "",
        row.equipmentName || row.equipmentType || "",
        row.taskList || "",
        row.frequency || "",
        row.responsiblePersonnel || "",
        row.operations || "",
        row.amd || "",
        row.ard || "",
        row.procedureFamiliarity || "",
      ]);
      console.info("[tasks/export] identity columns", {
        activeDataset: activeTab,
        rowCount: rows.length,
        hasTaskIdHeader: headers.includes("task_id"),
        hasTaskCodeHeader: headers.includes("task_code"),
        hasFacilityDatasetHeader: headers.includes("Facility/Dataset"),
        firstRows: rows.slice(0, 3).map((row) => ({ task_id: row[0], task_code: row[1], facilityDataset: row[2] })),
      });
      const csv = [headers, ...rows].map((row) => row.map(csvEsc).join(",")).join("\n") + "\n";
      const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${activeTab}_${selectedOnly ? "selected" : "all"}_${new Date().toISOString().slice(0,10)}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setBanner({ type: "success", message: `${result.length} row${result.length === 1 ? "" : "s"} exported successfully.` });
    } catch (err: any) {
      console.error("Export failed:", err);
      setBanner({ type: "error", message: "Export failed: " + friendlyError(err) });
    }
  }, [utils.tasks.export, activeTab, selected, tabLabel]);

  // ── Import ──
  const handleImport = useCallback((file: File) => {
    const isExcel = /\.(xlsx|xlsm|xls)$/i.test(file.name);
    const isCsv = /\.csv$/i.test(file.name);
    if (!isExcel && !isCsv) {
      setBanner({ type: "error", message: "Unsupported file type. Upload a CSV or Excel file (.csv, .xlsx, .xlsm, .xls)." });
      return;
    }
    setBanner(null);
    setImportSummary(null);
    setImportProgress({ show: true, text: "Reading file...", sub: file.name, pct: 10 });
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportProgress({ show: true, text: "Parsing data...", sub: "Extracting rows", pct: 30 });
      let sheetRows: string[][] = [];
      try {
        if (isExcel) {
          const raw = e.target?.result as ArrayBuffer;
          const wb = XLSX.read(raw, { type: "array", cellDates: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as string[][];
        } else {
          const raw = e.target?.result as string;
          const text = raw.charCodeAt(0) === 0xfeff ? raw.substring(1) : raw;
          sheetRows = parseCsv(text);
        }
      } catch (err) {
        console.error("Import parse failed:", err);
        setImportProgress(null);
        setBanner({ type: "error", message: "File is corrupt or could not be parsed. Upload a valid CSV or Excel file." });
        return;
      }
      if (sheetRows.length < 2) { setImportProgress(null); setBanner({ type: "error", message: "File is empty or invalid." }); return; }

      const headers = sheetRows[0].map((h: string) => String(h).trim());
      const normalizedHeaders = headers.map(normalizeImportHeader);
      const findHeader = (names: string[]): number => {
        const aliases = names.map(normalizeImportHeader);
        for (let i = 0; i < normalizedHeaders.length; i++) {
          if (aliases.includes(normalizedHeaders[i])) return i;
        }
        return -1;
      };

      const taskIdIdx = findHeader(["task_id", "Task ID", "Task Id", "taskId"]);
      const taskCodeIdx = findHeader(["task_code", "Task Code", "taskCode"]);
      const datasetIdx = findHeader(["Facility/Dataset", "Facility Dataset", "Dataset", "facility_dataset"]);
      const eqIdx = findHeader(["Equipment Name", "Equipment Type", "Equipment", "equipment_name", "equipment_type"]);
      const taskIdx = findHeader(["Task Description", "task_description", "Task List", "tasklist"]);
      const freqIdx = findHeader(["Frequency"]);
      const responsibleIdx = findHeader(["Responsible Personnel", "Responsible Person", "responsible_personnel"]);
      const opsIdx = findHeader(["Operations", "Ops"]);
      const amdIdx = findHeader(["AMD"]);
      const ardIdx = findHeader(["ARD"]);
      const famIdx = findHeader(["Procedure Familiarity", "Familiarity", "Fam", "Procedure_Familiarity"]);

      console.info("[tasks/import] parsed headers", {
        file: file.name,
        activeDataset: activeTab,
        headers,
        normalizedHeaders,
        detected: { taskIdIdx, taskCodeIdx, datasetIdx, eqIdx, taskIdx, freqIdx, responsibleIdx, opsIdx, amdIdx, ardIdx, famIdx },
      });

      if ((taskIdIdx < 0 && taskCodeIdx < 0) && (eqIdx < 0 || taskIdx < 0)) {
        setImportProgress(null);
        setBanner({ type: "error", message: `Import failed: missing required header. Required fix: export a fresh file with task_id, task_code, and Facility/Dataset, or include Equipment Name and Task Description for legacy fallback. Found: ${headers.join(", ")}` });
        return;
      }

      const updates = sheetRows.slice(1).map((row, idx) => ({
        rowNumber: idx + 2,
        taskId: taskIdIdx >= 0 ? String(row[taskIdIdx] || "").trim() : undefined,
        taskCode: taskCodeIdx >= 0 ? String(row[taskCodeIdx] || "").trim() : undefined,
        facilityDataset: datasetIdx >= 0 ? String(row[datasetIdx] || "").trim() : undefined,
        equipmentType: eqIdx >= 0 ? String(row[eqIdx] || "").trim() : "",
        taskList: taskIdx >= 0 ? String(row[taskIdx] || "").trim() : "",
        frequency: freqIdx >= 0 ? String(row[freqIdx] || "").trim() : undefined,
        responsiblePersonnel: responsibleIdx >= 0 ? String(row[responsibleIdx] || "").trim() : undefined,
        operations: opsIdx >= 0 ? String(row[opsIdx] || "").trim() : undefined,
        amd: amdIdx >= 0 ? String(row[amdIdx] || "").trim() : undefined,
        ard: ardIdx >= 0 ? String(row[ardIdx] || "").trim() : undefined,
        procedureFamiliarity: famIdx >= 0 ? String(row[famIdx] || "").trim() : undefined,
      })).filter((u) => (u.taskId || u.taskCode || (u.equipmentType && u.taskList)));

      console.info("[tasks/import] parsed row sample", {
        file: file.name,
        activeDataset: activeTab,
        rows: updates.length,
        firstRows: updates.slice(0, 3),
        rowIdentity: updates.slice(0, 20).map((row) => ({
          rowNumber: row.rowNumber,
          hasTaskId: !!row.taskId,
          hasTaskCode: !!row.taskCode,
          hasFacilityDataset: !!row.facilityDataset,
          hasEquipment: !!row.equipmentType,
          hasTaskDescription: !!row.taskList,
          matchingPath: row.taskId ? "task_id" : row.taskCode ? "task_code" : "fallback text",
        })),
      });

      if (updates.length === 0) { setImportProgress(null); setBanner({ type: "error", message: "Import failed: no valid data rows found. Required fix: import a fresh export with task_id/task_code, or include Equipment Name and Task Description fallback columns." }); return; }

      setImportProgress({ show: true, text: `Uploading ${updates.length} rows...`, sub: "Sending to server", pct: 60 });
      importMutation.mutate({ dataset: activeTab, rows: updates });
    };
    reader.onerror = () => { setImportProgress(null); setBanner({ type: "error", message: "Failed to read file." }); };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }, [activeTab, importMutation]);

  // ═════════════ RENDER ═════════════
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Import Progress Overlay */}
      {importProgress?.show && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 sm:p-8 min-w-[280px] sm:min-w-[320px] shadow-2xl">
            <div className="text-sm font-semibold text-gray-700 mb-1">{importProgress.text}</div>
            <div className="text-xs text-gray-500 mb-3">{importProgress.sub}</div>
            <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${importProgress.pct}%`, background: "linear-gradient(90deg, #2563eb, #34d399)" }} />
            </div>
            <div className="text-xs text-gray-400 mt-2 text-right">{importProgress.pct}%</div>
          </div>
        </div>
      )}

      {/* Banner */}
      {banner && <InlineBanner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />}


      {/* Import Result Summary */}
      {importSummary && (
        <div className={`fixed left-3 right-3 top-20 z-[60] mx-auto max-w-[1600px] border rounded-lg p-4 text-sm shadow-lg ${importSummary.status === "success" ? "bg-green-50 border-green-200 text-green-900" : "bg-red-50 border-red-200 text-red-900"}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-bold mb-2">{importSummary.status === "success" ? "✅ Import Result" : "⚠️ Import Diagnostics"}</div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span><b>{importSummary.updated}</b> rows updated</span>
                <span><b>{importSummary.unchanged}</b> rows unchanged</span>
                <span><b>{importSummary.rejected.length}</b> rows rejected</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap">{importSummary.message}</p>
            </div>
            <button onClick={() => setImportSummary(null)} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>
          </div>
          {importSummary.rejected.length > 0 && (
            <div className="mt-3">
              <div className="font-semibold mb-1">Rejected rows:</div>
              <ul className="list-disc pl-5 space-y-1">
                {importSummary.rejected.map((row, idx) => (
                  <li key={`${row.row}-${idx}`}>
                    Row {row.row}: {row.reason}
                    {row.eq ? <span className="opacity-75"> — {row.eq}</span> : null}
                    {row.task ? <span className="opacity-75"> / {row.task}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <header className="text-white sticky top-0 z-50" style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)", boxShadow: "0 4px 12px rgba(22,50,79,0.10)" }}>
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
            <Link to="/" className="flex items-center gap-2 sm:gap-3 no-underline text-white min-w-0">
              <ProgramsEngineeringLogo size={72} borderRadius={8} />
              <div className="min-w-0">
                <h1 className="text-sm sm:text-xl font-bold leading-tight truncate">Maintenance Planning (Post-PPP)</h1>
                <p className="text-[10px] sm:text-sm opacity-55 hidden sm:block" style={{ letterSpacing: "1px", textTransform: "uppercase" }}>Programs</p>
              </div>
            </Link>
            <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
              <div className="flex gap-1.5 sm:gap-2">
                <div className="bg-white/10 border border-white/20 rounded-lg px-2 py-1 sm:px-3 sm:py-2 text-center">
                  <div className="text-xs sm:text-lg font-bold">{stats?.count ?? "—"}</div>
                  <div className="text-[0.5rem] sm:text-[0.65rem] uppercase opacity-70">{activeTab.toUpperCase()}</div>
                </div>
              </div>
              <button onClick={() => { setIsRefreshing(true); utils.tasks.list.invalidate().then(() => { utils.tasks.filters.invalidate().then(() => { setIsRefreshing(false); setLastSync(new Date()); }); }); }} className="px-2 py-1.5 sm:px-4 sm:py-2 bg-white/10 border border-white/20 rounded-lg text-xs sm:text-sm font-medium text-white hover:bg-white/20 transition" title="Refresh data">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isRefreshing ? "animate-spin" : ""}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          <button onClick={() => setActiveTab("htt")} className={`px-3 sm:px-5 py-2.5 sm:py-3 rounded-t-lg text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-2 transition whitespace-nowrap flex-shrink-0 ${activeTab === "htt" ? "text-white" : "text-white/60 hover:text-white/85 hover:bg-white/5"}`} style={activeTab === "htt" ? { background: "#0066A6" } : {}}>
            <span className="hidden sm:inline">HTT STP</span><span className="sm:hidden">HTT</span>
          </button>
          <button onClick={() => setActiveTab("aglipay")} className={`px-3 sm:px-5 py-2.5 sm:py-3 rounded-t-lg text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-2 transition whitespace-nowrap flex-shrink-0 ${activeTab === "aglipay" ? "text-white" : "text-white/60 hover:text-white/85 hover:bg-white/5"}`} style={activeTab === "aglipay" ? { background: "#0066A6" } : {}}>
            <span className="hidden sm:inline">Aglipay STP</span><span className="sm:hidden">Aglipay</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1600px] mx-auto px-3 sm:px-6 py-3 sm:py-5">
        {/* Edit banner */}
        {editMode && (
          <div className="mb-3 px-4 py-3 bg-yellow-50 border border-yellow-400 rounded-lg text-sm font-semibold text-yellow-800 flex items-center gap-2">
            <span>&#9999;</span> Edit mode: changes are not saved yet. Click <strong>Save</strong> to commit or <strong>Cancel</strong> to discard.
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-3 items-stretch sm:items-center">
          <div className="relative flex-1 min-w-0 sm:min-w-[220px] sm:max-w-[360px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">&#128269;</span>
            <input type="text" placeholder="Search tasks or equipment..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&#10005;</button>}
          </div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            <select value={equipFilter} onChange={(e) => setEquipFilter(e.target.value)} className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white w-full sm:w-auto sm:min-w-[140px]">
              <option value="">All Equipment</option>
              {filtersData?.equipment?.map((e: string) => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={freqFilter} onChange={(e) => setFreqFilter(e.target.value)} className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white w-full sm:w-auto sm:min-w-[140px]">
              <option value="">All Freq.</option>
              {filtersData?.frequencies?.map((f: string) => <option key={f} value={f}>{f}</option>)}
            </select>
            {activeTab === "aglipay" && (
              <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white w-full sm:w-auto sm:min-w-[140px]">
                <option value="">All Personnel</option>
                {filtersData?.personnel?.map((p: string) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {/* Familiarity Filter — client-side only */}
            <select value={familiarityFilter} onChange={(e) => setFamiliarityFilter(e.target.value)} className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white w-full sm:w-auto sm:min-w-[160px]">
              <option value="">All Familiarity</option>
              {VALID_FAM.filter((f) => f !== "").map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-medium">Expand</button>
            <button onClick={collapseAll} className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-medium">Collapse</button>
            {(search || equipFilter || freqFilter || familiarityFilter) && (
              <button onClick={clearAllFilters} className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 font-medium">Clear</button>
            )}
          </div>
          <div className="text-xs sm:text-sm text-gray-500 whitespace-nowrap">
            {isLoading ? "Loading..." : <><strong>{totalGroups}</strong> groups &middot; <strong>{totalTasks}</strong> tasks</>}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-col gap-2 mb-4 p-2 sm:p-3 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={allVisibleSelected} onChange={() => allVisibleSelected ? deselectAll() : selectAll()} className="w-4 h-4" />
              <span className="hidden sm:inline">Select All</span>
              <span className="sm:hidden">All</span>
            </label>
            {selected.size > 0 && <span className="text-xs text-gray-500 ml-2">{selected.size} selected</span>}
            <div className="flex gap-1.5 ml-auto">
              {!editMode ? (
                <button onClick={startEdit} className="px-2 sm:px-4 py-1.5 sm:py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 flex items-center gap-1">
                  <span>&#9999;</span><span className="hidden sm:inline">Edit</span>
                </button>
              ) : (
                <>
                  <button onClick={saveEdit} disabled={bulkUpdateMutation.isPending} className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${bulkUpdateMutation.isPending ? "bg-green-400 text-white cursor-wait" : "bg-green-700 text-white hover:bg-green-800"}`}>
                    {bulkUpdateMutation.isPending ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /><span className="hidden sm:inline">Saving...</span></> : <><span>&#128190;</span><span className="hidden sm:inline">Save</span></>}
                  </button>
                  <button onClick={cancelEdit} className="px-2 sm:px-4 py-1.5 sm:py-2 bg-red-100 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-200 flex items-center gap-1">
                    <span>&#10005;</span><span className="hidden sm:inline">Cancel</span>
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => handleExport(true)} className="px-2 sm:px-4 py-1.5 sm:py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 flex items-center gap-1">
              <span>&#128196;</span><span className="hidden sm:inline">Export Selected</span><span className="sm:hidden">Export</span>
            </button>
            <button onClick={() => handleExport(false)} className="px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center gap-1 text-white hover:opacity-90" style={{ background: "#0066A6" }}>
              <span>&#11015;</span><span className="hidden sm:inline">Export All</span><span className="sm:hidden">All</span>
            </button>
            <label className="px-2 sm:px-4 py-1.5 sm:py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 flex items-center gap-1 cursor-pointer">
              <span>&#128194;</span><span className="hidden sm:inline">Import</span><span className="sm:hidden">Import</span>
              <input type="file" accept=".csv,.xlsx,.xlsm,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImport(file); e.target.value = ""; }} />
            </label>
          </div>
        </div>

        {/* Procedure Familiarity KPI Cards */}
        {famSummary && Object.keys(famSummary.distribution).length > 0 && (
          <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(famSummary.distribution).sort().map(([level, count]) => {
              const colors: Record<string, string> = {
                "Fully Familiar": "bg-green-50 border-green-200 text-green-800",
                "Partially Familiar": "bg-blue-50 border-blue-200 text-blue-800",
                "Requires Guidance": "bg-amber-50 border-amber-200 text-amber-800",
                "Not Familiar": "bg-red-50 border-red-200 text-red-800",
                "Not Set": "bg-gray-50 border-gray-200 text-gray-600",
              };
              const pct = famSummary.total > 0 ? Math.round((count / famSummary.total) * 100) : 0;
              return (
                <div key={level} className={`px-3 py-2.5 rounded-lg border ${colors[level] || "bg-gray-50 border-gray-200 text-gray-600"}`}>
                  <div className="text-[0.6rem] uppercase tracking-wide font-semibold opacity-70">{level}</div>
                  <div className="text-lg font-bold">{count} <span className="text-xs font-normal opacity-60">({pct}%)</span></div>
                </div>
              );
            })}
          </div>
        )}

        {/* Desktop Table + Mobile Cards */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-auto text-sm table-auto min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="w-10 px-3 py-3 text-left"></th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Equipment</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Task</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Freq</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Resp.</th>
                  <th className="min-w-[180px] px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">Operations</th>
                  <th className="min-w-[180px] px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">AMD</th>
                  <th className="min-w-[180px] px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">ARD</th>
                  <th className="min-w-[160px] px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">Familiarity</th>
                </tr>
              </thead>
              <tbody>
                {listError ? (
                  <tr><td colSpan={9} className="text-center py-16 px-6">
                    <div className="flex flex-col items-center gap-3 max-w-md mx-auto">
                      <div className="text-red-500 text-2xl">⚠️</div>
                      <h3 className="text-lg font-semibold text-red-700">Failed to load records</h3>
                      <p className="text-sm text-red-600">{friendlyError(listError)}</p>
                      <button onClick={() => window.location.reload()} className="mt-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Retry</button>
                    </div>
                  </td></tr>
                ) : isLoading ? (
                  <tr><td colSpan={9} className="text-center py-20 text-gray-500">
                    <div className="flex flex-col items-center gap-3"><div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" /><span>Loading data...</span></div>
                  </td></tr>
                ) : !data?.groups?.length ? (
                  <tr><td colSpan={9} className="text-center py-20 text-gray-500">
                    <h3 className="text-lg font-semibold text-gray-700 mb-1">No matching records</h3>
                    <p className="text-sm">{familiarityFilter ? `No tasks match "${familiarityFilter}". Clear the familiarity filter to see all records.` : "Try adjusting your search or filters."}</p>
                    {familiarityFilter && <button onClick={() => setFamiliarityFilter("")} className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Clear Familiarity Filter</button>}
                  </td></tr>
                ) : (
                  data.groups.map((group) => {
                    const isCollapsed = collapsedGroups.has(group?.equipment?.name ?? "");
                    return (
                      <Fragment key={`dt-${group?.equipment?.id ?? "x"}`}>
                        <tr className="bg-gray-50 cursor-pointer hover:bg-gray-100 transition" onClick={() => toggleGroup(group?.equipment?.name ?? "")}>
                          <td colSpan={9} className="px-3 py-2.5 border-b border-gray-200 border-t-2 border-t-gray-200">
                            <div className="flex items-center gap-3">
                              <span className={`text-gray-500 text-xs transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>&#9660;</span>
                              <span className="w-8 h-8 bg-blue-50 text-blue-700 rounded-lg flex items-center justify-center text-xs font-bold">{group?.equipment?.initials ?? "?"}</span>
                              <span className="font-bold text-gray-800 text-sm">{group?.equipment?.name ?? "Unknown"}</span>
                              <span className="text-xs text-gray-500">{(group?.tasks?.length ?? 0)} task{(group?.tasks?.length ?? 0) !== 1 ? "s" : ""}</span>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed && group?.tasks?.map((task) => {
                          const isSel = selected.has(task?.id);
                          const pend = task?.id ? pending[task.id] : undefined;
                          const opsVal = pend?.operations !== undefined ? pend.operations : (task?.operations || "");
                          const amdVal = pend?.amd !== undefined ? pend.amd : (task?.amd || "");
                          const ardVal = pend?.ard !== undefined ? pend.ard : (task?.ard || "");
                          const famVal = pend?.procedureFamiliarity !== undefined ? pend.procedureFamiliarity : ((task as any).procedureFamiliarity || "");
                          const isPend = !!pend && (pend.operations !== undefined || pend.amd !== undefined || pend.ard !== undefined || pend.procedureFamiliarity !== undefined);
                          return (
                            <tr key={`dt-t-${task?.id}`} className={`transition ${isSel ? "bg-blue-50" : ""} ${isPend ? "bg-yellow-50/50" : ""} hover:bg-gray-50`}>
                              <td className="px-3 py-2 border-b border-gray-100"><input type="checkbox" checked={isSel} onChange={() => task?.id && toggleSelect(task.id)} className="w-4 h-4" /></td>
                              <td className="px-3 py-2 border-b border-gray-100 font-semibold text-gray-800">{group?.equipment?.name ?? "-"}</td>
                              <td className="px-3 py-2 border-b border-gray-100 text-gray-700">{task?.taskList ?? "-"}</td>
                              <td className="px-3 py-2 border-b border-gray-100"><span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getFreqBadgeClass(task?.frequency ?? "")}`}>{task?.frequency || "-"}</span></td>
                              <td className="px-3 py-2 border-b border-gray-100"><span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getPersBadgeClass(task?.responsiblePersonnel ?? "")}`}>{task?.responsiblePersonnel || "-"}</span></td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <select disabled={!editMode} value={opsVal} onChange={(e) => task?.id && onDropdownChange(task.id, "operations", e.target.value)} className={`w-auto min-w-[160px] px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPend && pend?.operations !== undefined ? "bg-yellow-50 border-yellow-400" : task?.operations ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                  {VALID_OPS.map((o) => <option key={o} value={o}>{o || "-- Select --"}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <select disabled={!editMode} value={amdVal} onChange={(e) => task?.id && onDropdownChange(task.id, "amd", e.target.value)} className={`w-auto min-w-[160px] px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPend && pend?.amd !== undefined ? "bg-yellow-50 border-yellow-400" : task?.amd ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                  {VALID_OPS.map((o) => <option key={o} value={o}>{o || "-- Select --"}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <select disabled={!editMode} value={ardVal} onChange={(e) => task?.id && onDropdownChange(task.id, "ard", e.target.value)} className={`w-auto min-w-[160px] px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPend && pend?.ard !== undefined ? "bg-yellow-50 border-yellow-400" : task?.ard ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                  {VALID_OPS.map((o) => <option key={o} value={o}>{o || "-- Select --"}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <select disabled={!editMode} value={famVal} onChange={(e) => task?.id && onDropdownChange(task.id, "procedureFamiliarity", e.target.value)} className={`w-auto min-w-[140px] px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPend && pend?.procedureFamiliarity !== undefined ? "bg-yellow-50 border-yellow-400" : (task as any).procedureFamiliarity ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                  {VALID_FAM.map((f) => <option key={f} value={f}>{f || "-- Select --"}</option>)}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="sm:hidden">
            {listError ? (
              <div className="p-6 text-center">
                <div className="text-red-500 text-2xl mb-2">⚠️</div>
                <h3 className="text-base font-semibold text-red-700">Failed to load</h3>
                <p className="text-sm text-red-600 mt-1">{friendlyError(listError)}</p>
                <button onClick={() => window.location.reload()} className="mt-3 px-4 py-2 bg-red-600 text-white text-sm rounded-lg">Retry</button>
              </div>
            ) : isLoading ? (
              <div className="flex flex-col items-center gap-3 py-20 text-gray-500"><div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" /><span>Loading...</span></div>
            ) : !data?.groups?.length ? (
              <div className="text-center py-20 text-gray-500">
                <h3 className="text-lg font-semibold text-gray-700 mb-1">No records</h3>
                <p className="text-sm">{familiarityFilter ? `Clear "${familiarityFilter}" filter.` : "Adjust filters or refresh."}</p>
                {familiarityFilter && <button onClick={() => setFamiliarityFilter("")} className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg">Clear</button>}
              </div>
            ) : (
              data.groups.map((group) => {
                const isCollapsed = collapsedGroups.has(group?.equipment?.name ?? "");
                return (
                  <div key={`m-${group?.equipment?.id ?? "x"}`}>
                    <div className="bg-gray-50 px-3 py-2.5 border-b border-gray-200 border-t-2 border-t-gray-200 flex items-center gap-3 cursor-pointer" onClick={() => toggleGroup(group?.equipment?.name ?? "")}>
                      <span className={`text-gray-500 text-xs transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>&#9660;</span>
                      <span className="w-7 h-7 bg-blue-50 text-blue-700 rounded flex items-center justify-center text-xs font-bold">{group?.equipment?.initials ?? "?"}</span>
                      <span className="font-bold text-gray-800 text-sm">{group?.equipment?.name ?? "Unknown"}</span>
                      <span className="text-xs text-gray-500 ml-auto">{(group?.tasks?.length ?? 0)}</span>
                    </div>
                    {!isCollapsed && group?.tasks?.map((task) => {
                      const isSel = selected.has(task?.id);
                      const pend = task?.id ? pending[task.id] : undefined;
                      const opsVal = pend?.operations !== undefined ? pend.operations : (task?.operations || "");
                      const amdVal = pend?.amd !== undefined ? pend.amd : (task?.amd || "");
                      const ardVal = pend?.ard !== undefined ? pend.ard : (task?.ard || "");
                      const famVal = pend?.procedureFamiliarity !== undefined ? pend.procedureFamiliarity : ((task as any).procedureFamiliarity || "");
                      const isPend = !!pend && (pend.operations !== undefined || pend.amd !== undefined || pend.ard !== undefined || pend.procedureFamiliarity !== undefined);
                      return (
                        <div key={`m-t-${task?.id}`} className={`p-3 border-b border-gray-100 ${isSel ? "bg-blue-50" : ""} ${isPend ? "bg-yellow-50/50" : ""}`}>
                          <div className="flex items-start gap-2 mb-2">
                            <input type="checkbox" checked={isSel} onChange={() => task?.id && toggleSelect(task.id)} className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-500 mb-0.5">{group?.equipment?.name ?? "-"}</div>
                              <div className="text-sm font-medium text-gray-800 leading-snug">{task?.taskList ?? "-"}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mb-2 ml-6">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getFreqBadgeClass(task?.frequency ?? "")}`}>{task?.frequency || "-"}</span>
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getPersBadgeClass(task?.responsiblePersonnel ?? "")}`}>{task?.responsiblePersonnel || "-"}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 ml-6">
                            <div><label className="text-[0.65rem] text-gray-400 uppercase block mb-0.5">Ops</label>
                              <select disabled={!editMode} value={opsVal} onChange={(e) => task?.id && onDropdownChange(task.id, "operations", e.target.value)} className={`w-full px-1.5 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                                {VALID_OPS.map((o) => <option key={o} value={o}>{o || "--"}</option>)}
                              </select>
                            </div>
                            <div><label className="text-[0.65rem] text-gray-400 uppercase block mb-0.5">AMD</label>
                              <select disabled={!editMode} value={amdVal} onChange={(e) => task?.id && onDropdownChange(task.id, "amd", e.target.value)} className={`w-full px-1.5 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                                {VALID_OPS.map((o) => <option key={o} value={o}>{o || "--"}</option>)}
                              </select>
                            </div>
                            <div><label className="text-[0.65rem] text-gray-400 uppercase block mb-0.5">ARD</label>
                              <select disabled={!editMode} value={ardVal} onChange={(e) => task?.id && onDropdownChange(task.id, "ard", e.target.value)} className={`w-full px-1.5 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                                {VALID_OPS.map((o) => <option key={o} value={o}>{o || "--"}</option>)}
                              </select>
                            </div>
                            <div><label className="text-[0.65rem] text-gray-400 uppercase block mb-0.5">Familiarity</label>
                              <select disabled={!editMode} value={famVal} onChange={(e) => task?.id && onDropdownChange(task.id, "procedureFamiliarity", e.target.value)} className={`w-full px-1.5 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                                {VALID_FAM.map((f) => <option key={f} value={f}>{f || "--"}</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      <footer className="text-right py-5 px-5 text-sm text-gray-500 border-t border-gray-200 mt-4">
        Program Oversight Center &copy; 2026
      </footer>
    </div>
  );
}
