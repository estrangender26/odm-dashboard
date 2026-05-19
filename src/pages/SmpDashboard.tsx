import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";

// ── Types ──
interface SmpDoc {
  id: number;
  code: string;
  title: string;
  revision: string;
  equipmentType: string;
  system: string;
  dateIssued: string;
  nextReview: string;
  status: string;
  responsibleParty: string;
  fileUrl?: string;
  fileType?: string;
  uploadedAt?: string;
}

interface StoredPdf {
  docId: number;
  fileName: string;
  fileType: string;
  fileData: string;
  uploadedAt: string;
}

// ── Mock data ──
const MOCK_DOCS: SmpDoc[] = [
  { id: 1, code: "SMP-EQP-001", title: "Pump Preventive Maintenance - Monthly", revision: "Rev. 2", equipmentType: "Pumps", system: "Water Supply", dateIssued: "2024-01-15", nextReview: "2025-01-15", status: "Active", responsibleParty: "Maintenance" },
  { id: 2, code: "SMP-EQP-002", title: "Motor Bearing Inspection - Quarterly", revision: "Rev. 1", equipmentType: "Motors", system: "Electrical", dateIssued: "2024-03-20", nextReview: "2025-03-20", status: "Active", responsibleParty: "Maintenance" },
  { id: 3, code: "SMP-EQP-003", title: "Blower Vibration Check - Weekly", revision: "Rev. 3", equipmentType: "Blowers", system: "Aeration", dateIssued: "2023-06-10", nextReview: "2024-06-10", status: "Under Review", responsibleParty: "Engineering" },
  { id: 4, code: "SMP-EQP-004", title: "Valve Inspection and Lubrication - Monthly", revision: "Rev. 1", equipmentType: "Valves", system: "Water Supply", dateIssued: "2024-02-01", nextReview: "2025-02-01", status: "Active", responsibleParty: "Operations" },
  { id: 5, code: "SMP-EQP-005", title: "Generator Load Test - Monthly", revision: "Rev. 2", equipmentType: "Generators", system: "Backup Power", dateIssued: "2024-01-10", nextReview: "2025-01-10", status: "Active", responsibleParty: "Electrical" },
  { id: 6, code: "SMP-EQP-006", title: "Transformer Oil Analysis - Annual", revision: "Rev. 1", equipmentType: "Transformers", system: "Electrical", dateIssued: "2023-08-15", nextReview: "2024-08-15", status: "Expired", responsibleParty: "Electrical" },
  { id: 7, code: "SMP-EQP-007", title: "Flow Meter Calibration - Quarterly", revision: "Rev. 2", equipmentType: "Instrumentation", system: "SCADA", dateIssued: "2024-04-01", nextReview: "2025-04-01", status: "Active", responsibleParty: "Instrumentation" },
  { id: 8, code: "SMP-PLC-001", title: "PLC/SCADA System Backup - Monthly", revision: "Rev. 4", equipmentType: "PLC / SCADA", system: "Automation", dateIssued: "2024-01-01", nextReview: "2025-01-01", status: "Active", responsibleParty: "IT/Automation" },
  { id: 9, code: "SMP-HVC-001", title: "HVAC Filter Replacement - Monthly", revision: "Rev. 1", equipmentType: "HVAC", system: "Building", dateIssued: "2024-02-15", nextReview: "2025-02-15", status: "Active", responsibleParty: "Facilities" },
  { id: 10, code: "SMP-EQP-008", title: "Compressor Oil Change - Quarterly", revision: "Rev. 2", equipmentType: "Compressors", system: "Air Supply", dateIssued: "2024-03-01", nextReview: "2025-03-01", status: "Active", responsibleParty: "Maintenance" },
  { id: 11, code: "SMP-CHM-001", title: "Chemical Dosing Pump Calibration - Monthly", revision: "Rev. 1", equipmentType: "Chemical Dosing", system: "Treatment", dateIssued: "2024-01-20", nextReview: "2025-01-20", status: "Active", responsibleParty: "Chemical" },
  { id: 12, code: "SMP-FLT-001", title: "Sand Filter Backwash Procedure - Weekly", revision: "Rev. 3", equipmentType: "Filters", system: "Treatment", dateIssued: "2023-09-01", nextReview: "2024-09-01", status: "Under Review", responsibleParty: "Operations" },
  { id: 13, code: "SMP-EQP-009", title: "UV System Lamp Replacement - Annual", revision: "Rev. 1", equipmentType: "UV / Disinfection", system: "Disinfection", dateIssued: "2024-05-01", nextReview: "2025-05-01", status: "Active", responsibleParty: "Maintenance" },
  { id: 14, code: "SMP-TNK-001", title: "Tank Internal Inspection - Annual", revision: "Rev. 2", equipmentType: "Tanks", system: "Storage", dateIssued: "2023-11-01", nextReview: "2024-11-01", status: "Under Review", responsibleParty: "Engineering" },
  { id: 15, code: "SMP-SCR-001", title: "Bar Screen Cleaning - Daily", revision: "Rev. 1", equipmentType: "Screens", system: "Inlet", dateIssued: "2024-06-01", nextReview: "2025-06-01", status: "Active", responsibleParty: "Operations" },
];

const EQUIPMENT_TYPES = Array.from(new Set(MOCK_DOCS.map(d => d.equipmentType))).sort();
const SYSTEMS = Array.from(new Set(MOCK_DOCS.map(d => d.system))).sort();
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

// ── Banner ──
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

// ── Helpers ──
function base64ToBlobUrl(b64: string, mime: string): string {
  try {
    const byteChars = atob(b64);
    const byteNums = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNums)], { type: mime });
    return URL.createObjectURL(blob);
  } catch { return ""; }
}

// ── PDF Viewer ──
function PdfViewer({ fileData, fileUrl, title, fileName, onDownload }: {
  fileData: string | null; fileUrl: string | null; title: string; fileName: string; onDownload?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [revokeUrl, setRevokeUrl] = useState<string | null>(null);

  const src = useMemo(() => {
    if (revokeUrl) { URL.revokeObjectURL(revokeUrl); setRevokeUrl(null); }
    const b64 = fileData?.trim();
    if (b64 && b64.length > 100) {
      const url = base64ToBlobUrl(b64, "application/pdf");
      if (url) { setRevokeUrl(url); return url; }
    }
    if (fileUrl?.trim()) return fileUrl.trim();
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileData, fileUrl]);

  useEffect(() => () => { if (revokeUrl) URL.revokeObjectURL(revokeUrl); }, [revokeUrl]);
  useEffect(() => { setLoadError(false); }, [src]);

  if (!src) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md text-gray-400">
          <div className="text-6xl mb-4">📄</div>
          <h3 className="text-lg font-semibold text-gray-500 mb-2">No PDF Available</h3>
          <p className="text-sm">This document has no PDF file attached.</p>
          {onDownload && (
            <button onClick={onDownload} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 flex items-center gap-2 mx-auto">
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Upload PDF
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md text-gray-400">
          <div className="text-5xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-600 mb-2">Cannot Preview PDF</h3>
          <button onClick={onDownload || (() => {})} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 flex items-center gap-2 mx-auto">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Download PDF
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 flex-wrap">
        <span className="text-xs font-semibold text-gray-700 truncate flex-1" title={title}>{title}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="px-2 py-1 bg-gray-100 rounded text-xs hover:bg-gray-200 font-bold">−</button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="px-2 py-1 bg-gray-100 rounded text-xs hover:bg-gray-200 font-bold">+</button>
          <button onClick={() => setZoom(1)} className="px-2 py-1 bg-gray-100 rounded text-xs hover:bg-gray-200">Fit</button>
        </div>
        {onDownload && (
          <button onClick={onDownload} className="px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded text-xs hover:bg-blue-100 font-semibold flex items-center gap-1 flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Download
          </button>
        )}
      </div>
      {/* PDF iframe with transform zoom */}
      <div className="flex-1 overflow-auto bg-gray-200 flex items-start justify-center p-4">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center", transition: "transform 0.15s ease", width: "850px", height: "1100px", maxWidth: "100%" }}>
          <iframe src={src} title={title} className="bg-white shadow-lg" style={{ width: "100%", height: "100%", border: "none", display: "block" }} onLoad={() => setLoadError(false)} onError={() => setLoadError(true)} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════
export default function SmpDashboard() {
  const [search, setSearch] = useState("");
  const [eqFilter, setEqFilter] = useState("");
  const [sysFilter, setSysFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<SmpDoc | null>(null);
  const [storedPdfs, setStoredPdfs] = useState<Map<number, StoredPdf>>(new Map());
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Filtered docs ──
  const filteredDocs = useMemo(() => {
    let d = MOCK_DOCS;
    if (search) {
      const s = search.toLowerCase();
      d = d.filter(x => x.title.toLowerCase().includes(s) || x.code.toLowerCase().includes(s) || x.equipmentType.toLowerCase().includes(s));
    }
    if (eqFilter) d = d.filter(x => x.equipmentType === eqFilter);
    if (sysFilter) d = d.filter(x => x.system === sysFilter);
    if (statusFilter) d = d.filter(x => x.status === statusFilter);
    return d;
  }, [search, eqFilter, sysFilter, statusFilter]);

  // ── Stats ──
  const stats = useMemo(() => ({
    total: MOCK_DOCS.length,
    active: MOCK_DOCS.filter(d => d.status === "Active").length,
    review: MOCK_DOCS.filter(d => d.status === "Under Review").length,
    expired: MOCK_DOCS.filter(d => d.status === "Expired").length,
    types: new Set(MOCK_DOCS.map(d => d.equipmentType)).size,
  }), []);

  const clearFilters = useCallback(() => {
    setSearch(""); setEqFilter(""); setSysFilter(""); setStatusFilter("");
  }, []);

  const handleExport = useCallback(() => {
    const rows = filteredDocs.map(d => ({
      "SMP Code": d.code,
      "Title": d.title,
      "Revision": d.revision,
      "Equipment Type": d.equipmentType,
      "System": d.system,
      "Date Issued": d.dateIssued,
      "Next Review": d.nextReview,
      "Status": d.status,
      "Responsible": d.responsibleParty,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 45 }, { wch: 8 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SMP Documents");
    XLSX.writeFile(wb, "SMP_Documents_Export.xlsx");
    setBanner({ type: "success", message: `${rows.length} SMP documents exported.` });
  }, [filteredDocs]);

  const handleUpload = useCallback((file: File) => {
    if (!selectedDoc) { setBanner({ type: "error", message: "Select a document first" }); return; }
    setBanner({ type: "info", message: `Reading "${file.name}"...` });
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      if (!base64 || base64.length < 100) {
        setBanner({ type: "error", message: "Invalid or empty PDF file" }); return;
      }
      setStoredPdfs(prev => {
        const next = new Map(prev);
        next.set(selectedDoc.id, { docId: selectedDoc.id, fileName: file.name, fileType: file.type || "application/pdf", fileData: base64, uploadedAt: new Date().toISOString() });
        return next;
      });
      setBanner({ type: "success", message: `PDF "${file.name}" uploaded for ${selectedDoc.code}` });
    };
    reader.onerror = () => setBanner({ type: "error", message: `Failed to read "${file.name}"` });
    reader.readAsDataURL(file);
  }, [selectedDoc]);

  const handleDownload = useCallback(() => {
    if (!selectedDoc) { setBanner({ type: "error", message: "Select a document first." }); return; }
    const stored = storedPdfs.get(selectedDoc.id);
    if (stored?.fileData) {
      const url = base64ToBlobUrl(stored.fileData, stored.fileType || "application/pdf");
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = stored.fileName || `${selectedDoc.code}.pdf`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
        setBanner({ type: "success", message: `Downloaded ${stored.fileName}` });
        return;
      }
    }
    if (selectedDoc.fileUrl) {
      const a = document.createElement("a");
      a.href = selectedDoc.fileUrl;
      a.download = `${selectedDoc.code}.pdf`;
      a.target = "_blank";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 100);
      setBanner({ type: "success", message: `Downloaded ${selectedDoc.code}` });
    } else {
      setBanner({ type: "error", message: `No PDF file available for ${selectedDoc.code}. Upload one first.` });
    }
  }, [selectedDoc, storedPdfs]);

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
              <h1 className="text-lg font-bold leading-tight">Standard Maintenance Procedures</h1>
              <p className="text-xs opacity-55" style={{ letterSpacing: "1px", textTransform: "uppercase" }}>SOP &amp; SMP Document Library</p>
            </div>
          </Link>
          <div className="flex gap-2">
            <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold">{stats.total}</div>
              <div className="text-[0.6rem] uppercase opacity-70">Documents</div>
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
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, code, equipment type..."
                className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&#10005;</button>
              )}
            </div>
            {/* Filters row */}
            <div className="grid grid-cols-3 gap-2">
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
              <button onClick={handleDownload} className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 ${selectedDoc ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>
                <span>&#11015;</span> Download
              </button>
              {(search || eqFilter || sysFilter || statusFilter) && (
                <button onClick={clearFilters} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100">Clear</button>
              )}
            </div>
            {/* Stats row */}
            <div className="flex gap-3 text-xs text-gray-500">
              <span><strong className="text-green-600">{stats.active}</strong> Active</span>
              <span><strong className="text-amber-600">{stats.review}</strong> Review</span>
              <span><strong className="text-red-600">{stats.expired}</strong> Expired</span>
              <span><strong>{stats.types}</strong> Equip. Types</span>
              <span className="ml-auto"><strong>{filteredDocs.length}</strong> shown</span>
            </div>
          </div>

          {/* Document List */}
          <div className="flex-1 overflow-y-auto">
            {filteredDocs.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">&#128196;</div>
                <div className="text-sm font-semibold text-gray-600">No documents found</div>
                <div className="text-xs mt-1">Try adjusting your search or filters</div>
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = selectedDoc?.id === doc.id;
                const sb = statusBadge(doc.status);
                return (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDoc(doc)}
                    className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition hover:bg-gray-50 ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[0.65rem] font-semibold text-gray-400 uppercase tracking-wide">{doc.code} &middot; {doc.revision}</div>
                        <div className={`text-sm font-semibold mt-0.5 truncate ${isSelected ? "text-blue-800" : "text-gray-800"}`}>{doc.title}</div>
                      </div>
                      <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0" style={{ background: sb.bg, color: sb.text }}>{doc.status}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                      <span>{doc.equipmentType}</span>
                      <span>&middot;</span>
                      <span>{doc.system}</span>
                      <span>&middot;</span>
                      <span>Review: {doc.nextReview}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT (PDF Viewer placeholder) ── */}
        <div className="hidden sm:flex flex-1 flex-col bg-gray-100">
          {selectedDoc ? (
            <div className="flex-1 flex flex-col">
              {/* Document Header */}
              <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{selectedDoc.code} &middot; {selectedDoc.revision}</div>
                    <h2 className="text-xl font-bold text-gray-800 mt-1">{selectedDoc.title}</h2>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                      <span><strong>Equipment:</strong> {selectedDoc.equipmentType}</span>
                      <span><strong>System:</strong> {selectedDoc.system}</span>
                      <span><strong>Responsible:</strong> {selectedDoc.responsibleParty}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: statusBadge(selectedDoc.status).bg, color: statusBadge(selectedDoc.status).text }}>{selectedDoc.status}</span>
                    <span className="text-xs text-gray-400">Issued: {selectedDoc.dateIssued}</span>
                    <span className="text-xs text-gray-400">Next Review: {selectedDoc.nextReview}</span>
                  </div>
                </div>
              </div>
              {/* PDF Viewer */}
              <PdfViewer
                fileData={storedPdfs.get(selectedDoc.id)?.fileData || null}
                fileUrl={selectedDoc.fileUrl || null}
                title={`${selectedDoc.code} — ${selectedDoc.title}`}
                fileName={storedPdfs.get(selectedDoc.id)?.fileName || `${selectedDoc.code}.pdf`}
                onDownload={handleDownload}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-6xl mb-4 opacity-30">&#128196;</div>
                <h3 className="text-lg font-semibold text-gray-400 mb-2">Select a Document</h3>
                <p className="text-sm text-gray-400">
                  Click on any SMP document from the left panel to view details.
                  Upload PDF files to view them in the integrated viewer.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistant
        contextType="maintenance"
        data={filteredDocs}
        quickQuestions={[
          "Which equipment types are missing SMPs?",
          "Which SMPs are expired or under review?",
          "Summarize SMP coverage by system.",
          "Which responsible parties have the most SMPs?",
          "What is the overall SMP completion status?",
          "Which SMPs need urgent review?",
        ]}
      />
    </div>
  );
}
