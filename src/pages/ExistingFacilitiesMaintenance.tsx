import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";

/* ============================================================
   EQUIPMENT TYPE INFERENCE ENGINE
   Maps task names / descriptions to standardized Equipment Types
   ============================================================ */
const EQUIPMENT_TYPE_MAP: { keywords: string[]; type: string }[] = [
  { keywords: ["pump", "pumps", "impeller", "suction", "discharge", "priming", "cavitation", "volute"], type: "Pumps" },
  { keywords: ["motor", "motors", "bearing", "stator", "rotor", "winding", "motorized", "blower motor", "pump motor"], type: "Motors" },
  { keywords: ["blower", "blowers", "aerator", "aeration", "air blower", "diffuser"], type: "Blowers" },
  { keywords: ["valve", "valves", "gate valve", "check valve", "butterfly valve", "ball valve", "control valve", "isolation valve"], type: "Valves" },
  { keywords: ["generator", "generators", "gen set", "genset", "emergency power", "backup power"], type: "Generators" },
  { keywords: ["transformer", "transformers", "step up", "step down", "voltage regulator", "mcc"], type: "Transformers" },
  { keywords: ["instrument", "instruments", "sensor", "probe", "flow meter", "level sensor", "pressure gauge", "transmitter", "analyzer"], type: "Instrumentation" },
  { keywords: ["plc", "scada", "hmi", "automation", "control panel", "plc/scada", "rtu", "telemetry", "control system"], type: "PLC / SCADA" },
  { keywords: ["hvac", "aircon", "air conditioning", "ventilation", "cooling", "exhaust fan", "supply fan", "ahu"], type: "HVAC" },
  { keywords: ["compressor", "compressors", "air compressor", "pneumatic"], type: "Compressors" },
  { keywords: ["chemical dosing", "dosing pump", "chlorinator", "hypochlorite", "polymer", "coagulant", "disinfection", "chemical feed"], type: "Chemical Dosing Systems" },
  { keywords: ["screen", "screens", "bar screen", "fine screen", "coarse screen", "grit"], type: "Screens" },
  { keywords: ["clarifier", "clarifiers", "sedimentation", "settling tank", "thickener"], type: "Clarifiers" },
  { keywords: ["filter", "filters", "sand filter", "carbon filter", "membrane", "uf", "mf", "ro", "media filter"], type: "Filters" },
  { keywords: ["uv", "ultraviolet", "ozone", "disinfection unit"], type: "UV / Disinfection" },
  { keywords: ["tank", "tanks", "storage tank", "equalization tank", "reservoir", "sump"], type: "Tanks" },
  { keywords: ["pipe", "piping", "pipeline", "conduit", "manhole", "sewer"], type: "Piping" },
  { keywords: ["crane", "hoist", "lifting", "chain block", "trolley"], type: "Lifting Equipment" },
  { keywords: ["forklift", "loader", "vehicle", "truck", "van"], type: "Vehicles" },
  { keywords: ["fire", "fire alarm", "smoke detector", "sprinkler", "fire extinguisher", "fire pump"], type: "Fire Safety" },
  { keywords: ["security", "cctv", "camera", "access control", "alarm system"], type: "Security Systems" },
  { keywords: ["lighting", "lights", "lamp", "fixture", "emergency light"], type: "Lighting" },
  { keywords: ["generator set", "genset", "gen set"], type: "Generator Set" },
  { keywords: ["switchgear", "switch", "breaker", "mcb", "mccb", "relay", "contactor"], type: "Switchgear" },
  { keywords: ["dgps", "gps", "survey", "alignment"], type: "Survey Equipment" },
  { keywords: ["diesel", "diesel engine", "engine"], type: "Diesel Engines" },
  { keywords: ["feedwater", "boiler", "steam"], type: "Boiler / Feedwater" },
  { keywords: ["sludge", "dewatering", "centrifuge", "belt press", "sludge pump"], type: "Sludge Handling" },
  { keywords: ["odor", "deodorization", "biofilter", "carbon scrubber"], type: "Odor Control" },
  { keywords: [" blower"], type: "Blowers" },
  { keywords: [" blower motor"], type: "Motors" },
];

// Ordered list for display — "General" always at end
const EQUIPMENT_TYPE_ORDER = [
  "Pumps", "Motors", "Blowers", "Valves", "Generators", "Transformers",
  "Instrumentation", "PLC / SCADA", "HVAC", "Compressors", "Chemical Dosing Systems",
  "Screens", "Clarifiers", "Filters", "UV / Disinfection", "Tanks", "Piping",
  "Lifting Equipment", "Vehicles", "Fire Safety", "Security Systems", "Lighting",
  "Generator Set", "Switchgear", "Diesel Engines", "Boiler / Feedwater",
  "Sludge Handling", "Odor Control", "General",
];

function inferEquipmentType(text: string, existingType?: string): string {
  // If a valid explicit type is provided, normalize and use it
  if (existingType) {
    const trimmed = existingType.trim();
    if (trimmed.length > 0 && trimmed !== "-" && trimmed !== "N/A" && trimmed !== "General") {
      // Normalize known variants
      const lower = trimmed.toLowerCase();
      for (const mapping of EQUIPMENT_TYPE_MAP) {
        for (const kw of mapping.keywords) {
          if (lower.includes(kw.toLowerCase())) return mapping.type;
        }
      }
      // If no keyword match but it's a reasonable name, use as-is with title case
      return toTitleCase(trimmed);
    }
  }
  // Infer from task / description text
  if (!text) return "General";
  const lower = text.toLowerCase();
  for (const mapping of EQUIPMENT_TYPE_MAP) {
    for (const kw of mapping.keywords) {
      if (lower.includes(kw.toLowerCase())) return mapping.type;
    }
  }
  return "General";
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Sort equipment types: known types first (in defined order), then alphabetically
function sortEquipmentTypes(types: string[]): string[] {
  const orderMap = new Map(EQUIPMENT_TYPE_ORDER.map((t, i) => [t, i]));
  return [...types].sort((a, b) => {
    const oa = orderMap.get(a) ?? 999;
    const ob = orderMap.get(b) ?? 999;
    if (oa !== 999 && ob !== 999) return oa - ob;
    if (oa !== 999) return -1;
    if (ob !== 999) return 1;
    return a.localeCompare(b);
  });
}

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

/* ─── Status badge color ─── */
const STATUS_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  "Active":     { bg: "#F0FDF4", color: "#15803D", border: "#86EFAC" },
  "Completed":  { bg: "#DBEAFE", color: "#1E40AF", border: "#93C5FD" },
  "In Progress":{ bg: "#FEF3C7", color: "#92400E", border: "#FDE68A" },
  "Overdue":    { bg: "#FEE2E2", color: "#DC2626", border: "#FECACA" },
  "Pending":    { bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB" },
};
function statusBadgeStyle(s: string) {
  return STATUS_STYLES[s] || STATUS_STYLES["Pending"];
}

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
function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
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

// Plant list is now fully dynamic from filterOptions.plants — no hardcoded facilities
const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Quarterly", "Semi-annual", "Annually", "As needed"];
const IMPLEMENTORS = ["Operator/Shifthead", "Maintenance/Contractor", "SLA"];
const STATUSES = ["Active", "Completed", "In Progress", "Overdue", "Pending"];

/* ============================================================
   Equipment Type Group Summary
   ============================================================ */
interface EquipGroupSummary {
  type: string;
  count: number;
  implementors: Set<string>;
  freqDist: Record<string, number>;
  statusDist: Record<string, number>;
  overdue: number;
}

function computeGroupSummaries(items: any[]): Record<string, EquipGroupSummary> {
  const groups: Record<string, EquipGroupSummary> = {};
  for (const item of items) {
    const et = item.equipmentType || "General";
    if (!groups[et]) {
      groups[et] = { type: et, count: 0, implementors: new Set(), freqDist: {}, statusDist: {}, overdue: 0 };
    }
    const g = groups[et];
    g.count++;
    if (item.implementor) g.implementors.add(item.implementor);
    const f = item.frequency || "Unknown";
    g.freqDist[f] = (g.freqDist[f] || 0) + 1;
    const s = item.status || "Pending";
    g.statusDist[s] = (g.statusDist[s] || 0) + 1;
    if (s === "Overdue") g.overdue++;
  }
  return groups;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
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
  // Collapsible group state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Equipment Type grouping view toggle
  const [groupByEquip, setGroupByEquip] = useState(true);

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
    pageSize: 500, // Load more for grouping
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
  // Import progress state
  const [importProgress, setImportProgress] = useState<{total: number; imported: number; skipped: number; status: string} | null>(null);
  const [importSummary, setImportSummary] = useState<{total: number; imported: number; skipped: number; failed: number} | null>(null);

  const importMut = trpc.efm.importExcel.useMutation({
    onSuccess: (res) => {
      setImportProgress((prev) => prev ? { ...prev, imported: (prev?.imported || 0) + res.count, status: `Imported ${(prev?.imported || 0) + res.count} of ${prev?.total || 0}` } : null);
    },
    onError: (err) => { console.error("[IMPORT ERROR]", err); },
  });

  // Auto-seed on first load if no data exists
  useEffect(() => {
    if (!isLoading && data && data.total === 0) {
      console.log("[AUTO-SEED] No data found, auto-seeding...");
      seedMut.mutate();
    }
  }, [isLoading, data?.total]);

  const seedMut = trpc.efm.seed.useMutation({
    onSuccess: (data) => {
      utils.efm.list.invalidate();
      utils.efm.filters.invalidate();
      if (data.seeded) {
        const msg = `Loaded ${data.count} of ${data.total} records` + (data.failed ? ` (${data.failed} failed)` : "");
        alert(msg);
      } else {
        alert(data.reason);
      }
    },
    onError: (err) => { alert("Seed failed: " + err.message); console.error("[SEED ERROR]", err); },
  });
  const resetMut = trpc.efm.reset.useMutation({ onSuccess: () => { utils.efm.list.invalidate(); utils.efm.filters.invalidate(); } });

  // Enhance items with inferred equipment types
  const enhancedItems = useMemo(() => {
    const items = data?.items || [];
    return items.map((item: any) => ({
      ...item,
      _inferredType: inferEquipmentType(item.task || item.description || "", item.equipmentType || undefined),
    }));
  }, [data]);

  // Group items by (inferred) equipment type
  const groupedItems = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const item of enhancedItems) {
      const et = item._inferredType || item.equipmentType || "General";
      if (!groups[et]) groups[et] = [];
      groups[et].push(item);
    }
    return groups;
  }, [enhancedItems]);

  const equipmentTypeList = useMemo(() => sortEquipmentTypes(Object.keys(groupedItems)), [groupedItems]);

  // Group summaries
  const groupSummaries = useMemo(() => computeGroupSummaries(enhancedItems), [enhancedItems]);

  // Stats
  const stats = useMemo(() => {
    const items = enhancedItems;
    const summaries = Object.values(groupSummaries);
    const largestGroup = summaries.reduce((a, b) => (a.count > b.count ? a : b), summaries[0] || { type: "-", count: 0 });
    const typesWithMissing = summaries.filter((g) => g.overdue > 0 || (g.statusDist["Not Started"] || 0) > 0).length;
    return {
      total: items.length,
      plants: new Set(items.map((i: any) => i.plant)).size,
      equipTypes: Object.keys(groupedItems).size,
      largestGroup: largestGroup.type,
      largestGroupCount: largestGroup.count,
      avgPerType: Object.keys(groupedItems).length > 0 ? Math.round(items.length / Object.keys(groupedItems).length) : 0,
      typesWithMissing,
    };
  }, [enhancedItems, groupSummaries, groupedItems]);

  // ── Expand / Collapse ──
  const toggleGroup = (type: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };
  const expandAll = () => setCollapsedGroups(new Set());
  const collapseAll = () => setCollapsedGroups(new Set(equipmentTypeList));

  // ── Export ──
  const handleExport = useCallback(() => {
    const items = data?.items || [];
    if (!items.length) { alert("No data to export"); return; }
    const rows = items.map((item: any) => ({
      "Plant": item.plant,
      "Equipment Type": item.equipmentType || inferEquipmentType(item.task || "", item.equipmentType || undefined),
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

  // ── Import with progress bar (batched) ──
  const handleImport = useCallback(async (file: File) => {
    setImportSummary(null);
    console.log("[IMPORT] Starting import of file:", file.name, "size:", file.size);

    const fileData = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target?.result as ArrayBuffer));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsArrayBuffer(file);
    });

    const wb = XLSX.read(fileData, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(ws);
    console.log("[IMPORT] Raw rows parsed:", rawRows.length);
    if (!rawRows.length) { alert("No data found in the Excel file"); return; }

    // Clean and validate rows with equipment type inference
    const rows = rawRows.map((r: any) => {
      const plant = String(r["Plant"] || r["plant"] || r["Facility"] || r["facility"] || r["PLANT"] || "").trim();
      const rawEquipType = String(r["Equipment Type"] || r["Equipment"] || r["equipment_type"] || r["equipmentType"] || r["EQUIPMENT TYPE"] || "").trim();
      const task = String(r["Task"] || r["Tasks"] || r["task"] || r["TASK"] || r["Task Description"] || r["Maintenance Task"] || "").trim();
      const frequency = String(r["Frequency"] || r["frequency"] || r["FREQ"] || r["Freq"] || "").trim();
      const implementor = String(r["Implementor"] || r["Implementer"] || r["Responsible"] || r["Personnel"] || r["IMPLEMENTOR"] || "").trim();
      // Infer equipment type from task if not explicitly provided
      const equipmentType = rawEquipType || inferEquipmentType(task, undefined);
      if (!plant || !task) return null;
      return {
        plant, equipmentType, task,
        frequency: frequency || "As needed",
        implementor: implementor || undefined,
        status: String(r["Status"] || r["status"] || "Active").trim() || "Active",
        lastCompleted: (r["Last Completed"] || r["last_completed"] || "").trim() || undefined,
        nextDue: (r["Next Due"] || r["next_due"] || "").trim() || undefined,
        remarks: (r["Remarks"] || r["remarks"] || r["Notes"] || r["notes"] || "").trim() || undefined,
      };
    }).filter(Boolean) as any[];

    if (!rows.length) { alert("No valid rows found. Need Plant + Task columns."); return; }

    setImportProgress({ total: rows.length, imported: 0, skipped: 0, status: `Importing 0 of ${rows.length}...` });

    const BATCH_SIZE = 100;
    let totalImported = 0;
    let totalFailed = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      setImportProgress({ total: rows.length, imported: totalImported, skipped: 0, status: `Importing ${totalImported + batch.length} of ${rows.length}...` });

      try {
        const result = await importMut.mutateAsync({ rows: batch });
        totalImported += result.count;
      } catch (err: any) {
        console.error(`[IMPORT] Batch ${i}-${i + BATCH_SIZE} failed:`, err.message);
        totalFailed += batch.length;
      }
    }

    setImportProgress(null);
    setImportSummary({ total: rows.length, imported: totalImported, skipped: rows.length - totalImported - totalFailed, failed: totalFailed });
    utils.efm.list.invalidate();
    utils.efm.filters.invalidate();
  }, [importMut, utils]);

  // ── Edit row ──
  const startEditRow = (item: any) => {
    setEditingRow(item.id);
    setEditForm({
      plant: item.plant || "",
      equipmentType: item.equipmentType || item._inferredType || "",
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
      equipmentType: addForm.equipmentType || inferEquipmentType(addForm.task, addForm.equipmentType || undefined),
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

  // Equipment type color map for visual distinction
  const equipColors = useMemo(() => {
    const palette = ["#005BAC", "#0EA5E9", "#7C3AED", "#DC2626", "#F59E0B", "#1F9D55", "#EC4899", "#6366F1", "#14B8A6", "#8B5CF6", "#F97316", "#06B6D4"];
    const map: Record<string, string> = {};
    equipmentTypeList.forEach((et, i) => { map[et] = palette[i % palette.length]; });
    return map;
  }, [equipmentTypeList]);

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
          <StatCard label="Total Tasks" value={stats.total} icon="🔧" color="#005BAC" />
          <StatCard label="Facilities" value={stats.plants} icon="🏭" color="#7C3AED" />
          <StatCard label="Equip. Types" value={stats.equipTypes} icon="⚙️" color="#0EA5E9" />
          <StatCard label="Largest Group" value={stats.largestGroup} icon="📊" color="#F59E0B" />
          <StatCard label="Avg PMs / Type" value={stats.avgPerType} icon="📈" color="#1F9D55" />
          <StatCard label="Types w/ Issues" value={stats.typesWithMissing} icon="⚠️" color="#DC2626" />
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

      {/* ── Import Progress Bar ── */}
      {importProgress && (
        <div style={{ padding: "16px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,.06)", border: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#16324F" }}>📥 {importProgress.status}</span>
              <span style={{ fontSize: 12, color: "#8BA3B8" }}>{Math.round((importProgress.imported / importProgress.total) * 100)}%</span>
            </div>
            <div style={{ width: "100%", height: 8, background: "#E2E8F0", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, (importProgress.imported / importProgress.total) * 100)}%`, height: "100%", background: "linear-gradient(90deg, #005BAC, #3B82F6)", borderRadius: 4, transition: "width 0.3s ease" }} />
            </div>
          </div>
        </div>
      )}

      {/* ── Import Summary ── */}
      {importSummary && (
        <div style={{ padding: "16px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ background: "#F0FDF4", borderRadius: 12, padding: "16px 20px", border: "1px solid #86EFAC", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#166534" }}>✅ Import Complete</span>
            <span style={{ fontSize: 12, color: "#166534" }}>Total: <b>{importSummary.total}</b></span>
            <span style={{ fontSize: 12, color: "#15803D" }}>Imported: <b>{importSummary.imported}</b></span>
            {importSummary.skipped > 0 && <span style={{ fontSize: 12, color: "#D97706" }}>Skipped: <b>{importSummary.skipped}</b></span>}
            {importSummary.failed > 0 && <span style={{ fontSize: 12, color: "#DC2626" }}>Failed: <b>{importSummary.failed}</b></span>}
            <button onClick={() => setImportSummary(null)} style={{ marginLeft: "auto", fontSize: 11, padding: "4px 10px", background: "#fff", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 4, cursor: "pointer" }}>Dismiss</button>
          </div>
        </div>
      )}

      {/* ── Facility Dropdown ── */}
      <div style={{ padding: "16px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Facility</label>
          <select value={activePlant} onChange={(e) => { setActivePlant(e.target.value); setPage(1); }}
            style={{ padding: "8px 14px", fontSize: 13, fontFamily: "Inter, sans-serif", border: "1px solid #D6DFE8", borderRadius: 8, minWidth: 260, cursor: "pointer", background: "#fff" }}>
            <option value="All Plants">All Facilities ({filterOptions?.plants?.length || 0})</option>
            {(filterOptions?.plants || []).map((p: string) => <option key={p} value={p}>{p}</option>)}
          </select>
          {activePlant !== "All Plants" && (
            <button onClick={() => setActivePlant("All Plants")}
              style={{ fontSize: 11, fontWeight: 600, fontFamily: "Inter, sans-serif", color: "#005BAC", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              Show All
            </button>
          )}
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

      {/* ── Group Controls ── */}
      <div style={{ padding: "12px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setGroupByEquip(!groupByEquip)}
            style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: "Inter, sans-serif", background: groupByEquip ? "#005BAC" : "#F1F5F9", color: groupByEquip ? "#fff" : "#475569", border: `1px solid ${groupByEquip ? "#005BAC" : "#D6DFE8"}`, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all .15s" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            {groupByEquip ? "Grouped" : "Flat View"}
          </button>
          {groupByEquip && (
            <>
              <button onClick={expandAll}
                style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 6, cursor: "pointer" }}>
                Expand All
              </button>
              <button onClick={collapseAll}
                style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, fontFamily: "Inter, sans-serif", background: "#F1F5F9", color: "#475569", border: "1px solid #D6DFE8", borderRadius: 6, cursor: "pointer" }}>
                Collapse All
              </button>
              <span style={{ fontSize: 11, color: "#8BA3B8", marginLeft: "auto" }}>
                {equipmentTypeList.length} equipment type{equipmentTypeList.length !== 1 ? "s" : ""} · {collapsedGroups.size} collapsed
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Add Form ── */}
      {showAddForm && (
        <div style={{ padding: "16px 24px 0", maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ background: "#FAFBFC", borderRadius: 12, padding: "20px", border: "1px solid #E2E8F0" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#16324F" }}>Add New Maintenance Record</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              <FormSelect label="Plant *" value={addForm.plant} onChange={(v) => setAddForm({ ...addForm, plant: v })} options={filterOptions?.plants || []} allowEmpty emptyLabel="Select Facility..." />
              <FormField label="Equipment Type" value={addForm.equipmentType} onChange={(v) => setAddForm({ ...addForm, equipmentType: v })} placeholder="e.g., Pumps, Motors, Valves..." />
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
                  <tr><td colSpan={editMode ? 8 : 7} style={{ padding: "40px", textAlign: "center", color: "#8BA3B8" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 24, height: 24, border: "2px solid #E2E8F0", borderTopColor: "#005BAC", borderRadius: "50%", animation: "efm-spin 0.8s linear infinite" }} />
                      <span>Loading maintenance records...</span>
                    </div>
                  </td></tr>
                ) : equipmentTypeList.length === 0 ? (
                  <tr><td colSpan={editMode ? 8 : 7} style={{ padding: "40px", textAlign: "center" }}>
                    <div style={{ fontSize: 14, color: "#8BA3B8", marginBottom: 8 }}>Loading maintenance records...</div>
                    <div style={{ fontSize: 12, color: "#94A3B8" }}>Data is being pre-loaded automatically.</div>
                  </td></tr>
                ) : !groupByEquip ? (
                  /* ── FLAT VIEW ── */
                  enhancedItems.map((item: any, idx: number) => {
                    const fBadge = freqBadge(item.frequency);
                    const iBadge = implBadge(item.implementor);
                    const sStyle = statusBadgeStyle(item.status);
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
                            <td style={{ padding: "8px 12px", color: "#4A5568", fontSize: 11 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: equipColors[item._inferredType || item.equipmentType || "General"] || "#94A3B8" }} />
                                {item._inferredType || item.equipmentType || "General"}
                              </span>
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
                              <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: sStyle.bg, color: sStyle.color, border: `1px solid ${sStyle.border}` }}>{item.status}</span>
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
                  })
                ) : (
                  /* ── GROUPED BY EQUIPMENT TYPE ── */
                  equipmentTypeList.map((equipType) => {
                    const summary = groupSummaries[equipType];
                    const isCollapsed = collapsedGroups.has(equipType);
                    const color = equipColors[equipType] || "#64748B";
                    const freqEntries = Object.entries(summary?.freqDist || {});
                    const implCount = summary?.implementors?.size || 0;
                    return (
                      <React.Fragment key={`group-${equipType}`}>
                        {/* ── Equipment Type Group Header ── */}
                        <tr onClick={() => toggleGroup(equipType)} style={{ cursor: "pointer", userSelect: "none" }}>
                          <td colSpan={editMode ? 8 : 7}
                            style={{
                              padding: "10px 14px",
                              background: "linear-gradient(90deg, #F8FAFC 0%, #fff 100%)",
                              borderTop: "2px solid #CBD5E1",
                              borderBottom: "1px solid #E2E8F0",
                            }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              {/* Expand/collapse chevron */}
                              <span style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 20, height: 20, borderRadius: 4, background: "#F1F5F9",
                                fontSize: 11, color: "#475569", transition: "transform 0.2s",
                                transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                              }}>▾</span>
                              {/* Color dot + Type name */}
                              <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                              <span style={{ fontWeight: 700, fontSize: 12, color: "#16324F" }}>{equipType}</span>
                              {/* Summary pills */}
                              <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", background: color, padding: "2px 8px", borderRadius: 10 }}>{summary?.count || 0} PMs</span>
                              {implCount > 0 && <span style={{ fontSize: 10, color: "#475569", background: "#F1F5F9", padding: "2px 8px", borderRadius: 10 }}>{implCount} implementor{implCount !== 1 ? "s" : ""}</span>}
                              {(summary?.overdue || 0) > 0 && <span style={{ fontSize: 10, color: "#fff", background: "#DC2626", padding: "2px 8px", borderRadius: 10 }}>{summary.overdue} overdue</span>}
                              {/* Frequency mini badges */}
                              {freqEntries.slice(0, 3).map(([f, c]) => {
                                const fb = freqBadge(f);
                                return <span key={f} style={{ fontSize: 9, fontWeight: 600, color: fb.fg, background: fb.bg, padding: "1px 6px", borderRadius: 8 }}>{f}: {c}</span>;
                              })}
                              {freqEntries.length > 3 && <span style={{ fontSize: 9, color: "#8BA3B8" }}>+{freqEntries.length - 3}</span>}
                              {/* Status mini bar */}
                              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                                {Object.entries(summary?.statusDist || {}).map(([s, c]) => {
                                  const st = statusBadgeStyle(s);
                                  return <span key={s} style={{ fontSize: 9, fontWeight: 700, color: st.color, background: st.bg, padding: "1px 6px", borderRadius: 8, border: `1px solid ${st.border}` }}>{s}: {c}</span>;
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {/* ── Records under this equipment type ── */}
                        {!isCollapsed && groupedItems[equipType]?.map((item: any, idx: number) => {
                          const fBadge = freqBadge(item.frequency);
                          const iBadge = implBadge(item.implementor);
                          const sStyle = statusBadgeStyle(item.status);
                          const isEditing = editingRow === item.id;
                          return (
                            <tr key={item.id} style={{ borderBottom: "1px solid #F1F5F9", transition: "background 0.1s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "#FAFBFC"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
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
                                  <td style={{ padding: "8px 12px", color: "#94A3B8", fontWeight: 600, fontSize: 11, paddingLeft: 42 }}>{idx + 1}</td>
                                  <td style={{ padding: "8px 12px", color: "#2D3748", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>{item.plant}</td>
                                  <td style={{ padding: "8px 12px", color: "#4A5568", fontSize: 11 }}>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{item.equipmentType || item._inferredType || "—"}</span>
                                    </span>
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
                                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: sStyle.bg, color: sStyle.color, border: `1px solid ${sStyle.border}` }}>{item.status}</span>
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
                      </React.Fragment>
                    );
                  })
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

      {/* ── AI Assistant ── */}
      <AIAssistant
        contextType="maintenance"
        data={data?.items || []}
        filters={{ plant: activePlant, frequency: freqFilter, implementor: implFilter, equipment: equipFilter, status: statusFilter }}
        title="Maintenance AI"
      />

      {/* ── Styles ── */}
      <style>{`
        .efm-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 12px; font-weight: 600; font-family: Inter, sans-serif; border: none; border-radius: 6px; cursor: pointer; transition: all .15s; white-space: nowrap; color: #fff; }
        .efm-export { background: #1F9D55; } .efm-export:hover { background: #15803D; }
        .efm-import { background: #005BAC; } .efm-import:hover { background: #004D99; }
        .efm-add { background: #7C3AED; } .efm-add:hover { background: #6D28D9; }
        .efm-edit { background: #0EA5E9; } .efm-edit:hover { background: #0284C7; }
        .efm-edit-active { background: #64748B; } .efm-edit-active:hover { background: #475569; }
        .efm-reset { background: #DC2626; } .efm-reset:hover { background: #B91C1C; }
        @keyframes efm-spin { to { transform: rotate(360deg); } }
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
