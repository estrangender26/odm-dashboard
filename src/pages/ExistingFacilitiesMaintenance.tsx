import { useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

/* ─── Badge helpers ─── */
const FREQ_BG: Record<string, string> = {
  daily: "#DCFCE7", weekly: "#DBEAFE", monthly: "#FEF3C7",
  quarterly: "#EDE9FE", "semi-annual": "#FFEDD5", annually: "#FEE2E2",
  "as needed": "#E2E8F0",
};
const FREQ_FG: Record<string, string> = {
  daily: "#166534", weekly: "#1E40AF", monthly: "#92400E",
  quarterly: "#5B21B6", "semi-annual": "#9A3412", annually: "#991B1B",
  "as needed": "#475569",
};
const freqBadge = (f: string) => {
  const k = f.toLowerCase();
  return { bg: FREQ_BG[k] || "#F1F5F9", fg: FREQ_FG[k] || "#64748B" };
};

const implBadge = (i: string) => {
  const il = (i || "").toLowerCase();
  if (il.includes("sla")) return { bg: "#FEF9C3", fg: "#854D0E" };
  if (il.includes("contractor") || il.includes("maintenance")) return { bg: "#E0E7FF", fg: "#3730A3" };
  if (il.includes("operator")) return { bg: "#DCFCE7", fg: "#166534" };
  return { bg: "#F1F5F9", fg: "#64748B" };
};

/* ─── Form field component ─── */
function FormField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</label>
      {type === "text" ? (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          style={{ width: "100%", padding: "8px 10px", fontSize: 12, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 6, boxSizing: "border-box" }} />
      ) : (
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", fontSize: 12, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 6, boxSizing: "border-box" }} />
      )}
    </div>
  );
}

/* ─── Form select component ─── */
function FormSelect({ label, value, onChange, options, allowEmpty, emptyLabel }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; allowEmpty?: boolean; emptyLabel?: string;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "8px 10px", fontSize: 12, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 6, boxSizing: "border-box" }}>
        {allowEmpty && <option value="">{emptyLabel || "—"}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ─── Stat Card ─── */
function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
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

const PLANT_TABS = ["All Plants", "Delos Santos PS", "East lamesa Pumping", "Modesta PS"];
const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Quarterly", "Semi-annual", "Annually", "As needed"];
const IMPLEMENTORS = ["Operator/Shifthead", "Maintenance/Contractor", "SLA"];
const STATUSES = ["Active", "Completed", "In Progress", "Overdue", "Pending"];

export default function ExistingFacilitiesMaintenance() {
  const [activePlant, setActivePlant] = useState("All Plants");
  const [search, setSearch] = useState("");
  const [freqFilter, setFreqFilter] = useState("");
  const [implFilter, setImplFilter] = useState("");
  const [equipFilter, setEquipFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    plant: "", equipmentType: "", task: "", frequency: "", implementor: "", status: "Active", lastCompleted: "", nextDue: "", remarks: "",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  // Plant filter for API
  const plantFilter = activePlant === "All Plants" ? "" : activePlant;

  const { data, isLoading } = trpc.efm.list.useQuery({
    search: search || undefined,
    plantFilter: plantFilter || undefined,
    equipFilter: equipFilter || undefined,
    freqFilter: freqFilter || undefined,
    implFilter: implFilter || undefined,
    statusFilter: statusFilter || undefined,
    page,
    pageSize: 100,
  }, { refetchInterval: 30000 });

  const { data: filterOptions } = trpc.efm.filters.useQuery(undefined, { refetchInterval: 30000 });

  const createMut = trpc.efm.create.useMutation({
    onSuccess: () => { utils.efm.list.invalidate(); utils.efm.filters.invalidate(); },
    onError: (err) => { alert("Create failed: " + err.message); console.error(err); },
  });
  const updateMut = trpc.efm.update.useMutation({
    onSuccess: () => { utils.efm.list.invalidate(); utils.efm.filters.invalidate(); },
    onError: (err) => { alert("Update failed: " + err.message); console.error(err); },
  });
  const deleteMut = trpc.efm.delete.useMutation({
    onSuccess: () => { utils.efm.list.invalidate(); },
    onError: (err) => { alert("Delete failed: " + err.message); console.error(err); },
  });
  const importMut = trpc.efm.importExcel.useMutation({
    onSuccess: () => { utils.efm.list.invalidate(); utils.efm.filters.invalidate(); alert("Import successful!"); },
    onError: (err) => { alert("Import failed: " + err.message); console.error("[IMPORT ERROR]", err); },
  });
  const seedMut = trpc.efm.seed.useMutation({
    onSuccess: (data) => { utils.efm.list.invalidate(); utils.efm.filters.invalidate(); alert(data.seeded ? `Loaded ${data.count} records!` : data.reason); },
    onError: (err) => { alert("Seed failed: " + err.message); console.error("[SEED ERROR]", err); },
  });
  const resetMut = trpc.efm.reset.useMutation({ onSuccess: () => { utils.efm.list.invalidate(); utils.efm.filters.invalidate(); } });

  // Group items by equipment type
  const groupedItems = useMemo(() => {
    if (!data?.items) return {} as Record<string, any[]>;
    const groups: Record<string, any[]> = {};
    for (const item of data.items) {
      const et = item.equipmentType || "General";
      if (!groups[et]) groups[et] = [];
      groups[et].push(item);
    }
    return groups;
  }, [data]);

  const equipmentTypeList = useMemo(() => Object.keys(groupedItems).sort(), [groupedItems]);

  // Stats
  const stats = useMemo(() => {
    const items = data?.items || [];
    return {
      total: items.length,
      plants: new Set(items.map((i: any) => i.plant)).size,
      equipTypes: new Set(items.map((i: any) => i.equipmentType)).size,
    };
  }, [data]);

  // ── Export ──
  const handleExport = useCallback(() => {
    const items = data?.items || [];
    if (!items.length) { alert("No data to export"); return; }
    const rows = items.map((item: any) => ({
      "Plant": item.plant,
      "Equipment Type": item.equipmentType,
      "Task": item.task,
      "Frequency": item.frequency,
      "Implementor": item.implementor,
      "Status": item.status,
      "Last Completed": item.lastCompleted || "",
      "Next Due": item.nextDue || "",
      "Remarks": item.remarks || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 25 }, { wch: 40 }, { wch: 50 }, { wch: 15 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Maintenance Plans");
    XLSX.writeFile(wb, "Existing_Facilities_Maintenance_Plans.xlsx");
  }, [data]);

  // ── Import ──
  const handleImport = useCallback((file: File) => {
    console.log("[IMPORT] Starting import of file:", file.name, "size:", file.size);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        console.log("[IMPORT] Sheets found:", wb.SheetNames);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows: any[] = XLSX.utils.sheet_to_json(ws);
        console.log("[IMPORT] Raw rows parsed:", rawRows.length, rawRows[0]);
        if (!rawRows.length) { alert("No data found in the Excel file"); return; }

        const rows = rawRows.map((r: any, idx: number) => {
          // Log first few rows for debugging
          if (idx < 3) console.log(`[IMPORT] Row ${idx} keys:`, Object.keys(r), "values:", r);
          const plant = String(r["Plant"] || r["plant"] || r["Facility"] || r["facility"] || r["PLANT"] || "").trim();
          const equipmentType = String(r["Equipment Type"] || r["Equipment"] || r["equipment_type"] || r["equipmentType"] || r["EQUIPMENT TYPE"] || "").trim();
          const task = String(r["Task"] || r["Tasks"] || r["task"] || r["TASK"] || r["Task Description"] || r["Maintenance Task"] || "").trim();
          const frequency = String(r["Frequency"] || r["frequency"] || r["FREQ"] || r["Freq"] || "").trim();
          const implementor = String(r["Implementor"] || r["Implementer"] || r["Responsible"] || r["Personnel"] || r["IMPLEMENTOR"] || "").trim();
          // Skip rows without plant or task
          if (!plant || !task) {
            console.log(`[IMPORT] Skipping row ${idx} (missing plant or task):`, r);
            return null;
          }
          return {
            plant,
            equipmentType,
            task,
            frequency: frequency || "As needed", // Default if blank
            implementor: implementor || undefined,
            status: String(r["Status"] || r["status"] || "Active").trim() || "Active",
            lastCompleted: (r["Last Completed"] || r["last_completed"] || "").trim() || undefined,
            nextDue: (r["Next Due"] || r["next_due"] || "").trim() || undefined,
            remarks: (r["Remarks"] || r["remarks"] || r["Notes"] || r["notes"] || "").trim() || undefined,
          };
        }).filter(Boolean);

        console.log("[IMPORT] Valid rows after filter:", rows.length);
        if (!rows.length) { alert("No valid rows found. Need Plant + Task columns. Check console for details."); return; }
        
        // Warn about rows with missing frequency
        const missingFreq = rows.filter((r: any) => !r.frequency);
        if (missingFreq.length) {
          console.log(`[IMPORT] ${missingFreq.length} rows have empty frequency, defaulting to "As needed"`);
        }
        
        importMut.mutate({ rows: rows as any[] });
      } catch (err: any) {
        console.error("[IMPORT] Parse error:", err);
        alert("Import failed: " + (err.message || "Invalid file format"));
      }
    };
    reader.onerror = () => alert("Failed to read the file");
    reader.readAsArrayBuffer(file);
  }, [importMut]);

  // ── Edit row ──
  const startEditRow = (item: any) => {
    setEditingRow(item.id);
    setEditForm({
      plant: item.plant || "",
      equipmentType: item.equipmentType || "",
      task: item.task || "",
      frequency: item.frequency || "",
      implementor: item.implementor || "",
      status: item.status || "Active",
      lastCompleted: item.lastCompleted || "",
      nextDue: item.nextDue || "",
      remarks: item.remarks || "",
    });
  };

  const saveEditRow = () => {
    if (!editingRow) return;
    updateMut.mutate({
      id: editingRow,
      plant: editForm.plant,
      equipmentType: editForm.equipmentType,
      task: editForm.task,
      frequency: editForm.frequency,
      implementor: editForm.implementor || null,
      status: editForm.status,
      lastCompleted: editForm.lastCompleted || null,
      nextDue: editForm.nextDue || null,
      remarks: editForm.remarks || null,
    });
    setEditingRow(null);
    setEditForm({});
  };

  const cancelEditRow = () => {
    setEditingRow(null);
    setEditForm({});
  };

  // ── Add record ──
  const submitAdd = () => {
    if (!addForm.plant.trim() || !addForm.task.trim() || !addForm.frequency) {
      alert("Plant, Task, and Frequency are required");
      return;
    }
    createMut.mutate({
      plant: addForm.plant.trim(),
      equipmentType: addForm.equipmentType || "",
      task: addForm.task.trim(),
      frequency: addForm.frequency,
      implementor: addForm.implementor || null,
      status: addForm.status || "Active",
      lastCompleted: addForm.lastCompleted || null,
      nextDue: addForm.nextDue || null,
      remarks: addForm.remarks || null,
    });
    setShowAddForm(false);
    setAddForm({ plant: "", equipmentType: "", task: "", frequency: "", implementor: "", status: "Active", lastCompleted: "", nextDue: "", remarks: "" });
  };

  const clearFilters = () => {
    setSearch(""); setFreqFilter(""); setImplFilter(""); setEquipFilter(""); setStatusFilter(""); setPage(1);
  };

  // Count by frequency for stat badges
  const freqCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (data?.items || []).forEach((item: any) => {
      const f = item.frequency || "Unknown";
      counts[f] = (counts[f] || 0) + 1;
    });
    return counts;
  }, [data]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#F4F7FA" }}>
      {/* ── Header ── */}
      <header style={{ background: "#16324F", padding: "12px 24px", display: "flex", alignItems: "center", gap: "16px", position: "sticky", top: 0, zIndex: 100 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" }}>
          <ProgramsEngineeringLogo size={48} borderRadius={8} />
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Existing Facilities Maintenance Plans</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.5px" }}>O &amp;M Asset Maintenance</div>
          </div>
        </Link>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={handleExport} className="efm-btn efm-export"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Export</span></button>
          <button onClick={() => fileInputRef.current?.click()} className="efm-btn efm-import"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Import</span></button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ""; }} />
          <button onClick={() => setShowAddForm(!showAddForm)} className="efm-btn efm-add"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add</span></button>
          <button onClick={() => setEditMode(!editMode)} className={`efm-btn ${editMode ? "efm-edit-active" : "efm-edit"}`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>{editMode ? "Done" : "Edit"}</span></button>
          <button onClick={() => { if (confirm("Reset all data?")) resetMut.mutate(); }} className="efm-btn efm-reset"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg><span>Reset</span></button>
        </div>
      </header>

      {/* ── Stats ── */}
      <div style={{ padding: "16px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px" }}>
          <StatCard label="Total Tasks" value={stats.total} icon="🔧" color="#005BAC" />
          <StatCard label="Facilities" value={stats.plants} icon="🏭" color="#7C3AED" />
          <StatCard label="Equip. Types" value={stats.equipTypes} icon="⚙️" color="#0EA5E9" />
          {Object.entries(freqCounts).map(([freq, count]) => {
            const b = freqBadge(freq);
            return (
              <div key={freq} style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.06)", border: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: b.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: b.fg }}>{freq.slice(0, 3)}</div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: b.fg, lineHeight: 1.2 }}>{count}</div>
                  <div style={{ fontSize: 10, color: "#8BA3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{freq}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Plant Tabs ── */}
      <div style={{ padding: "16px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: "2px", background: "#E2E8F0", padding: "4px", borderRadius: "8px" }}>
          {PLANT_TABS.map((tab) => (
            <button key={tab} onClick={() => { setActivePlant(tab); setPage(1); }}
              style={{ flex: 1, padding: "8px 16px", border: "none", borderRadius: "6px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", cursor: "pointer", transition: "all .2s", background: activePlant === tab ? "#005BAC" : "transparent", color: activePlant === tab ? "#fff" : "#5A6B7D", boxShadow: activePlant === tab ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Search & Filters ── */}
      <div style={{ padding: "16px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,.06)", border: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search plant, equipment, task..."
              style={{ flex: 1, minWidth: 200, padding: "8px 12px", fontSize: 13, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 8, outline: "none" }} />
            <select value={equipFilter} onChange={(e) => { setEquipFilter(e.target.value); setPage(1); }}
              style={{ padding: "8px 12px", fontSize: 13, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 8, minWidth: 180 }}>
              <option value="">All Equipment Types</option>
              {(filterOptions?.equipmentTypes || []).map((e: string) => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={freqFilter} onChange={(e) => { setFreqFilter(e.target.value); setPage(1); }}
              style={{ padding: "8px 12px", fontSize: 13, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 8, minWidth: 130 }}>
              <option value="">All Frequencies</option>
              {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={implFilter} onChange={(e) => { setImplFilter(e.target.value); setPage(1); }}
              style={{ padding: "8px 12px", fontSize: 13, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 8, minWidth: 160 }}>
              <option value="">All Implementors</option>
              {IMPLEMENTORS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              style={{ padding: "8px 12px", fontSize: 13, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 8, minWidth: 130 }}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={clearFilters}
              style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* ── Add Form ── */}
      {showAddForm && (
        <div style={{ padding: "16px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ background: "#FAFBFC", borderRadius: 12, padding: "20px", border: "1px solid #E2E8F0" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#16324F" }}>Add New Maintenance Record</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              <FormSelect label="Plant *" value={addForm.plant} onChange={(v) => setAddForm({ ...addForm, plant: v })} options={PLANT_TABS.filter((p) => p !== "All Plants")} />
              <FormField label="Equipment Type" value={addForm.equipmentType} onChange={(v) => setAddForm({ ...addForm, equipmentType: v })} placeholder="e.g., 1. Generator Set" />
              <FormField label="Task *" value={addForm.task} onChange={(v) => setAddForm({ ...addForm, task: v })} placeholder="e.g., Inspect for leaks" />
              <FormSelect label="Frequency *" value={addForm.frequency} onChange={(v) => setAddForm({ ...addForm, frequency: v })} options={FREQUENCIES} />
              <FormSelect label="Implementor" value={addForm.implementor} onChange={(v) => setAddForm({ ...addForm, implementor: v })} options={IMPLEMENTORS} allowEmpty emptyLabel="Select..." />
              <FormSelect label="Status" value={addForm.status} onChange={(v) => setAddForm({ ...addForm, status: v })} options={STATUSES} />
              <FormField label="Last Completed" value={addForm.lastCompleted} onChange={(v) => setAddForm({ ...addForm, lastCompleted: v })} type="date" />
              <FormField label="Next Due" value={addForm.nextDue} onChange={(v) => setAddForm({ ...addForm, nextDue: v })} type="date" />
              <FormField label="Remarks" value={addForm.remarks} onChange={(v) => setAddForm({ ...addForm, remarks: v })} placeholder="Notes..." />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={submitAdd} style={{ padding: "10px 24px", fontSize: 13, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#005BAC", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Save Record</button>
              <button onClick={() => setShowAddForm(false)} style={{ padding: "10px 24px", fontSize: 13, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Data Table ── */}
      <div style={{ flex: 1, padding: "16px 24px 24px", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", border: "1px solid #D6DFE8", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#16324F" }}>Maintenance Records</span>
            <span style={{ fontSize: 12, color: "#8BA3B8" }}>{data?.total || 0} records</span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>No.</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Plant</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Equipment Type</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Task</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Frequency</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Implementor</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Status</th>
                  {editMode && <th style={{ textAlign: "left", padding: "10px 12px", color: "#475569", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={editMode ? 8 : 7} style={{ padding: "40px", textAlign: "center", color: "#8BA3B8" }}>Loading...</td></tr>
                ) : equipmentTypeList.length === 0 ? (
                  <tr><td colSpan={editMode ? 8 : 7} style={{ padding: "40px", textAlign: "center" }}>
                    <div style={{ fontSize: 14, color: "#8BA3B8", marginBottom: 12 }}>No maintenance records found</div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                      <button onClick={() => seedMut.mutate()} disabled={seedMut.isPending}
                        style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#005BAC", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                        {seedMut.isPending ? "Loading..." : "Load Sample Data"}
                      </button>
                      <button onClick={() => fileInputRef.current?.click()}
                        style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 6, cursor: "pointer" }}>
                        Import Excel
                      </button>
                    </div>
                  </td></tr>
                ) : (
                  equipmentTypeList.map((equipType) => (
                    <>
                      {/* Equipment Type Group Header */}
                      <tr key={`group-${equipType}`}>
                        <td colSpan={editMode ? 8 : 7} style={{ padding: "8px 12px", background: "#F1F5F9", fontWeight: 700, fontSize: 12, color: "#16324F", borderTop: "2px solid #CBD5E1" }}>
                          {equipType}
                        </td>
                      </tr>
                      {/* Records under this equipment type */}
                      {groupedItems[equipType].map((item: any, idx: number) => {
                        const fBadge = freqBadge(item.frequency);
                        const iBadge = implBadge(item.implementor);
                        const isEditing = editingRow === item.id;
                        return (
                          <tr key={item.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                            {isEditing && editMode ? (
                              <>
                                <td style={{ padding: "6px 12px", color: "#94A3B8" }}>{idx + 1}</td>
                                <td style={{ padding: "6px" }}><input value={editForm.plant || ""} onChange={(e) => setEditForm({ ...editForm, plant: e.target.value })} style={{ width: "100%", fontSize: 11, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                                <td style={{ padding: "6px" }}><input value={editForm.equipmentType || ""} onChange={(e) => setEditForm({ ...editForm, equipmentType: e.target.value })} style={{ width: "100%", fontSize: 11, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                                <td style={{ padding: "6px" }}><input value={editForm.task || ""} onChange={(e) => setEditForm({ ...editForm, task: e.target.value })} style={{ width: "100%", fontSize: 11, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }} /></td>
                                <td style={{ padding: "6px" }}>
                                  <select value={editForm.frequency || ""} onChange={(e) => setEditForm({ ...editForm, frequency: e.target.value })} style={{ fontSize: 11, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }}>
                                    {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                                  </select>
                                </td>
                                <td style={{ padding: "6px" }}>
                                  <select value={editForm.implementor || ""} onChange={(e) => setEditForm({ ...editForm, implementor: e.target.value })} style={{ fontSize: 11, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }}>
                                    <option value="">—</option>
                                    {IMPLEMENTORS.map((i) => <option key={i} value={i}>{i}</option>)}
                                  </select>
                                </td>
                                <td style={{ padding: "6px" }}>
                                  <select value={editForm.status || ""} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} style={{ fontSize: 11, padding: 4, border: "1px solid #D6DFE8", borderRadius: 4 }}>
                                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td style={{ padding: "6px", whiteSpace: "nowrap" }}>
                                  <button onClick={saveEditRow} style={{ fontSize: 11, padding: "3px 8px", background: "#1F9D55", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Save</button>
                                  <button onClick={cancelEditRow} style={{ fontSize: 11, padding: "3px 8px", background: "#F1F5F9", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer", marginLeft: 4 }}>Cancel</button>
                                </td>
                              </>
                            ) : (
                              <>
                                <td style={{ padding: "8px 12px", color: "#94A3B8", fontWeight: 600, fontSize: 11 }}>{idx + 1}</td>
                                <td style={{ padding: "8px 12px", color: "#2D3748", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>{item.plant}</td>
                                <td style={{ padding: "8px 12px", color: "#4A5568", fontSize: 11, maxWidth: 300 }}>
                                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.equipmentType}</div>
                                </td>
                                <td style={{ padding: "8px 12px", color: "#4A5568", fontSize: 11 }}>
                                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{item.task}</div>
                                </td>
                                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: fBadge.bg, color: fBadge.fg }}>{item.frequency}</span>
                                </td>
                                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: iBadge.bg, color: iBadge.fg }}>{item.implementor || "—"}</span>
                                </td>
                                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: "#F0FDF4", color: "#15803D", border: "1px solid #86EFAC" }}>{item.status}</span>
                                </td>
                                {editMode && (
                                  <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                                    <button onClick={() => startEditRow(item)} style={{ fontSize: 11, padding: "3px 8px", background: "#EFF6FF", color: "#005BAC", border: "none", borderRadius: 4, cursor: "pointer" }}>Edit</button>
                                    <button onClick={() => { if (confirm("Delete this record?")) deleteMut.mutate({ id: item.id }); }} style={{ fontSize: 11, padding: "3px 8px", background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 4, cursor: "pointer", marginLeft: 4 }}>Delete</button>
                                  </td>
                                )}
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ borderTop: "1px solid #D6DFE8", padding: "16px 24px", textAlign: "right", fontSize: 11, color: "#5A6B7D" }}>
        Program Oversight Center &copy; 2026
      </footer>

      {/* ── Styles ── */}
      <style>{`
        .efm-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 12px; font-weight: 600; font-family: Inter, sans-serif; border: none; border-radius: 6px; cursor: pointer; transition: all .15s; white-space: nowrap; color: #fff; }
        .efm-export { background: #1F9D55; } .efm-export:hover { background: #15803D; }
        .efm-import { background: #005BAC; } .efm-import:hover { background: #004D99; }
        .efm-add { background: #7C3AED; } .efm-add:hover { background: #6D28D9; }
        .efm-edit { background: #0EA5E9; } .efm-edit:hover { background: #0284C7; }
        .efm-edit-active { background: #64748B; } .efm-edit-active:hover { background: #475569; }
        .efm-reset { background: #DC2626; } .efm-reset:hover { background: #B91C1C; }
        @media (max-width: 768px) {
          .efm-btn { padding: 6px 10px; font-size: 11px; }
        }
        @media (max-width: 480px) {
          .efm-btn span { display: none; }
          .efm-btn { padding: 6px 8px; }
        }
      `}</style>
    </div>
  );
}
