import React, { useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface TocItem {
  id: number;
  title: string;
  status: "Complete" | "In Progress" | "Pending" | "Not Applicable";
  lastUpdated?: string;
  responsibleParty?: string;
  notes?: string;
}

interface OmManual {
  id: number;
  project: string;
  facility: string;
  facilityCode: string;
  manualTitle: string;
  dateIssued: string;
  revision: string;
  responsibleParty: string;
  status: "Active" | "Under Review" | "Expired" | "Draft";
  toc: TocItem[];
}

interface FacilityNode {
  name: string;
  manuals: OmManual[];
}

// ═══════════════════════════════════════════════════════════
// Standard 14 TOC Items (per IOM for O&M Structure Governance)
// ═══════════════════════════════════════════════════════════

const STANDARD_TOC: { id: number; title: string }[] = [
  { id: 1,  title: "Executive Summary" },
  { id: 2,  title: "Facility Overview and Process Description" },
  { id: 3,  title: "Operating Philosophy" },
  { id: 4,  title: "Standard Operating Procedures (SOPs) — ANNEX" },
  { id: 5,  title: "Standard Maintenance Procedures (SMPs) — ANNEX" },
  { id: 6,  title: "Maintenance Management Framework — ANNEX" },
  { id: 7,  title: "SCADA and Automation" },
  { id: 8,  title: "Testing, Commissioning, and Proving — ANNEX" },
  { id: 9,  title: "As-Built Drawings and Final Technical Documentation — ANNEX" },
  { id: 10, title: "Training and Competency Records — ANNEX" },
  { id: 11, title: "Digital / SAP S/4HANA Onboarding — ANNEX" },
  { id: 12, title: "Critical Spares Handover (Contract Deliverable) — ANNEX" },
  { id: 13, title: "Acceptance and Handover — ANNEX" },
  { id: 14, title: "Facility-Specific Addenda — ANNEX" },
];

// ═══════════════════════════════════════════════════════════
// Helper: build a random but realistic TOC for a facility
// ═══════════════════════════════════════════════════════════

const PARTIES = ["Operations", "Electrical", "Mechanical", "Automation", "Instrumentation", "Facilities", "Safety", "Contractor"];

function buildToc(baseStatus?: string): TocItem[] {
  const statuses: Array<TocItem["status"]> = ["Complete", "In Progress", "Pending", "Not Applicable"];
  return STANDARD_TOC.map(item => {
    const status = baseStatus === "Expired" ? "Pending" as const :
                   baseStatus === "Draft" ? "In Progress" as const :
                   baseStatus === "Under Review" ? (Math.random() > 0.5 ? "In Progress" : "Pending") as const :
                   item.id <= 3 ? "Complete" as const :
                   item.id <= 8 ? (Math.random() > 0.3 ? "Complete" : "In Progress") as const :
                   item.id <= 12 ? (Math.random() > 0.4 ? "In Progress" : "Pending") as const :
                   (Math.random() > 0.5 ? "Pending" : "Not Applicable") as const;
    return {
      ...item,
      status,
      lastUpdated: `2025-${String(Math.floor(Math.random() * 12) + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`,
      responsibleParty: PARTIES[Math.floor(Math.random() * PARTIES.length)],
    };
  });
}

// ═══════════════════════════════════════════════════════════
// Mock Data — Project → Facility → 1 O&M Manual PDF each
// ═══════════════════════════════════════════════════════════

const MOCK_MANUALS: OmManual[] = [
  {
    id: 1, project: "HTT STP", facility: "Water Supply", facilityCode: "HTT-WS",
    manualTitle: "O&M Manual — HTT STP Water Supply System",
    dateIssued: "2024-01-15", revision: "Rev. 3", responsibleParty: "Operations",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 2, project: "HTT STP", facility: "Electrical", facilityCode: "HTT-EL",
    manualTitle: "O&M Manual — HTT STP Electrical System",
    dateIssued: "2024-02-20", revision: "Rev. 2", responsibleParty: "Electrical",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 3, project: "HTT STP", facility: "Mechanical", facilityCode: "HTT-ME",
    manualTitle: "O&M Manual — HTT STP Mechanical System",
    dateIssued: "2024-03-10", revision: "Rev. 1", responsibleParty: "Mechanical",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 4, project: "HTT STP", facility: "Automation", facilityCode: "HTT-AU",
    manualTitle: "O&M Manual — HTT STP SCADA & Automation",
    dateIssued: "2024-04-05", revision: "Rev. 2", responsibleParty: "Automation",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 5, project: "HTT STP", facility: "Building & Safety", facilityCode: "HTT-BS",
    manualTitle: "O&M Manual — HTT STP Building & Safety Systems",
    dateIssued: "2024-05-18", revision: "Rev. 1", responsibleParty: "Facilities",
    status: "Under Review", toc: buildToc("Under Review"),
  },
  {
    id: 6, project: "HTT STP", facility: "Treatment Process", facilityCode: "HTT-TP",
    manualTitle: "O&M Manual — HTT STP Treatment Process",
    dateIssued: "2024-06-22", revision: "Rev. 1", responsibleParty: "Operations",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 7, project: "Aglipay STP", facility: "Water Supply", facilityCode: "AGL-WS",
    manualTitle: "O&M Manual — Aglipay STP Water Supply System",
    dateIssued: "2024-01-30", revision: "Rev. 2", responsibleParty: "Operations",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 8, project: "Aglipay STP", facility: "Electrical", facilityCode: "AGL-EL",
    manualTitle: "O&M Manual — Aglipay STP Electrical System",
    dateIssued: "2024-02-14", revision: "Rev. 3", responsibleParty: "Electrical",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 9, project: "Aglipay STP", facility: "Mechanical", facilityCode: "AGL-ME",
    manualTitle: "O&M Manual — Aglipay STP Mechanical System",
    dateIssued: "2024-03-25", revision: "Rev. 1", responsibleParty: "Mechanical",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 10, project: "Aglipay STP", facility: "Automation", facilityCode: "AGL-AU",
    manualTitle: "O&M Manual — Aglipay STP SCADA & Automation",
    dateIssued: "2024-04-12", revision: "Rev. 2", responsibleParty: "Automation",
    status: "Under Review", toc: buildToc("Under Review"),
  },
  {
    id: 11, project: "Aglipay STP", facility: "Treatment Process", facilityCode: "AGL-TP",
    manualTitle: "O&M Manual — Aglipay STP Treatment Process",
    dateIssued: "2024-05-08", revision: "Rev. 1", responsibleParty: "Operations",
    status: "Active", toc: buildToc("Active"),
  },
  {
    id: 12, project: "Aglipay STP", facility: "Building & Safety", facilityCode: "AGL-BS",
    manualTitle: "O&M Manual — Aglipay STP Building & Safety Systems",
    dateIssued: "2024-06-15", revision: "Rev. 1", responsibleParty: "Safety",
    status: "Draft", toc: buildToc("Draft"),
  },
];

// ── Build hierarchical tree: Facility (top) → Manuals → TOC ──
function buildTree(manuals: OmManual[]): FacilityNode[] {
  const map = new Map<string, OmManual[]>();
  for (const m of manuals) {
    if (!map.has(m.facility)) map.set(m.facility, []);
    map.get(m.facility)!.push(m);
  }
  const facilities: FacilityNode[] = [];
  for (const [name, ms] of map) {
    ms.sort((a, b) => a.project.localeCompare(b.project));
    facilities.push({ name, manuals: ms });
  }
  facilities.sort((a, b) => a.name.localeCompare(b.name));
  return facilities;
}

// ═══════════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════════

const STATUS_STYLE: Record<string, { bg: string; text: string; bar: string }> = {
  "Complete":       { bg: "#D1FAE5", text: "#059669", bar: "#22C55E" },
  "In Progress":    { bg: "#DBEAFE", text: "#2563EB", bar: "#3B82F6" },
  "Pending":        { bg: "#FEF3C7", text: "#D97706", bar: "#F59E0B" },
  "Not Applicable": { bg: "#E2E8F0", text: "#64748B", bar: "#94A3B8" },
};

const MANUAL_STATUS: Record<string, { bg: string; text: string }> = {
  "Active":       { bg: "#D1FAE5", text: "#059669" },
  "Under Review": { bg: "#FEF3C7", text: "#D97706" },
  "Expired":      { bg: "#FEE2E2", text: "#DC2626" },
  "Draft":        { bg: "#E2E8F0", text: "#475569" },
};

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

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}>
      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Detailed descriptions for each of the 14 TOC sections (from ANNEX) ──
const TOC_DESCRIPTIONS: Record<number, string> = {
  1:  "High-level summary of the O&M Manual covering facility purpose, scope, key operational parameters, and document structure. Provides an at-a-glance overview for management, auditors, and new personnel joining the facility.",
  2:  "Detailed description of the facility layout, process flow, treatment trains, capacity, design parameters, and key infrastructure. Includes process flow diagrams (PFDs), general arrangement drawings, and equipment inventory.",
  3:  "Defines the operating philosophy including staffing model, shift structure, process control strategy, safety-first principles, environmental compliance approach, and performance targets. Establishes the decision-making framework for operators.",
  4:  "Step-by-step procedures for safe facility operation under all conditions: Start-up, Normal operation, Shutdown, Abnormal/upset operating conditions, and Emergency scenarios (power failure, flooding, major equipment failure). Must be unambiguous, identify operator actions and decision points, and reference all applicable alarms, interlocks, safeguards, and safety precautions. SOPs are mandatory acceptance deliverables.",
  5:  "Defines how maintenance work is performed including required tools, safety controls, execution steps, and acceptance criteria. Mandatory SMP categories: Mechanical equipment, Electrical systems, Instrumentation and control devices. Each SMP must include: Safety requirements including LOTO, Step-by-step maintenance activities, and Post-maintenance testing and return-to-service checks. SMPs form the technical foundation for all preventive maintenance activities.",
  6:  "Maintenance strategy structured into Preventive Maintenance (PM) and Corrective Maintenance (CM). Strategy defined based on: Equipment criticality, Operational and safety risk, Warranty conditions and OEM requirements. All PM tasks must be derived from approved SMPs — no PM task shall exist without a corresponding SMP. O&M Manual must clearly define in-house vs contractor scope.",
  7:  "Complete documentation of the SCADA architecture, control logic, instrumentation, telemetry, alarm management, and automation systems. Includes network diagrams, PLC/HMI configurations, I/O lists, and communication protocols. Must cover operator interfaces and remote monitoring capabilities.",
  8:  "Dry-Commissioning: Mechanical completion verification, Electrical and instrumentation testing. Wet Commissioning: Functional operation demonstration, Control logic integrity verification, Alarm and interlock performance validation. Proving Period: Performance data collection and analysis, Defect logging/rectification/closure, Demonstration of stable and repeatable operation. Commissioning and proving documentation is a non-waivable acceptance requirement.",
  9:  "Complete and verified as-built drawings and final technical documentation reflecting the installed condition. Must include: PFDs and P&IDs, GA/layout drawings, Electrical single-line diagrams and schematics, Instrument loop diagrams and I/O lists, Network/SCADA architecture and panel drawings. As-built drawings are mandatory acceptance deliverables.",
  10: "Training covering at a minimum: Facility operations, Maintenance procedures, SCADA and automation systems, Safety and emergency response. Supported by: Attendance records, Certificates of completion, OEM training certificates where applicable. Facilities shall not be accepted unless minimum training and competency requirements are fully satisfied.",
  11: "Digital structure into Functional locations and Equipment records. Minimum master data: Equipment technical details, Bills of Materials (BOMs), PM task lists, Measurement points, Warranty information. All digital data must be Complete, Accurate, and Validated prior to acceptance. Digital onboarding is a core acceptance gate, not a post-handover activity.",
  12: "Separate handover deliverable from SAP onboarding. Contractor must submit final list of contractual critical spares to be turned over per asset/package, including quantities and part identification, together with corresponding supplier/vendor details and documented local support/service contact information for each critical spare/equipment package. Completion required prior to Final Acceptance.",
  13: "Two-stage acceptance process: Provisional Acceptance → Final Acceptance. Final Acceptance only granted when: All documentation complete and approved, All SOPs and SMPs approved, Training requirements fulfilled, Digital onboarding verified, Critical spares handover deliverable completed. Ownership transfers to Operations only after formal Final Acceptance approval.",
  14: "Facility-specific requirements documented as appendices to this corporate standard, covering: Unique process units, Special safety considerations, Regulatory and compliance requirements.",
};

// ── TOC completion stats for a manual ──
function tocStats(toc: TocItem[]) {
  const total = toc.length;
  const complete = toc.filter(t => t.status === "Complete").length;
  const inProgress = toc.filter(t => t.status === "In Progress").length;
  const pending = toc.filter(t => t.status === "Pending").length;
  const na = toc.filter(t => t.status === "Not Applicable").length;
  const pct = Math.round((complete / total) * 100);
  return { total, complete, inProgress, pending, na, pct };
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function OmManualsLibrary() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedManual, setSelectedManual] = useState<OmManual | null>(null);
  const [selectedTocItem, setSelectedTocItem] = useState<TocItem | null>(null);
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const [expandedFacilities, setExpandedFacilities] = useState<Set<string>>(new Set(["Automation", "Building & Safety", "Electrical", "Mechanical", "Treatment Process", "Water Supply"]));
  const [expandedManuals, setExpandedManuals] = useState<Set<string>>(new Set());
  const [mobileView, setMobileView] = useState<"tree" | "detail">("tree");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Search filtering ──
  const filteredManuals = useMemo(() => {
    let d = MOCK_MANUALS;
    if (search) {
      const s = search.toLowerCase();
      d = d.filter(x =>
        x.manualTitle.toLowerCase().includes(s) ||
        x.project.toLowerCase().includes(s) ||
        x.facility.toLowerCase().includes(s) ||
        x.facilityCode.toLowerCase().includes(s)
      );
    }
    if (statusFilter) d = d.filter(x => x.status === statusFilter);
    return d;
  }, [search, statusFilter]);

  const tree = useMemo(() => buildTree(filteredManuals), [filteredManuals]);

  const stats = useMemo(() => ({
    total:    MOCK_MANUALS.length,
    active:   MOCK_MANUALS.filter(d => d.status === "Active").length,
    review:   MOCK_MANUALS.filter(d => d.status === "Under Review").length,
    expired:  MOCK_MANUALS.filter(d => d.status === "Expired").length,
    projects: new Set(MOCK_MANUALS.map(d => d.project)).size,
  }), []);

  const toggleFacility = useCallback((name: string) => {
    setExpandedFacilities(prev => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }, []);

  const toggleManual = useCallback((id: number) => {
    setExpandedManuals(prev => { const n = new Set(prev); if (n.has(String(id))) n.delete(String(id)); else n.add(String(id)); return n; });
  }, []);

  const handleSelectManual = useCallback((manual: OmManual) => {
    setSelectedManual(manual);
    setSelectedTocItem(null);
    setMobileView("detail");
  }, []);

  const expandAll = useCallback(() => {
    const fs = new Set(tree.map(f => f.name));
    const ms = new Set<string>();
    for (const f of tree) { for (const m of f.manuals) { ms.add(String(m.id)); } }
    setExpandedFacilities(fs); setExpandedManuals(ms);
  }, [tree]);

  const clearFilters = useCallback(() => {
    setSearch(""); setStatusFilter(""); setSelectedManual(null); setSelectedTocItem(null); setMobileView("tree");
  }, []);

  const handleExport = useCallback(() => {
    const rows: any[] = [];
    filteredManuals.forEach(m => {
      m.toc.forEach(t => {
        rows.push({
          "Project": m.project,
          "Facility Code": m.facilityCode,
          "Facility": m.facility,
          "Manual Status": m.status,
          "TOC #": t.id,
          "TOC Section": t.title,
          "Section Status": t.status,
          "Last Updated": t.lastUpdated,
          "Responsible": t.responsibleParty || m.responsibleParty,
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 6 }, { wch: 52 }, { wch: 14 }, { wch: 13 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "O&M Manuals TOC");
    XLSX.writeFile(wb, "OM_Manuals_TOC_Export.xlsx");
    setBanner({ type: "success", message: `${rows.length} TOC rows exported from ${filteredManuals.length} manuals.` });
  }, [filteredManuals]);

  const handleUpload = useCallback((file: File) => {
    setBanner({ type: "info", message: `Uploading "${file.name}"... (PDF storage integration coming soon)` });
  }, []);

  const handleDownload = useCallback(() => {
    if (!selectedManual) { setBanner({ type: "error", message: "Select a manual first." }); return; }
    setBanner({ type: "info", message: `Downloading ${selectedManual.manualTitle}... (file storage integration coming soon)` });
  }, [selectedManual]);

  // Keyboard shortcut: Ctrl+F to focus search
  const searchRef = useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.ctrlKey && e.key === "f") { e.preventDefault(); searchRef.current?.focus(); } };
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
              <p className="text-xs opacity-55" style={{ letterSpacing: "1px", textTransform: "uppercase" }}>Per Project &middot; Per Facility &middot; 14-Item Standard TOC</p>
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
        <div className={`w-full sm:w-[440px] lg:w-[480px] flex flex-col border-r border-gray-200 bg-white ${mobileView === "detail" ? "hidden sm:flex" : "flex"}`}>
          {/* Toolbar */}
          <div className="flex-shrink-0 p-3 border-b border-gray-200 space-y-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">&#128269;</span>
              <input ref={searchRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search project, facility, or code..."
                className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&#10005;</button>}
            </div>
            <div className="flex gap-2 items-center">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white flex-1">
                <option value="">All Manual Status</option>
                <option value="Active">Active</option>
                <option value="Under Review">Under Review</option>
                <option value="Draft">Draft</option>
                <option value="Expired">Expired</option>
              </select>
              <button onClick={expandAll} className="px-2 py-1.5 bg-gray-100 text-gray-600 rounded text-xs font-semibold hover:bg-gray-200 whitespace-nowrap">Expand All</button>
              {(search || statusFilter) && (
                <button onClick={clearFilters} className="px-2 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100 whitespace-nowrap">Clear</button>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleExport} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1"><span>&#128196;</span> Export</button>
              <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1"><span>&#128194;</span> Upload</button>
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
              <button onClick={handleDownload} className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 ${selectedManual ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}><span>&#11015;</span> Download</button>
            </div>
            <div className="flex gap-3 text-xs text-gray-500">
              <span><strong className="text-green-600">{stats.active}</strong> Active</span>
              <span><strong className="text-amber-600">{stats.review}</strong> Review</span>
              <span><strong className="text-red-600">{stats.expired}</strong> Expired</span>
              <span className="ml-auto"><strong>{filteredManuals.length}</strong> shown</span>
            </div>
          </div>

          {/* Tree: Facility → Manual Project Title → TOC */}
          <div className="flex-1 overflow-y-auto">
            {tree.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">&#128196;</div>
                <div className="text-sm font-semibold text-gray-600">No manuals found</div>
              </div>
            ) : (
              tree.map(facility => {
                const fExpanded = expandedFacilities.has(facility.name);
                const fCount = facility.manuals.length;
                return (
                  <div key={facility.name} className="border-b border-gray-200">
                    {/* Facility Header */}
                    <button onClick={() => toggleFacility(facility.name)}
                      className={`w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition ${fExpanded ? "bg-blue-50/50" : ""}`}>
                      <Chevron expanded={fExpanded} />
                      <span className="text-sm">&#9881;</span>
                      <span className="flex-1 text-sm font-bold text-gray-800">{facility.name}</span>
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs font-semibold">{fCount} manual{fCount > 1 ? "s" : ""}</span>
                    </button>

                    {/* Manuals under this facility */}
                    {fExpanded && facility.manuals.map(manual => {
                      const mExpanded = expandedManuals.has(String(manual.id));
                      const isSelected = selectedManual?.id === manual.id;
                      const tocSt = tocStats(manual.toc);
                      const ms = MANUAL_STATUS[manual.status] || MANUAL_STATUS.Draft;
                      return (
                        <div key={manual.id} className="border-t border-gray-50">
                          {/* O&M Manual Project Title */}
                          <button onClick={() => toggleManual(manual.id)}
                            className={`w-full flex items-center gap-2 pl-9 pr-4 py-2 text-left hover:bg-gray-50 transition ${mExpanded ? "bg-blue-50/30" : ""}`}>
                            <Chevron expanded={mExpanded} />
                            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1 rounded">{manual.facilityCode}</span>
                            <span className="flex-1 text-xs font-semibold text-gray-700 truncate">{manual.manualTitle}</span>
                            <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: ms.bg, color: ms.text }}>{manual.status}</span>
                          </button>

                          {/* Manual summary + TOC micro-bars (when expanded) */}
                          {mExpanded && (
                            <div onClick={() => handleSelectManual(manual)}
                              className={`pl-[52px] pr-4 py-3 cursor-pointer transition hover:bg-blue-50/40 border-t border-gray-50 ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="text-[0.65rem] text-gray-400">{manual.revision} &middot; Issued {manual.dateIssued} &middot; {manual.responsibleParty} &middot; {manual.project}</div>
                                </div>
                              </div>
                              {/* TOC completion micro-bars */}
                              <div className="flex gap-1 mt-2">
                                {manual.toc.map(t => (
                                  <div key={t.id} className="flex-1 h-1 rounded-full" style={{ background: STATUS_STYLE[t.status]?.bar || "#CBD5E1" }} title={`${t.id}. ${t.title} — ${t.status}`} />
                                ))}
                              </div>
                              <div className="flex gap-2 mt-1.5 text-[0.6rem] text-gray-500">
                                <span className="text-green-600 font-semibold">{tocSt.complete} done</span>
                                <span className="text-blue-600 font-semibold">{tocSt.inProgress} in prog</span>
                                <span className="text-amber-600 font-semibold">{tocSt.pending} pending</span>
                                {tocSt.na > 0 && <span className="text-gray-400">{tocSt.na} N/A</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT: TOC Viewer ── */}
        <div className={`flex-1 flex-col bg-gray-100 overflow-hidden ${mobileView === "detail" ? "flex" : "hidden sm:flex"}`}>
          {selectedManual ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Manual Header */}
              <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4">
                {/* Mobile back button */}
                <button onClick={() => setMobileView("tree")} className="sm:hidden flex items-center gap-1 text-xs text-blue-600 font-semibold mb-2">
                  <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M7.5 9.5L4 6L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Back to list
                </button>
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                  <span className="font-semibold text-blue-600">&#127980; {selectedManual.project}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="font-medium text-gray-500">&#9881; {selectedManual.facility}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="font-mono text-gray-400">{selectedManual.facilityCode}</span>
                </div>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">{selectedManual.manualTitle}</h2>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                      <span><strong>Responsible:</strong> {selectedManual.responsibleParty}</span>
                      <span><strong>Revision:</strong> {selectedManual.revision}</span>
                      <span><strong>Issued:</strong> {selectedManual.dateIssued}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: MANUAL_STATUS[selectedManual.status]?.bg, color: MANUAL_STATUS[selectedManual.status]?.text }}>{selectedManual.status}</span>
                  </div>
                </div>
              </div>

              {/* Two-column: TOC list + TOC detail */}
              <div className="flex-1 flex overflow-hidden">
                {/* TOC 14-item list */}
                <div className="w-[340px] lg:w-[380px] flex flex-col border-r border-gray-200 bg-white overflow-hidden">
                  <div className="flex-shrink-0 px-4 py-2.5 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Standard TOC — 14 Sections</span>
                      {(() => { const s = tocStats(selectedManual.toc); return (
                        <span className="text-xs font-semibold" style={{ color: s.pct >= 80 ? "#059669" : s.pct >= 50 ? "#2563EB" : "#D97706" }}>{s.pct}% Complete</span>
                      ); })()}
                    </div>
                    {/* Overall progress bar */}
                    {(() => { const s = tocStats(selectedManual.toc); return (
                      <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1.5">
                        <div className="h-full rounded-full transition-all" style={{ width: `${s.pct}%`, background: s.pct >= 80 ? "#22C55E" : s.pct >= 50 ? "#3B82F6" : "#F59E0B" }} />
                      </div>
                    ); })()}
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {selectedManual.toc.map(item => {
                      const isActive = selectedTocItem?.id === item.id;
                      const st = STATUS_STYLE[item.status];
                      return (
                        <button key={item.id} onClick={() => setSelectedTocItem(isActive ? null : item)}
                          className={`w-full text-left px-4 py-2.5 border-b border-gray-50 flex items-center gap-3 transition hover:bg-gray-50 ${isActive ? "bg-blue-50" : ""}`}>
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[0.65rem] font-bold flex-shrink-0" style={{ background: st.bg, color: st.text }}>{item.id}</span>
                          <span className="flex-1 text-xs font-medium truncate" style={{ color: isActive ? "#1E40AF" : "#374151" }}>{item.title}</span>
                          <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: st.bg, color: st.text }}>{item.status}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* TOC Detail Panel */}
                <div className="flex-1 overflow-y-auto p-6">
                  {selectedTocItem ? (
                    <div className="max-w-xl">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: STATUS_STYLE[selectedTocItem.status]?.bg, color: STATUS_STYLE[selectedTocItem.status]?.text }}>{selectedTocItem.id}</span>
                        <div>
                          <h3 className="text-base font-bold text-gray-800">{selectedTocItem.title}</h3>
                          <span className="text-xs text-gray-400">Section {selectedTocItem.id} of 14</span>
                        </div>
                      </div>
                      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                        <div className="flex items-center justify-between py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-500">Status</span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: STATUS_STYLE[selectedTocItem.status]?.bg, color: STATUS_STYLE[selectedTocItem.status]?.text }}>{selectedTocItem.status}</span>
                        </div>
                        <div className="flex items-center justify-between py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-500">Responsible Party</span>
                          <span className="text-xs font-semibold text-gray-700">{selectedTocItem.responsibleParty || selectedManual.responsibleParty}</span>
                        </div>
                        <div className="flex items-center justify-between py-1 border-b border-gray-100">
                          <span className="text-xs text-gray-500">Last Updated</span>
                          <span className="text-xs font-semibold text-gray-700">{selectedTocItem.lastUpdated || "—"}</span>
                        </div>
                        <div className="pt-1">
                          <span className="text-xs text-gray-500">Description</span>
                          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                            {TOC_DESCRIPTIONS[selectedTocItem.id]}
                          </p>
                        </div>
                        <div className="pt-2">
                          <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700">Upload Document</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-gray-400">
                      <div className="text-5xl mb-3">&#128218;</div>
                      <h3 className="text-base font-semibold text-gray-500 mb-1">Select a TOC Section</h3>
                      <p className="text-xs text-gray-400 max-w-xs mx-auto">Click any of the 14 TOC items on the left to view section details, status, and responsible party.</p>
                      {/* TOC summary grid */}
                      <div className="grid grid-cols-2 gap-2 mt-6 max-w-sm mx-auto">
                        {(() => { const s = tocStats(selectedManual.toc); return (
                          <React.Fragment>
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                              <div className="text-lg font-bold text-green-700">{s.complete}</div>
                              <div className="text-[0.6rem] text-green-600 font-semibold uppercase">Complete</div>
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                              <div className="text-lg font-bold text-blue-700">{s.inProgress}</div>
                              <div className="text-[0.6rem] text-blue-600 font-semibold uppercase">In Progress</div>
                            </div>
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                              <div className="text-lg font-bold text-amber-700">{s.pending}</div>
                              <div className="text-[0.6rem] text-amber-600 font-semibold uppercase">Pending</div>
                            </div>
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                              <div className="text-lg font-bold text-gray-700">{s.na}</div>
                              <div className="text-[0.6rem] text-gray-600 font-semibold uppercase">Not Applicable</div>
                            </div>
                          </React.Fragment>
                        ); })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-6xl mb-4 opacity-30">&#128214;</div>
                <h3 className="text-lg font-semibold text-gray-400 mb-2">Select a Facility Manual</h3>
                <p className="text-sm text-gray-400">Browse by project and facility on the left, then click any O&amp;M Manual to view its 14-section Standard TOC.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
