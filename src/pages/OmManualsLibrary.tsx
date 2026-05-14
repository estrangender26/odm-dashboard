import React, { useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

// ── Types ──
interface OmManual {
  id: number;
  plant: string;
  manualTitle: string;
  equipmentType: string;
  system: string;
  dateIssued: string;
  revision: string;
  status: string;
  responsibleParty: string;
  fileUrl?: string;
  fileType?: string;
}

// ── Mock data — 15 O&M Manuals ──
const MOCK_MANUALS: OmManual[] = [
  { id: 1, plant: "HTT STP", manualTitle: "O&M Manual — Pump Station A", equipmentType: "Pumps", system: "Water Supply", dateIssued: "2022-03-15", revision: "Rev. 3", status: "Active", responsibleParty: "Operations" },
  { id: 2, plant: "HTT STP", manualTitle: "O&M Manual — Motor Control Center", equipmentType: "Motors", system: "Electrical", dateIssued: "2021-07-20", revision: "Rev. 2", status: "Active", responsibleParty: "Electrical" },
  { id: 3, plant: "HTT STP", manualTitle: "O&M Manual — Aeration Blower System", equipmentType: "Blowers", system: "Aeration", dateIssued: "2023-01-10", revision: "Rev. 1", status: "Active", responsibleParty: "Mechanical" },
  { id: 4, plant: "Aglipay STP", manualTitle: "O&M Manual — Main Valve Yard", equipmentType: "Valves", system: "Water Supply", dateIssued: "2020-11-05", revision: "Rev. 4", status: "Under Review", responsibleParty: "Operations" },
  { id: 5, plant: "Aglipay STP", manualTitle: "O&M Manual — Emergency Generator Set", equipmentType: "Generators", system: "Backup Power", dateIssued: "2023-06-01", revision: "Rev. 1", status: "Active", responsibleParty: "Electrical" },
  { id: 6, plant: "HTT STP", manualTitle: "O&M Manual — Transformer Substation", equipmentType: "Transformers", system: "Electrical", dateIssued: "2019-09-12", revision: "Rev. 5", status: "Expired", responsibleParty: "Electrical" },
  { id: 7, plant: "HTT STP", manualTitle: "O&M Manual — SCADA & Telemetry", equipmentType: "PLC / SCADA", system: "Automation", dateIssued: "2023-04-18", revision: "Rev. 2", status: "Active", responsibleParty: "Automation" },
  { id: 8, plant: "Aglipay STP", manualTitle: "O&M Manual — Instrumentation & Control", equipmentType: "Instrumentation", system: "SCADA", dateIssued: "2022-08-22", revision: "Rev. 1", status: "Active", responsibleParty: "Instrumentation" },
  { id: 9, plant: "HTT STP", manualTitle: "O&M Manual — HVAC System", equipmentType: "HVAC", system: "Building", dateIssued: "2021-05-30", revision: "Rev. 3", status: "Active", responsibleParty: "Facilities" },
  { id: 10, plant: "Aglipay STP", manualTitle: "O&M Manual — Chemical Dosing System", equipmentType: "Chemical Dosing", system: "Treatment", dateIssued: "2023-02-14", revision: "Rev. 1", status: "Active", responsibleParty: "Chemical" },
  { id: 11, plant: "HTT STP", manualTitle: "O&M Manual — UV Disinfection System", equipmentType: "UV / Disinfection", system: "Disinfection", dateIssued: "2022-12-01", revision: "Rev. 2", status: "Under Review", responsibleParty: "Operations" },
  { id: 12, plant: "Aglipay STP", manualTitle: "O&M Manual — Sludge Dewatering", equipmentType: "Sludge Handling", system: "Treatment", dateIssued: "2020-04-20", revision: "Rev. 4", status: "Expired", responsibleParty: "Operations" },
  { id: 13, plant: "HTT STP", manualTitle: "O&M Manual — Bar Screen & Grit Removal", equipmentType: "Screens", system: "Inlet", dateIssued: "2023-07-10", revision: "Rev. 1", status: "Active", responsibleParty: "Operations" },
  { id: 14, plant: "Aglipay STP", manualTitle: "O&M Manual — Odor Control System", equipmentType: "Odor Control", system: "Environmental", dateIssued: "2021-10-15", revision: "Rev. 2", status: "Active", responsibleParty: "Environmental" },
  { id: 15, plant: "HTT STP", manualTitle: "O&M Manual — Fire Safety System", equipmentType: "Fire Safety", system: "Building", dateIssued: "2023-09-01", revision: "Rev. 1", status: "Active", responsibleParty: "Safety" },
];

const PLANTS = ["HTT STP", "Aglipay STP"];
const EQUIPMENT_TYPES = Array.from(new Set(MOCK_MANUALS.map(d => d.equipmentType))).sort();
const SYSTEMS = Array.from(new Set(MOCK_MANUALS.map(d => d.system))).sort();
const STATUSES = ["Active", "Under Review", "Expired", "Draft"];

// ── Status badge ──
function statusBadge(s: string) {
  const map: Record<string, { bg: string; text: string }> = {
    "Active": { bg: "#D1FAE5", text: "#059669" },
    "Under Review": { bg: "#FEF3C7", text: "#D97706" },
    "Expired": { bg: "#FEE2E2", text: "#DC2626" },
    "Draft": { bg: "#E2E8F0", text: "#475569" },
  };
  return map[s] || { bg: "#F1F5F9", text: "#64748B" };
}

// ── Banner (replaces alert) ──
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

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════
export default function OmManualsLibrary() {
  const [search, setSearch] = useState("");
  const [plantFilter, setPlantFilter] = useState("");
  const [eqFilter, setEqFilter] = useState("");
  const [sysFilter, setSysFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedManual, setSelectedManual] = useState<OmManual | null>(null);
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Filtered manuals ──
  const filtered = useMemo(() => {
    let d = MOCK_MANUALS;
    if (search) {
      const s = search.toLowerCase();
      d = d.filter(x => x.manualTitle.toLowerCase().includes(s) || x.plant.toLowerCase().includes(s) || x.equipmentType.toLowerCase().includes(s));
    }
    if (plantFilter) d = d.filter(x => x.plant === plantFilter);
    if (eqFilter) d = d.filter(x => x.equipmentType === eqFilter);
    if (sysFilter) d = d.filter(x => x.system === sysFilter);
    if (statusFilter) d = d.filter(x => x.status === statusFilter);
    return d;
  }, [search, plantFilter, eqFilter, sysFilter, statusFilter]);

  // ── Stats ──
  const stats = useMemo(() => ({
    total: MOCK_MANUALS.length,
    active: MOCK_MANUALS.filter(d => d.status === "Active").length,
    review: MOCK_MANUALS.filter(d => d.status === "Under Review").length,
    expired: MOCK_MANUALS.filter(d => d.status === "Expired").length,
    plants: new Set(MOCK_MANUALS.map(d => d.plant)).size,
  }), []);

  const clearFilters = useCallback(() => {
    setSearch(""); setPlantFilter(""); setEqFilter(""); setSysFilter(""); setStatusFilter("");
  }, []);

  const handleExport = useCallback(() => {
    const rows = filtered.map(d => ({
      "Plant": d.plant,
      "Manual Title": d.manualTitle,
      "Equipment Type": d.equipmentType,
      "System": d.system,
      "Date Issued": d.dateIssued,
      "Revision": d.revision,
      "Status": d.status,
      "Responsible": d.responsibleParty,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 45 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "O&M Manuals");
    XLSX.writeFile(wb, "OM_Manuals_Export.xlsx");
    setBanner({ type: "success", message: `${rows.length} O&M manuals exported.` });
  }, [filtered]);

  const handleUpload = useCallback((file: File) => {
    setBanner({ type: "info", message: `Uploading "${file.name}"... (PDF storage integration coming soon)` });
  }, []);

  const handleDownload = useCallback(() => {
    if (!selectedManual) { setBanner({ type: "error", message: "Select a manual first." }); return; }
    setBanner({ type: "info", message: `Downloading ${selectedManual.manualTitle}... (file storage integration coming soon)` });
  }, [selectedManual]);

  // ═════════════ RENDER ═════════════
  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Banner */}
      {banner && <div className="flex-shrink-0 px-4 pt-3"><Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} /></div>}

      {/* Header */}
      <header className="flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)", boxShadow: "0 4px 12px rgba(22,50,79,0.10)" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-3 no-underline text-white">
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div>
              <h1 className="text-lg font-bold leading-tight">O&M Manuals Library</h1>
              <p className="text-xs opacity-55" style={{ letterSpacing: "1px", textTransform: "uppercase" }}>Operation &amp; Maintenance Manuals</p>
            </div>
          </Link>
          <div className="flex gap-2">
            <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold">{stats.total}</div>
              <div className="text-[0.6rem] uppercase opacity-70">Manuals</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT PANEL ── */}
        <div className="w-full sm:w-[400px] lg:w-[440px] flex flex-col border-r border-gray-200 bg-white">
          {/* Toolbar */}
          <div className="flex-shrink-0 p-3 border-b border-gray-200 space-y-2">
            {/* Search */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">&#128269;</span>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search manual title, plant, equipment..." className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&#10005;</button>}
            </div>
            {/* Filters row */}
            <div className="grid grid-cols-2 gap-2">
              <select value={plantFilter} onChange={(e) => setPlantFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                <option value="">All Plants</option>
                {PLANTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={eqFilter} onChange={(e) => setEqFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                <option value="">All Equip.</option>
                {EQUIPMENT_TYPES.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <select value={sysFilter} onChange={(e) => setSysFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                <option value="">All Systems</option>
                {SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                <option value="">All Status</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleExport} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1">
                <span>&#128196;</span> Export
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1">
                <span>&#128194;</span> Upload
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
              <button onClick={handleDownload} className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 ${selectedManual ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>
                <span>&#11015;</span> Download
              </button>
              {(search || plantFilter || eqFilter || sysFilter || statusFilter) && (
                <button onClick={clearFilters} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100">Clear</button>
              )}
            </div>
            {/* Stats row */}
            <div className="flex gap-3 text-xs text-gray-500">
              <span><strong className="text-green-600">{stats.active}</strong> Active</span>
              <span><strong className="text-amber-600">{stats.review}</strong> Review</span>
              <span><strong className="text-red-600">{stats.expired}</strong> Expired</span>
              <span><strong>{stats.plants}</strong> Plants</span>
              <span className="ml-auto"><strong>{filtered.length}</strong> shown</span>
            </div>
          </div>

          {/* Manual List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">&#128196;</div>
                <div className="text-sm font-semibold text-gray-600">No manuals found</div>
                <div className="text-xs mt-1">Try adjusting your search or filters</div>
              </div>
            ) : (
              filtered.map((manual) => {
                const isSelected = selectedManual?.id === manual.id;
                const sb = statusBadge(manual.status);
                return (
                  <div
                    key={manual.id}
                    onClick={() => setSelectedManual(manual)}
                    className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition hover:bg-gray-50 ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[0.65rem] font-semibold text-gray-400 uppercase tracking-wide">{manual.plant} &middot; {manual.revision}</div>
                        <div className={`text-sm font-semibold mt-0.5 truncate ${isSelected ? "text-blue-800" : "text-gray-800"}`}>{manual.manualTitle}</div>
                      </div>
                      <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0" style={{ background: sb.bg, color: sb.text }}>{manual.status}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                      <span>{manual.equipmentType}</span>
                      <span>&middot;</span>
                      <span>{manual.system}</span>
                      <span>&middot;</span>
                      <span>Issued: {manual.dateIssued}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT (PDF Viewer placeholder) ── */}
        <div className="hidden sm:flex flex-1 flex-col bg-gray-100">
          {selectedManual ? (
            <div className="flex-1 flex flex-col">
              {/* Document Header */}
              <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{selectedManual.plant} &middot; {selectedManual.revision}</div>
                    <h2 className="text-xl font-bold text-gray-800 mt-1">{selectedManual.manualTitle}</h2>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                      <span><strong>Equipment:</strong> {selectedManual.equipmentType}</span>
                      <span><strong>System:</strong> {selectedManual.system}</span>
                      <span><strong>Responsible:</strong> {selectedManual.responsibleParty}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: statusBadge(selectedManual.status).bg, color: statusBadge(selectedManual.status).text }}>{selectedManual.status}</span>
                    <span className="text-xs text-gray-400">Issued: {selectedManual.dateIssued}</span>
                  </div>
                </div>
              </div>
              {/* PDF Placeholder */}
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                  <div className="text-6xl mb-4">&#128214;</div>
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">O&M Manual Viewer</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Document: <strong>{selectedManual.plant}</strong> — {selectedManual.manualTitle}
                  </p>
                  <p className="text-xs text-gray-400">
                    PDF viewing integration is ready for implementation.
                    Upload a PDF file to view it here.
                  </p>
                  <div className="mt-6 flex gap-3 justify-center">
                    <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
                      Upload PDF
                    </button>
                    <button onClick={handleDownload} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50">
                      Download
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-6xl mb-4 opacity-30">&#128214;</div>
                <h3 className="text-lg font-semibold text-gray-400 mb-2">Select a Manual</h3>
                <p className="text-sm text-gray-400">
                  Click on any O&M Manual from the left panel to view details.
                  Upload PDF files to view them in the integrated viewer.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
