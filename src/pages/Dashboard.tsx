import { useState, useCallback, useRef, useMemo, Fragment } from "react";
import * as XLSX from "xlsx";
import { trpc } from "@/providers/trpc";

// Types
const VALID_OPS = ["", "Operator", "AMD in-house", "Outsourced SLA"] as const;
type OpsValue = (typeof VALID_OPS)[number];

interface PendingChange {
  taskId: number;
  operations?: string;
  amd?: string;
  ard?: string;
}

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

export default function Dashboard() {
  // Active tab
  const [activeTab, setActiveTab] = useState<"htt" | "aglipay">("htt");

  // Search & filters
  const [search, setSearch] = useState("");
  const [equipFilter, setEquipFilter] = useState("");
  const [freqFilter, setFreqFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [pending, setPending] = useState<Record<number, Partial<{ operations: string; amd: string; ard: string }>>>({});

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import progress
  const [importProgress, setImportProgress] = useState<{ show: boolean; text: string; sub: string; pct: number } | null>(null);

  // tRPC queries
  const utils = trpc.useUtils();
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading: isDataLoading, dataUpdatedAt } = trpc.tasks.list.useQuery({
    dataset: activeTab,
    search: search || undefined,
    equipFilter: equipFilter || undefined,
    freqFilter: freqFilter || undefined,
    personFilter: personFilter || undefined,
  }, {
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    onSuccess: () => setLastSync(new Date()),
  });

  const { data: filters } = trpc.tasks.filters.useQuery({ dataset: activeTab }, {
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const updateMutation = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      utils.tasks.export.invalidate();
    },
  });

  const bulkUpdateMutation = trpc.tasks.bulkUpdate.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      utils.tasks.export.invalidate();
      alert("Changes saved successfully!");
    },
    onError: (err) => {
      console.error("Save failed:", err);
      alert("Save failed: " + (err.message || "Server error. Your changes were not saved."));
    },
  });

  const importMutation = trpc.tasks.import.useMutation({
    onSuccess: () => {
      // Invalidate queries to refresh data after import
      utils.tasks.list.invalidate();
      utils.tasks.export.invalidate();
    },
    onError: (err) => {
      console.error("Import failed:", err);
      alert("Import failed: " + (err.message || "Server error. Check console for details."));
    },
  });

  const exportQuery = trpc.tasks.export.useQuery(
    { dataset: activeTab, selectedIds: selected.size > 0 ? Array.from(selected) : undefined },
    { enabled: false }
  );

  // Toggle group collapse
  const toggleGroup = useCallback((name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // Toggle selection
  const toggleSelect = useCallback((taskId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data) return;
    const allIds = new Set<number>();
    data.groups.forEach((g) => g.tasks.forEach((t) => allIds.add(t.id)));
    setSelected(allIds);
  }, [data]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  // Edit handlers
  const startEdit = useCallback(() => {
    setEditMode(true);
    setPending({});
  }, []);

  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setPending({});
  }, []);

  const saveEdit = useCallback(() => {
    const updates = Object.entries(pending)
      .filter(([, v]) => v.operations !== undefined || v.amd !== undefined || v.ard !== undefined)
      .map(([taskId, v]) => ({
        taskId: Number(taskId),
        operations: v.operations ?? null,
        amd: v.amd ?? null,
        ard: v.ard ?? null,
      }));

    if (updates.length > 0) {
      bulkUpdateMutation.mutate(updates, {
        onSuccess: () => {
          setEditMode(false);
          setPending({});
        },
        onError: () => {
          // Stay in edit mode so user can retry, but clear loading state
          // The global onError handler already alerted the user
        },
      });
    } else {
      setEditMode(false);
    }
  }, [pending, bulkUpdateMutation]);

  const onDropdownChange = useCallback((taskId: number, field: "operations" | "amd" | "ard", value: string) => {
    setPending((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], [field]: value },
    }));
  }, []);

  // Export
  const handleExport = useCallback(async (selectedOnly: boolean) => {
    try {
      const result = await utils.tasks.export.fetch({
        dataset: activeTab,
        selectedIds: selectedOnly && selected.size > 0 ? Array.from(selected) : undefined,
      });
      if (!result || result.length === 0) {
        alert("Export returned no data. Make sure tasks exist for the current dataset.");
        return;
      }

      const headers = ["Equipment Type", "Task Description", "Frequency", "Responsible Personnel", "Operations", "AMD", "ARD"];
      let csv = headers.map(csvEsc).join(",") + "\n";
      result.forEach((row) => {
        csv += [
          row.equipmentType,
          row.taskList,
          row.frequency,
          row.responsiblePersonnel,
          row.operations,
          row.amd,
          row.ard,
        ].map(csvEsc).join(",") + "\n";
      });

      const blob = new Blob([csv], { type: "text/csv" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = selectedOnly ? `${activeTab}_selected.csv` : `${activeTab}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      console.error("Export failed:", err);
      alert("Export failed: " + (err.message || "Server error. Check console for details."));
    }
  }, [utils.tasks.export, activeTab, selected]);

  // Import — supports .csv, .xlsx, .xlsm, .xls
  const handleImport = useCallback((file: File) => {
    const isExcel = /\.(xlsx|xlsm|xls)$/i.test(file.name);
    setImportProgress({ show: true, text: 'Reading file...', sub: file.name, pct: 10 });
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportProgress({ show: true, text: 'Parsing data...', sub: 'Extracting rows', pct: 30 });
      let sheetRows: string[][] = [];
      if (isExcel) {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
        sheetRows = json;
      } else {
        const rawText = e.target?.result as string;
        const text = rawText.charCodeAt(0) === 0xfeff ? rawText.substring(1) : rawText;
        sheetRows = parseCsv(text);
      }
      if (sheetRows.length < 2) { setImportProgress(null); alert("File is empty or invalid"); return; }

      const headers = sheetRows[0].map(h => String(h).trim());

      // Case-insensitive header matching
      const findHeader = (names: string[]): number => {
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i].toLowerCase().replace(/\s+/g, '');
          for (const name of names) {
            if (h === name.toLowerCase().replace(/\s+/g, '')) return i;
          }
        }
        return -1;
      };

      const eqIdx = findHeader(["Equipment Type", "Equipment", "equipment_type"]);
      const taskIdx = findHeader(["Task Description", "Task Description", "task_description", "Task List", "tasklist"]);
      const opsIdx = findHeader(["Operations", "Ops"]);
      const amdIdx = findHeader(["AMD"]);
      const ardIdx = findHeader(["ARD"]);

      if (eqIdx < 0 || taskIdx < 0) {
        setImportProgress(null);
        alert("Missing required columns.\n\nFound: " + headers.join(", ") + "\n\nNeed: 'Equipment Type' and 'Task Description' (case-insensitive).");
        return;
      }

      const updates = sheetRows.slice(1).map((row) => ({
        equipmentType: String(row[eqIdx] || "").trim(),
        taskList: String(row[taskIdx] || "").trim(),
        operations: opsIdx >= 0 ? (String(row[opsIdx] || "").trim()) : undefined,
        amd: amdIdx >= 0 ? (String(row[amdIdx] || "").trim()) : undefined,
        ard: ardIdx >= 0 ? (String(row[ardIdx] || "").trim()) : undefined,
      })).filter((u) => u.equipmentType && u.taskList);

      if (updates.length === 0) {
        setImportProgress(null);
        alert("No valid data rows found. Make sure Equipment Type and Task Description are not empty.");
        return;
      }

      const proceed = confirm(
        `Import preview:\n` +
        `• File: ${file.name}\n` +
        `• Rows to import: ${updates.length}\n\n` +
        `This will UPDATE existing tasks matching Equipment Type + Task Description.\n` +
        `Continue?`
      );
      if (!proceed) { setImportProgress(null); return; }

      setImportProgress({ show: true, text: `Uploading ${updates.length} rows...`, sub: 'Sending to server', pct: 60 });
      importMutation.mutate(updates, {
        onSuccess: (res) => {
          setImportProgress({ show: true, text: 'Import complete!', sub: 'Refreshing data...', pct: 100 });
          setTimeout(() => setImportProgress(null), 800);
          const updated = res?.updated ?? 0;
          const total = res?.total ?? updates.length;
          const skipped = total - updated;
          let msg = `Import complete!\n\n• ${updated} rows updated\n• ${skipped} rows not found in database`;
          if (skipped > 0) {
            msg += "\n\nTip: Check that Equipment Type and Task Description match exactly.";
          }
          alert(msg);
        },
        onError: (err) => {
          setImportProgress(null);
          alert("Import failed: " + (err.message || "Unknown server error"));
        },
      });
    };
    reader.onerror = () => { setImportProgress(null); alert("Failed to read file. Please try again."); };
    if (isExcel) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }, [importMutation]);

  // Auth gate removed — dashboard is open to all users

  const tabLabel = activeTab === "htt" ? "HTT STP" : "Aglipay STP";
  const totalTasks = data?.totalTasks ?? 0;
  const totalGroups = data?.groups.length ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Import Progress Overlay */}
      {importProgress?.show && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 sm:p-8 min-w-[280px] sm:min-w-[320px] shadow-2xl">
            <div className="text-sm font-semibold text-gray-700 mb-1">{importProgress.text}</div>
            <div className="text-xs text-gray-500 mb-3">{importProgress.sub}</div>
            <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${importProgress.pct}%`, background: 'linear-gradient(90deg, #2563eb, #34d399)' }}
              />
            </div>
            <div className="text-xs text-gray-400 mt-2 text-right">{importProgress.pct}%</div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="text-white sticky top-0 z-50" style={{ background: 'linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)', boxShadow: '0 4px 12px rgba(22,50,79,0.10)' }}>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: '#fff' }}><img src="/amd-logo.jpeg" alt="AMD" className="w-full h-full object-contain p-0.5" /></div>
            <div>
              <h1 className="text-base sm:text-xl font-bold leading-tight">Maintenance Planning Post-PPP</h1>
              <p className="text-xs sm:text-sm opacity-55 hidden sm:block" style={{ letterSpacing: '1px', textTransform: 'uppercase' }}>Asset Maintenance Department — Multi-User</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            <div className="flex gap-1.5 sm:gap-2">
              <div className="bg-white/10 border border-white/20 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 text-center">
                <div className="text-sm sm:text-lg font-bold">976</div>
                <div className="text-[0.6rem] sm:text-[0.65rem] uppercase opacity-70">HTT</div>
              </div>
              <div className="bg-white/10 border border-white/20 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 text-center">
                <div className="text-sm sm:text-lg font-bold">401</div>
                <div className="text-[0.6rem] sm:text-[0.65rem] uppercase opacity-70">Aglipay</div>
              </div>
              <div className="bg-white/10 border border-white/20 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 text-center hidden sm:block">
                <div className="text-sm sm:text-lg font-bold">128</div>
                <div className="text-[0.6rem] sm:text-[0.65rem] uppercase opacity-70">Equip.</div>
              </div>
            </div>
            <a
              href="/"
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-white/10 border border-white/20 rounded-lg text-xs sm:text-sm font-medium text-white hover:bg-white/20 transition"
            >
              ← <span className="hidden sm:inline">Home</span>
            </a>
            <button
              onClick={() => {
                setIsRefreshing(true);
                utils.tasks.list.invalidate().then(() => {
                  utils.tasks.filters.invalidate().then(() => {
                    setIsRefreshing(false);
                    setLastSync(new Date());
                  });
                });
              }}
              disabled={isRefreshing}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-white/10 border border-white/20 rounded-lg text-xs sm:text-sm font-medium text-white hover:bg-white/20 transition flex items-center gap-1.5 disabled:opacity-50"
              title="Refresh data from server"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isRefreshing ? "animate-spin" : ""}>
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              <span className="hidden sm:inline">{isRefreshing ? "Refreshing..." : "Refresh"}</span>
            </button>
            {lastSync && (
              <span className="text-[10px] opacity-50 whitespace-nowrap hidden md:inline">
                Synced {Math.round((Date.now() - lastSync.getTime()) / 1000)}s ago
              </span>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab("htt")}
            className={`px-3 sm:px-5 py-2.5 sm:py-3 rounded-t-lg text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-2 transition whitespace-nowrap flex-shrink-0 ${
              activeTab === "htt" ? "text-white" : "text-white/60 hover:text-white/85 hover:bg-white/5"
            }`}
            style={activeTab === "htt" ? { background: '#0066A6' } : {}}
          >
            📋 <span className="hidden sm:inline">HTT STP</span><span className="sm:hidden">HTT</span> <span className="bg-white/20 text-[0.65rem] px-1.5 sm:px-2 py-0.5 rounded-full">976</span>
          </button>
          <button
            onClick={() => setActiveTab("aglipay")}
            className={`px-3 sm:px-5 py-2.5 sm:py-3 rounded-t-lg text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-2 transition whitespace-nowrap flex-shrink-0 ${
              activeTab === "aglipay" ? "text-white" : "text-white/60 hover:text-white/85 hover:bg-white/5"
            }`}
            style={activeTab === "aglipay" ? { background: '#0066A6' } : {}}
          >
            🔧 <span className="hidden sm:inline">Aglipay STP</span><span className="sm:hidden">Aglipay</span> <span className="bg-white/20 text-[0.65rem] px-1.5 sm:px-2 py-0.5 rounded-full">401</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1600px] mx-auto px-6 py-5">
        {/* Edit banner */}
        {editMode && (
          <div className="mb-3 px-4 py-3 bg-yellow-50 border border-yellow-400 rounded-lg text-sm font-semibold text-yellow-800 flex items-center gap-2">
            ✏️ Edit mode: changes are not saved yet. Click <strong>Save</strong> to commit or <strong>Cancel</strong> to discard.
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-3 items-stretch sm:items-center">
          <div className="relative flex-1 min-w-0 sm:min-w-[220px] sm:max-w-[360px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              type="text"
              placeholder="Search tasks or equipment..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                ✕
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={equipFilter}
              onChange={(e) => setEquipFilter(e.target.value)}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white flex-1 sm:flex-none min-w-[140px]"
            >
              <option value="">All Equipment</option>
              {filters?.equipment.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
            <select
              value={freqFilter}
              onChange={(e) => setFreqFilter(e.target.value)}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white flex-1 sm:flex-none min-w-[140px]"
            >
              <option value="">All Freq.</option>
              {filters?.frequencies.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            {activeTab === "aglipay" && (
              <select
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
                className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white flex-1 sm:flex-none min-w-[140px]"
              >
                <option value="">All Personnel</option>
                {filters?.personnel.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}
          </div>
          <div className="text-xs sm:text-sm text-gray-500 sm:ml-auto">
            {isDataLoading ? "Loading..." : <>Showing <strong>{totalTasks}</strong> tasks in <strong>{totalGroups}</strong> groups</>}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-4 p-2 sm:p-3 bg-white border border-gray-200 rounded-lg items-start sm:items-center">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.size > 0 && data?.groups.every((g) => g.tasks.every((t) => selected.has(t.id)))}
                onChange={() => selected.size > 0 ? deselectAll() : selectAll()}
                className="w-4 h-4"
              />
              Select All
            </label>
            {selected.size > 0 && <span className="text-sm text-gray-500">{selected.size} selected</span>}
          </div>
          <div className="flex gap-2 flex-wrap sm:ml-auto">
            {!editMode ? (
              <button onClick={startEdit} className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg text-xs sm:text-sm font-semibold hover:bg-blue-700 flex items-center gap-1 sm:gap-2">
                <span>✏️</span><span className="hidden sm:inline">Edit</span>
              </button>
            ) : (
              <>
                <button onClick={saveEdit} className="px-3 sm:px-4 py-2 bg-green-700 text-white rounded-lg text-xs sm:text-sm font-semibold hover:bg-green-800 flex items-center gap-1 sm:gap-2">
                  <span>💾</span><span className="hidden sm:inline">Save</span>
                </button>
                <button onClick={cancelEdit} className="px-3 sm:px-4 py-2 bg-red-100 text-red-700 rounded-lg text-xs sm:text-sm font-semibold hover:bg-red-200 flex items-center gap-1 sm:gap-2">
                  <span>✕</span><span className="hidden sm:inline">Cancel</span>
                </button>
              </>
            )}
            <button onClick={() => handleExport(true)} className="px-3 sm:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs sm:text-sm font-semibold hover:bg-gray-50 flex items-center gap-1 sm:gap-2">
              <span>📄</span><span className="hidden sm:inline">Export Selected</span><span className="sm:hidden">Export</span>
            </button>
            <button onClick={() => handleExport(false)} className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-2 text-white hover:opacity-90" style={{ background: '#0066A6' }}>
              <span>⬇️</span><span className="hidden sm:inline">Export All</span><span className="sm:hidden">All</span>
            </button>
            <label className="px-3 sm:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs sm:text-sm font-semibold hover:bg-gray-50 flex items-center gap-1 sm:gap-2 cursor-pointer">
              <span>📂</span><span className="hidden sm:inline">Import</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xlsm,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImport(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        {/* Desktop Table + Mobile Cards */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Desktop Table (hidden on mobile) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-auto text-sm table-auto min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="w-10 px-3 py-3 text-left"></th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Equipment Type</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Task Description</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Frequency</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Responsible</th>
                  <th className="min-w-[200px] px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">Operations</th>
                  <th className="min-w-[200px] px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">AMD</th>
                  <th className="min-w-[200px] px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">ARD</th>
                </tr>
              </thead>
              <tbody>
                {isDataLoading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-20 text-gray-500">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                        <span>Loading data...</span>
                      </div>
                    </td>
                  </tr>
                ) : !data?.groups.length ? (
                  <tr>
                    <td colSpan={8} className="text-center py-20 text-gray-500">
                      <h3 className="text-lg font-semibold text-gray-700 mb-1">No matching records</h3>
                      <p className="text-sm">Try adjusting your search or filters.</p>
                    </td>
                  </tr>
                ) : (
                  data.groups.map((group) => {
                    const isCollapsed = collapsedGroups.has(group.equipment.name);
                    return (
                      <Fragment key={`dt-group-${group.equipment.id}`}>
                        <tr
                          className="bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
                          onClick={() => toggleGroup(group.equipment.name)}
                        >
                          <td colSpan={8} className="px-3 py-2.5 border-b border-gray-200 border-t-2 border-t-gray-200">
                            <div className="flex items-center gap-3">
                              <span className={`text-gray-500 text-xs transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>▼</span>
                              <span className="w-8 h-8 bg-blue-50 text-blue-700 rounded-lg flex items-center justify-center text-xs font-bold">
                                {group.equipment.initials}
                              </span>
                              <span className="font-bold text-gray-800 text-sm">{group.equipment.name}</span>
                              <span className="text-xs text-gray-500">{group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}</span>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed &&
                          group.tasks.map((task) => {
                            const isSel = selected.has(task.id);
                            const pend = pending[task.id];
                            const opsValue = pend?.operations !== undefined ? pend.operations : (task.operations || "");
                            const amdValue = pend?.amd !== undefined ? pend.amd : (task.amd || "");
                            const ardValue = pend?.ard !== undefined ? pend.ard : (task.ard || "");
                            const isPending = !!pend && (pend.operations !== undefined || pend.amd !== undefined || pend.ard !== undefined);
                            return (
                              <tr
                                key={`dt-task-${task.id}`}
                                className={`transition ${isSel ? "bg-blue-50" : ""} ${isPending ? "bg-yellow-50/50" : ""} hover:bg-gray-50`}
                              >
                                <td className="px-3 py-2 border-b border-gray-100">
                                  <input type="checkbox" checked={isSel} onChange={() => toggleSelect(task.id)} className="w-4 h-4" />
                                </td>
                                <td className="px-3 py-2 border-b border-gray-100 font-semibold text-gray-800">{group.equipment.name}</td>
                                <td className="px-3 py-2 border-b border-gray-100 text-gray-700">{task.taskList}</td>
                                <td className="px-3 py-2 border-b border-gray-100">
                                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getFreqBadgeClass(task.frequency)}`}>{task.frequency || "-"}</span>
                                </td>
                                <td className="px-3 py-2 border-b border-gray-100">
                                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getPersBadgeClass(task.responsiblePersonnel || "")}`}>{task.responsiblePersonnel || "-"}</span>
                                </td>
                                <td className="px-3 py-2 border-b border-gray-100">
                                  <select disabled={!editMode} value={opsValue} onChange={(e) => onDropdownChange(task.id, "operations", e.target.value)}
                                    className={`w-auto min-w-[180px] px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPending && pend?.operations !== undefined ? "bg-yellow-50 border-yellow-400" : task.operations ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                    {VALID_OPS.map((o) => (<option key={o} value={o}>{o || "-- Select --"}</option>))}
                                  </select>
                                </td>
                                <td className="px-3 py-2 border-b border-gray-100">
                                  <select disabled={!editMode} value={amdValue} onChange={(e) => onDropdownChange(task.id, "amd", e.target.value)}
                                    className={`w-auto min-w-[180px] px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPending && pend?.amd !== undefined ? "bg-yellow-50 border-yellow-400" : task.amd ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                    {VALID_OPS.map((o) => (<option key={o} value={o}>{o || "-- Select --"}</option>))}
                                  </select>
                                </td>
                                <td className="px-3 py-2 border-b border-gray-100">
                                  <select disabled={!editMode} value={ardValue} onChange={(e) => onDropdownChange(task.id, "ard", e.target.value)}
                                    className={`w-auto min-w-[180px] px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPending && pend?.ard !== undefined ? "bg-yellow-50 border-yellow-400" : task.ard ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                    {VALID_OPS.map((o) => (<option key={o} value={o}>{o || "-- Select --"}</option>))}
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

          {/* Mobile Cards (visible only on mobile) */}
          <div className="sm:hidden">
            {isDataLoading ? (
              <div className="flex flex-col items-center gap-3 py-20 text-gray-500">
                <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                <span>Loading data...</span>
              </div>
            ) : !data?.groups.length ? (
              <div className="text-center py-20 text-gray-500">
                <h3 className="text-lg font-semibold text-gray-700 mb-1">No matching records</h3>
                <p className="text-sm">Try adjusting your search or filters.</p>
              </div>
            ) : (
              data.groups.map((group) => {
                const isCollapsed = collapsedGroups.has(group.equipment.name);
                return (
                  <div key={`mob-group-${group.equipment.id}`}>
                    {/* Mobile Group Header */}
                    <div
                      className="bg-gray-50 px-3 py-2.5 border-b border-gray-200 border-t-2 border-t-gray-200 flex items-center gap-3 cursor-pointer"
                      onClick={() => toggleGroup(group.equipment.name)}
                    >
                      <span className={`text-gray-500 text-xs transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>▼</span>
                      <span className="w-7 h-7 bg-blue-50 text-blue-700 rounded flex items-center justify-center text-xs font-bold">{group.equipment.initials}</span>
                      <span className="font-bold text-gray-800 text-sm">{group.equipment.name}</span>
                      <span className="text-xs text-gray-500 ml-auto">{group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}</span>
                    </div>
                    {/* Mobile Task Cards */}
                    {!isCollapsed &&
                      group.tasks.map((task) => {
                        const isSel = selected.has(task.id);
                        const pend = pending[task.id];
                        const opsValue = pend?.operations !== undefined ? pend.operations : (task.operations || "");
                        const amdValue = pend?.amd !== undefined ? pend.amd : (task.amd || "");
                        const ardValue = pend?.ard !== undefined ? pend.ard : (task.ard || "");
                        const isPending = !!pend && (pend.operations !== undefined || pend.amd !== undefined || pend.ard !== undefined);
                        return (
                          <div
                            key={`mob-task-${task.id}`}
                            className={`p-3 border-b border-gray-100 ${isSel ? "bg-blue-50" : ""} ${isPending ? "bg-yellow-50/50" : ""}`}
                          >
                            <div className="flex items-start gap-2 mb-2">
                              <input type="checkbox" checked={isSel} onChange={() => toggleSelect(task.id)} className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-gray-500 mb-0.5">{group.equipment.name}</div>
                                <div className="text-sm font-medium text-gray-800 leading-snug">{task.taskList}</div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mb-2 ml-6">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getFreqBadgeClass(task.frequency)}`}>{task.frequency || "-"}</span>
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getPersBadgeClass(task.responsiblePersonnel || "")}`}>{task.responsiblePersonnel || "-"}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 ml-6">
                              <div>
                                <label className="text-[0.65rem] text-gray-400 uppercase block mb-0.5">Operations</label>
                                <select disabled={!editMode} value={opsValue} onChange={(e) => onDropdownChange(task.id, "operations", e.target.value)}
                                  className={`w-auto min-w-[180px] px-1.5 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300" : "bg-gray-100 text-gray-500 border-gray-200"} ${isPending && pend?.operations !== undefined ? "bg-yellow-50 border-yellow-400" : task.operations ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                  {VALID_OPS.map((o) => (<option key={o} value={o}>{o || "--"}</option>))}
                                </select>
                              </div>
                              <div>
                                <label className="text-[0.65rem] text-gray-400 uppercase block mb-0.5">AMD</label>
                                <select disabled={!editMode} value={amdValue} onChange={(e) => onDropdownChange(task.id, "amd", e.target.value)}
                                  className={`w-auto min-w-[180px] px-1.5 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300" : "bg-gray-100 text-gray-500 border-gray-200"} ${isPending && pend?.amd !== undefined ? "bg-yellow-50 border-yellow-400" : task.amd ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                  {VALID_OPS.map((o) => (<option key={o} value={o}>{o || "--"}</option>))}
                                </select>
                              </div>
                              <div>
                                <label className="text-[0.65rem] text-gray-400 uppercase block mb-0.5">ARD</label>
                                <select disabled={!editMode} value={ardValue} onChange={(e) => onDropdownChange(task.id, "ard", e.target.value)}
                                  className={`w-auto min-w-[180px] px-1.5 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300" : "bg-gray-100 text-gray-500 border-gray-200"} ${isPending && pend?.ard !== undefined ? "bg-yellow-50 border-yellow-400" : task.ard ? "bg-yellow-50 border-yellow-400" : ""}`}>
                                  {VALID_OPS.map((o) => (<option key={o} value={o}>{o || "--"}</option>))}
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

      <footer className="text-center py-5 text-sm text-gray-500 border-t border-gray-200 mt-4">
        Maintenance Planning Post-PPP — Asset Maintenance Department
      </footer>

      {/* Floating home button for mobile */}
      <a
        href="/"
        className="fixed bottom-4 left-4 z-50 w-11 h-11 text-white rounded-full flex items-center justify-center shadow-lg text-lg hover:opacity-90 transition-transform active:scale-95 sm:hidden"
        style={{ background: '#0066A6' }}
        title="Back to Home"
      >
        ←
      </a>
    </div>
  );
}
