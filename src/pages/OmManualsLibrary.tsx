import React, { useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

// ── Types ──
interface OmManual {
  id: number;
  project: string;
  facility: string;
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

interface ProjectNode {
  name: string;
  facilities: FacilityNode[];
}

interface FacilityNode {
  name: string;
  manuals: OmManual[];
}

// ── Mock data — O&M Manuals organized by Project → Facility ──
const MOCK_MANUALS: OmManual[] = [
  // HTT STP — Water Supply
  { id: 1,  project: "HTT STP", facility: "Water Supply", manualTitle: "O&M Manual — Pump Station A",              equipmentType: "Pumps",          system: "Raw Water Intake", dateIssued: "2022-03-15", revision: "Rev. 3", status: "Active",         responsibleParty: "Operations" },
  { id: 2,  project: "HTT STP", facility: "Water Supply", manualTitle: "O&M Manual — Main Valve Yard",              equipmentType: "Valves",         system: "Distribution",     dateIssued: "2021-11-20", revision: "Rev. 2", status: "Active",         responsibleParty: "Operations" },
  { id: 3,  project: "HTT STP", facility: "Water Supply", manualTitle: "O&M Manual — Flow Metering Station",        equipmentType: "Flow Meters",    system: "Distribution",     dateIssued: "2023-01-10", revision: "Rev. 1", status: "Active",         responsibleParty: "Instrumentation" },
  // HTT STP — Electrical
  { id: 4,  project: "HTT STP", facility: "Electrical",   manualTitle: "O&M Manual — Motor Control Center",         equipmentType: "Motors",         system: "MCC",              dateIssued: "2021-07-20", revision: "Rev. 2", status: "Active",         responsibleParty: "Electrical" },
  { id: 5,  project: "HTT STP", facility: "Electrical",   manualTitle: "O&M Manual — Transformer Substation",       equipmentType: "Transformers",   system: "HV Distribution",  dateIssued: "2019-09-12", revision: "Rev. 5", status: "Expired",        responsibleParty: "Electrical" },
  { id: 6,  project: "HTT STP", facility: "Electrical",   manualTitle: "O&M Manual — Emergency Generator Set",      equipmentType: "Generators",     system: "Backup Power",     dateIssued: "2023-06-01", revision: "Rev. 1", status: "Active",         responsibleParty: "Electrical" },
  { id: 7,  project: "HTT STP", facility: "Electrical",   manualTitle: "O&M Manual — LV Switchgear",                equipmentType: "Switchgear",     system: "Power Distribution", dateIssued: "2022-04-18", revision: "Rev. 2", status: "Active",         responsibleParty: "Electrical" },
  // HTT STP — Mechanical / Aeration
  { id: 8,  project: "HTT STP", facility: "Mechanical",   manualTitle: "O&M Manual — Aeration Blower System",       equipmentType: "Blowers",        system: "Aeration",         dateIssued: "2023-01-10", revision: "Rev. 1", status: "Active",         responsibleParty: "Mechanical" },
  { id: 9,  project: "HTT STP", facility: "Mechanical",   manualTitle: "O&M Manual — Sludge Dewatering Press",      equipmentType: "Sludge Handling", system: "Dewatering",      dateIssued: "2020-04-20", revision: "Rev. 4", status: "Expired",        responsibleParty: "Operations" },
  { id: 10, project: "HTT STP", facility: "Mechanical",   manualTitle: "O&M Manual — Bar Screen & Grit Removal",    equipmentType: "Screens",        system: "Preliminary Treatment", dateIssued: "2023-07-10", revision: "Rev. 1", status: "Active",         responsibleParty: "Operations" },
  // HTT STP — Automation
  { id: 11, project: "HTT STP", facility: "Automation",   manualTitle: "O&M Manual — SCADA & Telemetry",            equipmentType: "PLC / SCADA",    system: "Automation",       dateIssued: "2023-04-18", revision: "Rev. 2", status: "Active",         responsibleParty: "Automation" },
  { id: 12, project: "HTT STP", facility: "Automation",   manualTitle: "O&M Manual — Instrumentation & Control",    equipmentType: "Instrumentation", system: "SCADA",           dateIssued: "2022-08-22", revision: "Rev. 1", status: "Active",         responsibleParty: "Instrumentation" },
  // HTT STP — Building / Safety
  { id: 13, project: "HTT STP", facility: "Building",     manualTitle: "O&M Manual — HVAC System",                  equipmentType: "HVAC",           system: "Building Mgmt",    dateIssued: "2021-05-30", revision: "Rev. 3", status: "Active",         responsibleParty: "Facilities" },
  { id: 14, project: "HTT STP", facility: "Building",     manualTitle: "O&M Manual — Fire Safety System",           equipmentType: "Fire Safety",    system: "Safety",           dateIssued: "2023-09-01", revision: "Rev. 1", status: "Active",         responsibleParty: "Safety" },
  // Aglipay STP — Water Supply
  { id: 15, project: "Aglipay STP", facility: "Water Supply", manualTitle: "O&M Manual — Intake Structure & Pumps",   equipmentType: "Pumps",          system: "Raw Water Intake", dateIssued: "2022-06-15", revision: "Rev. 2", status: "Active",         responsibleParty: "Operations" },
  { id: 16, project: "Aglipay STP", facility: "Water Supply", manualTitle: "O&M Manual — Reservoir & Level Controls", equipmentType: "Level Controls", system: "Storage",          dateIssued: "2023-03-20", revision: "Rev. 1", status: "Under Review",   responsibleParty: "Instrumentation" },
  // Aglipay STP — Electrical
  { id: 17, project: "Aglipay STP", facility: "Electrical",   manualTitle: "O&M Manual — Main Distribution Panel",    equipmentType: "Switchgear",     system: "Power Distribution", dateIssued: "2021-01-12", revision: "Rev. 3", status: "Active",         responsibleParty: "Electrical" },
  { id: 18, project: "Aglipay STP", facility: "Electrical",   manualTitle: "O&M Manual — Diesel Generator 500kVA",  equipmentType: "Generators",     system: "Backup Power",     dateIssued: "2023-08-01", revision: "Rev. 1", status: "Active",         responsibleParty: "Electrical" },
  // Aglipay STP — Treatment
  { id: 19, project: "Aglipay STP", facility: "Treatment",    manualTitle: "O&M Manual — Chemical Dosing System",     equipmentType: "Chemical Dosing", system: "Chemical Feed",   dateIssued: "2023-02-14", revision: "Rev. 1", status: "Active",         responsibleParty: "Chemical" },
  { id: 20, project: "Aglipay STP", facility: "Treatment",    manualTitle: "O&M Manual — UV Disinfection System",     equipmentType: "UV / Disinfection", system: "Disinfection",  dateIssued: "2022-12-01", revision: "Rev. 2", status: "Under Review",   responsibleParty: "Operations" },
  { id: 21, project: "Aglipay STP", facility: "Treatment",    manualTitle: "O&M Manual — Odor Control System",        equipmentType: "Odor Control",   system: "Environmental",    dateIssued: "2021-10-15", revision: "Rev. 2", status: "Active",         responsibleParty: "Environmental" },
  { id: 22, project: "Aglipay STP", facility: "Treatment",    manualTitle: "O&M Manual — Clarifier Mechanism",        equipmentType: "Clarifiers",     system: "Secondary Treatment", dateIssued: "2020-07-22", revision: "Rev. 4", status: "Expired",        responsibleParty: "Mechanical" },
  // Aglipay STP — Automation
  { id: 23, project: "Aglipay STP", facility: "Automation",   manualTitle: "O&M Manual — PLC Programming & HMI",      equipmentType: "PLC / SCADA",    system: "Automation",       dateIssued: "2023-05-10", revision: "Rev. 1", status: "Active",         responsibleParty: "Automation" },
  { id: 24, project: "Aglipay STP", facility: "Automation",   manualTitle: "O&M Manual — Online Water Quality Analyzers", equipmentType: "Instrumentation", system: "Monitoring",    dateIssued: "2022-09-15", revision: "Rev. 2", status: "Active",         responsibleParty: "Instrumentation" },
  // Aglipay STP — Building
  { id: 25, project: "Aglipay STP", facility: "Building",     manualTitle: "O&M Manual — Admin Building Utilities",   equipmentType: "HVAC",           system: "Building Mgmt",    dateIssued: "2021-03-18", revision: "Rev. 3", status: "Active",         responsibleParty: "Facilities" },
  { id: 26, project: "Aglipay STP", facility: "Building",     manualTitle: "O&M Manual — Security & Access Control",  equipmentType: "Access Control", system: "Security",         dateIssued: "2023-11-01", revision: "Rev. 1", status: "Active",         responsibleParty: "Security" },
];

const STATUSES = ["Active", "Under Review", "Expired", "Draft"];

// ── Build hierarchical tree from flat data ──
function buildTree(manuals: OmManual[]): ProjectNode[] {
  const map = new Map<string, Map<string, OmManual[]>>();
  for (const m of manuals) {
    if (!map.has(m.project)) map.set(m.project, new Map());
    const facMap = map.get(m.project)!;
    if (!facMap.has(m.facility)) facMap.set(m.facility, []);
    facMap.get(m.facility)!.push(m);
  }
  const projects: ProjectNode[] = [];
  for (const [name, facMap] of map) {
    const facilities: FacilityNode[] = [];
    for (const [fname, ms] of facMap) {
      facilities.push({ name: fname, manuals: ms });
    }
    facilities.sort((a, b) => a.name.localeCompare(b.name));
    projects.push({ name, facilities });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

// ── Status badge ──
function statusBadge(s: string) {
  const map: Record<string, { bg: string; text: string }> = {
    "Active":       { bg: "#D1FAE5", text: "#059669" },
    "Under Review": { bg: "#FEF3C7", text: "#D97706" },
    "Expired":      { bg: "#FEE2E2", text: "#DC2626" },
    "Draft":        { bg: "#E2E8F0", text: "#475569" },
  };
  return map[s] || { bg: "#F1F5F9", text: "#64748B" };
}

// ── Banner (replaces alert) ──
function Banner({ type, message, onDismiss }: { type: "error" | "success" | "info"; message: string; onDismiss?: () => void }) {
  const s: Record<string, string> = {
    error:   "bg-red-50   border-red-200   text-red-800",
    success: "bg-green-50 border-green-200 text-green-800",
    info:    "bg-blue-50  border-blue-200  text-blue-800",
  };
  return (
    <div className={`mb-3 px-4 py-3 border rounded-lg text-sm flex items-center gap-2 ${s[type]}`}>
      <span>{type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️"}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && <button onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>}
    </div>
  );
}

// ── Chevron icon ──
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}>
      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════
export default function OmManualsLibrary() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedManual, setSelectedManual] = useState<OmManual | null>(null);
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(["Aglipay STP", "HTT STP"]));
  const [expandedFacilities, setExpandedFacilities] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Search filtering (flat) ──
  const filteredManuals = useMemo(() => {
    let d = MOCK_MANUALS;
    if (search) {
      const s = search.toLowerCase();
      d = d.filter(x =>
        x.manualTitle.toLowerCase().includes(s) ||
        x.project.toLowerCase().includes(s) ||
        x.facility.toLowerCase().includes(s) ||
        x.equipmentType.toLowerCase().includes(s) ||
        x.system.toLowerCase().includes(s)
      );
    }
    if (statusFilter) d = d.filter(x => x.status === statusFilter);
    return d;
  }, [search, statusFilter]);

  // ── Build tree from filtered manuals ──
  const tree = useMemo(() => buildTree(filteredManuals), [filteredManuals]);

  // ── Stats ──
  const stats = useMemo(() => ({
    total:    MOCK_MANUALS.length,
    active:   MOCK_MANUALS.filter(d => d.status === "Active").length,
    review:   MOCK_MANUALS.filter(d => d.status === "Under Review").length,
    expired:  MOCK_MANUALS.filter(d => d.status === "Expired").length,
    projects: new Set(MOCK_MANUALS.map(d => d.project)).size,
  }), []);

  // ── Toggle helpers ──
  const toggleProject = useCallback((name: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const toggleFacility = useCallback((key: string) => {
    setExpandedFacilities(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const ps = new Set(tree.map(p => p.name));
    const fs = new Set<string>();
    for (const p of tree) {
      for (const f of p.facilities) {
        fs.add(`${p.name}::${f.name}`);
      }
    }
    setExpandedProjects(ps);
    setExpandedFacilities(fs);
  }, [tree]);

  const clearFilters = useCallback(() => {
    setSearch(""); setStatusFilter(""); setSelectedManual(null);
  }, []);

  const handleExport = useCallback(() => {
    const rows = filteredManuals.map(d => ({
      "Project":       d.project,
      "Facility":      d.facility,
      "Manual Title":  d.manualTitle,
      "Equipment Type":d.equipmentType,
      "System":        d.system,
      "Date Issued":   d.dateIssued,
      "Revision":      d.revision,
      "Status":        d.status,
      "Responsible":   d.responsibleParty,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 45 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "O&M Manuals");
    XLSX.writeFile(wb, "OM_Manuals_Export.xlsx");
    setBanner({ type: "success", message: `${rows.length} O&M manuals exported.` });
  }, [filteredManuals]);

  const handleUpload = useCallback((file: File) => {
    setBanner({ type: "info", message: `Uploading "${file.name}"... (PDF storage integration coming soon)` });
  }, []);

  const handleDownload = useCallback(() => {
    if (!selectedManual) { setBanner({ type: "error", message: "Select a manual first." }); return; }
    setBanner({ type: "info", message: `Downloading ${selectedManual.manualTitle}... (file storage integration coming soon)` });
  }, [selectedManual]);

  // ── Keyboard shortcut: Ctrl+F to focus search ──
  const searchRef = useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
              <h1 className="text-lg font-bold leading-tight">O&amp;M Manuals Library</h1>
              <p className="text-xs opacity-55" style={{ letterSpacing: "1px", textTransform: "uppercase" }}>Per Project &middot; Per Facility</p>
            </div>
          </Link>
          <div className="flex gap-2">
            <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold">{stats.total}</div>
              <div className="text-[0.6rem] uppercase opacity-70">Manuals</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center hidden sm:block">
              <div className="text-lg font-bold">{stats.projects}</div>
              <div className="text-[0.6rem] uppercase opacity-70">Projects</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT PANEL: Hierarchical Tree ── */}
        <div className="w-full sm:w-[420px] lg:w-[460px] flex flex-col border-r border-gray-200 bg-white">
          {/* Toolbar */}
          <div className="flex-shrink-0 p-3 border-b border-gray-200 space-y-2">
            {/* Search */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">&#128269;</span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search across all projects & facilities..."
                className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
              />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&#10005;</button>}
            </div>
            {/* Filters & Actions */}
            <div className="flex gap-2 items-center">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white flex-1">
                <option value="">All Status</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={expandAll} className="px-2 py-1.5 bg-gray-100 text-gray-600 rounded text-xs font-semibold hover:bg-gray-200 whitespace-nowrap">
                Expand All
              </button>
              {(search || statusFilter) && (
                <button onClick={clearFilters} className="px-2 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100 whitespace-nowrap">
                  Clear
                </button>
              )}
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
            </div>
            {/* Stats row */}
            <div className="flex gap-3 text-xs text-gray-500">
              <span><strong className="text-green-600">{stats.active}</strong> Active</span>
              <span><strong className="text-amber-600">{stats.review}</strong> Review</span>
              <span><strong className="text-red-600">{stats.expired}</strong> Expired</span>
              <span className="ml-auto"><strong>{filteredManuals.length}</strong> shown</span>
            </div>
          </div>

          {/* Hierarchical Tree */}
          <div className="flex-1 overflow-y-auto">
            {tree.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">&#128196;</div>
                <div className="text-sm font-semibold text-gray-600">No manuals found</div>
                <div className="text-xs mt-1">Try adjusting your search or filters</div>
              </div>
            ) : (
              tree.map(project => {
                const pExpanded = expandedProjects.has(project.name);
                const pTotal = project.facilities.reduce((s, f) => s + f.manuals.length, 0);
                const pActive = project.facilities.reduce((s, f) => s + f.manuals.filter(m => m.status === "Active").length, 0);
                return (
                  <div key={project.name} className="border-b border-gray-200">
                    {/* ── Project Header ── */}
                    <button
                      onClick={() => toggleProject(project.name)}
                      className={`w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition ${pExpanded ? "bg-blue-50/50" : ""}`}
                    >
                      <Chevron expanded={pExpanded} />
                      <span className="text-lg">&#127980;</span>
                      <span className="flex-1 text-sm font-bold text-gray-800">{project.name}</span>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-semibold">{pActive} active</span>
                        <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-semibold">{pTotal} manuals</span>
                      </div>
                    </button>

                    {/* ── Facilities under this project ── */}
                    {pExpanded && project.facilities.map(facility => {
                      const fKey = `${project.name}::${facility.name}`;
                      const fExpanded = expandedFacilities.has(fKey);
                      return (
                        <div key={fKey} className="border-t border-gray-100">
                          {/* Facility Header */}
                          <button
                            onClick={() => toggleFacility(fKey)}
                            className={`w-full flex items-center gap-2 pl-9 pr-4 py-2 text-left hover:bg-gray-50 transition ${fExpanded ? "bg-blue-50/30" : ""}`}
                          >
                            <Chevron expanded={fExpanded} />
                            <span className="text-sm">&#9881;</span>
                            <span className="flex-1 text-xs font-semibold text-gray-700">{facility.name}</span>
                            <span className="text-xs text-gray-400">{facility.manuals.length}</span>
                          </button>

                          {/* Manuals under this facility */}
                          {fExpanded && facility.manuals.map(manual => {
                            const isSelected = selectedManual?.id === manual.id;
                            const sb = statusBadge(manual.status);
                            return (
                              <div
                                key={manual.id}
                                onClick={() => setSelectedManual(manual)}
                                className={`pl-[52px] pr-4 py-2.5 cursor-pointer transition hover:bg-gray-50 border-t border-gray-50 ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[0.65rem] font-semibold text-gray-400 uppercase tracking-wide">{manual.revision}</span>
                                      <span className="text-[0.6rem] text-gray-300">|</span>
                                      <span className="text-[0.65rem] text-gray-400">{manual.system}</span>
                                    </div>
                                    <div className={`text-xs font-semibold mt-0.5 truncate ${isSelected ? "text-blue-800" : "text-gray-800"}`}>
                                      {manual.manualTitle}
                                    </div>
                                  </div>
                                  <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0" style={{ background: sb.bg, color: sb.text }}>
                                    {manual.status}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-[0.7rem] text-gray-500">
                                  <span>{manual.equipmentType}</span>
                                  <span>&middot;</span>
                                  <span>{manual.dateIssued}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT (Document Viewer) ── */}
        <div className="hidden sm:flex flex-1 flex-col bg-gray-100">
          {selectedManual ? (
            <div className="flex-1 flex flex-col">
              {/* Document Header */}
              <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                  <span className="font-semibold text-blue-600">&#127980; {selectedManual.project}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="font-medium text-gray-500">&#9881; {selectedManual.facility}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="text-gray-400">{selectedManual.system}</span>
                </div>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">{selectedManual.manualTitle}</h2>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                      <span><strong>Equipment:</strong> {selectedManual.equipmentType}</span>
                      <span><strong>System:</strong> {selectedManual.system}</span>
                      <span><strong>Responsible:</strong> {selectedManual.responsibleParty}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: statusBadge(selectedManual.status).bg, color: statusBadge(selectedManual.status).text }}>
                      {selectedManual.status}
                    </span>
                    <span className="text-xs text-gray-400">{selectedManual.revision} &middot; Issued: {selectedManual.dateIssued}</span>
                  </div>
                </div>
              </div>
              {/* PDF Placeholder */}
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                  <div className="text-6xl mb-4">&#128214;</div>
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">O&amp;M Manual Viewer</h3>
                  <p className="text-sm text-gray-500 mb-1">
                    <strong>{selectedManual.project}</strong> &mdash; {selectedManual.facility}
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
                    {selectedManual.manualTitle}
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
                  Browse by project and facility in the left panel, then click on any O&amp;M Manual to view details.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
