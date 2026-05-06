import { useState, useCallback, useRef, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";

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
  const { user, isAuthenticated, isLoading } = useAuth();

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

  // tRPC queries
  const utils = trpc.useUtils();
  const { data, isLoading: isDataLoading } = trpc.tasks.list.useQuery({
    dataset: activeTab,
    search: search || undefined,
    equipFilter: equipFilter || undefined,
    freqFilter: freqFilter || undefined,
    personFilter: personFilter || undefined,
  });

  const { data: filters } = trpc.tasks.filters.useQuery({ dataset: activeTab });

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
    },
  });

  const importMutation = trpc.tasks.import.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      utils.tasks.export.invalidate();
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
    const result = await utils.tasks.export.fetch({
      dataset: activeTab,
      selectedIds: selectedOnly && selected.size > 0 ? Array.from(selected) : undefined,
    });
    if (!result) return;

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
  }, [activeTab, selected, utils.tasks.export]);

  // Import
  const handleImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawText = e.target?.result as string;
      const text = rawText.charCodeAt(0) === 0xfeff ? rawText.substring(1) : rawText;
      const rows = parseCsv(text);
      if (rows.length < 2) { alert("CSV is empty or invalid"); return; }
      const headers = rows[0];
      const eqIdx = headers.indexOf("Equipment Type");
      const taskIdx = headers.indexOf("Task Description");
      const opsIdx = headers.indexOf("Operations");
      const amdIdx = headers.indexOf("AMD");
      const ardIdx = headers.indexOf("ARD");
      if (eqIdx < 0 || taskIdx < 0) { alert("Missing required columns: Equipment Type, Task Description"); return; }

      const updates = rows.slice(1).map((row) => ({
        equipmentType: row[eqIdx] || "",
        taskList: row[taskIdx] || "",
        operations: opsIdx >= 0 ? (row[opsIdx] || null) : undefined,
        amd: amdIdx >= 0 ? (row[amdIdx] || null) : undefined,
        ard: ardIdx >= 0 ? (row[ardIdx] || null) : undefined,
      })).filter((u) => u.equipmentType && u.taskList);

      importMutation.mutate(updates, {
        onSuccess: (res) => {
          alert(`Imported ${res.updated} rows`);
        },
      });
    };
    reader.readAsText(file);
  }, [importMutation]);

  // Loading state
  if (isLoading) {
    return <div className="flex items-center justify-center h-screen text-gray-500">Loading...</div>;
  }

  // Auth gate (optional - show login prompt)
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <h1 className="text-2xl font-bold text-gray-800">ODM Dashboard</h1>
        <p className="text-gray-500">Please sign in to access the dashboard</p>
        <a
          href="/api/oauth/authorize"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
        >
          Sign In with Kimi
        </a>
      </div>
    );
  }

  const tabLabel = activeTab === "htt" ? "HTT STP" : "Aglipay STP";
  const totalTasks = data?.totalTasks ?? 0;
  const totalGroups = data?.groups.length ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1a365d] text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center text-xl">⚙️</div>
            <div>
              <h1 className="text-xl font-bold">Equipment Maintenance Dashboard</h1>
              <p className="text-sm opacity-70">HTT STP &amp; Aglipay STP — Multi-User</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2 text-sm">
                <img src={user.avatar || undefined} alt="" className="w-8 h-8 rounded-full bg-white/20" />
                <span>{user.name}</span>
              </div>
            )}
            <div className="flex gap-2">
              <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center">
                <div className="text-lg font-bold">976</div>
                <div className="text-[0.65rem] uppercase opacity-70">HTT STP</div>
              </div>
              <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center">
                <div className="text-lg font-bold">401</div>
                <div className="text-[0.65rem] uppercase opacity-70">Aglipay STP</div>
              </div>
              <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center">
                <div className="text-lg font-bold">128</div>
                <div className="text-[0.65rem] uppercase opacity-70">Equip. Types</div>
              </div>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-[1600px] mx-auto px-6 flex gap-1">
          <button
            onClick={() => setActiveTab("htt")}
            className={`px-5 py-3 rounded-t-lg text-sm font-semibold flex items-center gap-2 transition ${
              activeTab === "htt" ? "bg-[#2c5282] text-white" : "text-white/60 hover:text-white/85 hover:bg-white/5"
            }`}
          >
            📋 HTT STP <span className="bg-white/20 text-[0.7rem] px-2 py-0.5 rounded-full">976</span>
          </button>
          <button
            onClick={() => setActiveTab("aglipay")}
            className={`px-5 py-3 rounded-t-lg text-sm font-semibold flex items-center gap-2 transition ${
              activeTab === "aglipay" ? "bg-[#2c5282] text-white" : "text-white/60 hover:text-white/85 hover:bg-white/5"
            }`}
          >
            🔧 Aglipay STP <span className="bg-white/20 text-[0.7rem] px-2 py-0.5 rounded-full">401</span>
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
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <div className="relative flex-1 min-w-[220px] max-w-[360px]">
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
          <select
            value={equipFilter}
            onChange={(e) => setEquipFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white min-w-[160px]"
          >
            <option value="">All Equipment Types</option>
            {filters?.equipment.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          <select
            value={freqFilter}
            onChange={(e) => setFreqFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white min-w-[160px]"
          >
            <option value="">All Frequencies</option>
            {filters?.frequencies.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          {activeTab === "aglipay" && (
            <select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white min-w-[160px]"
            >
              <option value="">All Personnel</option>
              {filters?.personnel.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          <div className="ml-auto text-sm text-gray-500">
            {isDataLoading ? "Loading..." : `Showing <strong>${totalTasks}</strong> tasks in <strong>${totalGroups}</strong> groups`}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap gap-2 mb-4 p-3 bg-white border border-gray-200 rounded-lg items-center">
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
          <div className="ml-auto flex gap-2 flex-wrap">
            {!editMode ? (
              <button onClick={startEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 flex items-center gap-2">
                ✏️ Edit
              </button>
            ) : (
              <>
                <button onClick={saveEdit} className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold hover:bg-green-800 flex items-center gap-2">
                  💾 Save
                </button>
                <button onClick={cancelEdit} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-200 flex items-center gap-2">
                  ✕ Cancel
                </button>
              </>
            )}
            <button onClick={() => handleExport(true)} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 flex items-center gap-2">
              📄 Export Selected
            </button>
            <button onClick={() => handleExport(false)} className="px-4 py-2 bg-[#1a365d] text-white rounded-lg text-sm font-semibold hover:bg-[#2c5282] flex items-center gap-2">
              ⬇️ Export All
            </button>
            <label className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 flex items-center gap-2 cursor-pointer">
              📂 Import
              <input
                type="file"
                accept=".csv"
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

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="w-10 px-3 py-3 text-left"></th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Equipment Type</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Task Description</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Frequency</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Responsible</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">Operations</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">AMD</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide">ARD</th>
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
                data.groups.map((group, gidx) => {
                  const isCollapsed = collapsedGroups.has(group.equipment.name);
                  return (
                    <>
                      {/* Group header */}
                      <tr
                        key={`group-${group.equipment.id}`}
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
                      {/* Task rows */}
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
                              key={task.id}
                              className={`transition ${isSel ? "bg-blue-50" : ""} ${isPending ? "bg-yellow-50/50" : ""} hover:bg-gray-50`}
                            >
                              <td className="px-3 py-2 border-b border-gray-100">
                                <input
                                  type="checkbox"
                                  checked={isSel}
                                  onChange={() => toggleSelect(task.id)}
                                  className="w-4 h-4"
                                />
                              </td>
                              <td className="px-3 py-2 border-b border-gray-100 font-semibold text-gray-800">{task.equipmentId ? group.equipment.name : ""}</td>
                              <td className="px-3 py-2 border-b border-gray-100 text-gray-700">{task.taskList}</td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getFreqBadgeClass(task.frequency)}`}>
                                  {task.frequency || "-"}
                                </span>
                              </td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getPersBadgeClass(task.responsiblePersonnel || "")}`}>
                                  {task.responsiblePersonnel || "-"}
                                </span>
                              </td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <select
                                  disabled={!editMode}
                                  value={opsValue}
                                  onChange={(e) => onDropdownChange(task.id, "operations", e.target.value)}
                                  className={`w-full px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPending && pend?.operations !== undefined ? "bg-yellow-50 border-yellow-400" : task.operations ? "bg-yellow-50 border-yellow-400" : ""}`}
                                >
                                  {VALID_OPS.map((o) => (
                                    <option key={o} value={o}>{o || "-- Select --"}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <select
                                  disabled={!editMode}
                                  value={amdValue}
                                  onChange={(e) => onDropdownChange(task.id, "amd", e.target.value)}
                                  className={`w-full px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPending && pend?.amd !== undefined ? "bg-yellow-50 border-yellow-400" : task.amd ? "bg-yellow-50 border-yellow-400" : ""}`}
                                >
                                  {VALID_OPS.map((o) => (
                                    <option key={o} value={o}>{o || "-- Select --"}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2 border-b border-gray-100">
                                <select
                                  disabled={!editMode}
                                  value={ardValue}
                                  onChange={(e) => onDropdownChange(task.id, "ard", e.target.value)}
                                  className={`w-full px-2 py-1 border rounded text-xs ${editMode ? "bg-white border-gray-300 cursor-pointer" : "bg-gray-100 text-gray-500 cursor-default border-gray-200"} ${isPending && pend?.ard !== undefined ? "bg-yellow-50 border-yellow-400" : task.ard ? "bg-yellow-50 border-yellow-400" : ""}`}
                                >
                                  {VALID_OPS.map((o) => (
                                    <option key={o} value={o}>{o || "-- Select --"}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      <footer className="text-center py-5 text-sm text-gray-500 border-t border-gray-200 mt-4">
        ODM Dashboard — Multi-User Equipment Maintenance System
      </footer>
    </div>
  );
}
