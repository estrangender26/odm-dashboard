import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  MAX_UPLOAD_FILE_SIZE_BYTES,
} from "@contracts/upload-limits";

// ── Types ──
interface SmpDoc {
  id: number;
  code: string;
  title: string;
  revision: string | null;
  equipmentType: string | null;
  system: string | null;
  dateIssued: string | null;
  nextReview: string | null;
  status: string | null;
  responsibleParty: string | null;
  fileData: string | null;
  fileType: string | null;
  fileName: string | null;
}

type ModalMode = "create" | "edit" | "delete" | null;

// ── Equipment / System lists ──
const EQUIPMENT_TYPES = ["Blowers", "Chemical Dosing", "Compressors", "Filters", "Generators", "HVAC", "Instrumentation", "Motors", "PLC / SCADA", "Pumps", "Screens", "Tanks", "Transformers", "UV / Disinfection", "Valves"];
const SYSTEMS = ["Aeration", "Air Supply", "Automation", "Backup Power", "Building", "Disinfection", "Electrical", "Inlet", "SCADA", "Storage", "Treatment", "Water Supply"];
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

// ── Progress Overlay ──
function ProgressOverlay({ visible, label, sublabel, progress }: { visible: boolean; label: string; sublabel?: string; progress?: number }) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(13,33,55,0.55)", backdropFilter: "blur(2px)" }}>
      <div className="bg-white rounded-xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4 min-w-[260px]">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 animate-spin" style={{ animationDuration: "0.8s" }} />
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-800">{label}</p>
          {sublabel && <p className="text-xs text-gray-500 mt-1">{sublabel}</p>}
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: progress !== undefined ? `${Math.min(100, Math.max(5, progress))}%` : "60%",
              background: "linear-gradient(90deg, #2563EB 0%, #3B82F6 50%, #2563EB 100%)",
              backgroundSize: "200% 100%",
              animation: progress !== undefined ? "none" : "progressShimmer 1.5s ease-in-out infinite",
            }}
          />
        </div>
        <p className="text-[0.65rem] text-gray-400">Please wait...</p>
      </div>
      <style>{`
        @keyframes progressShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// ── Modal ──
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <span className="text-sm font-bold text-gray-800">{title}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
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
function PdfViewer({ fileData, title, fileName, onDownload }: {
  fileData: string | null; title: string; fileName?: string; onDownload?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [revokeUrl, setRevokeUrl] = useState<string | null>(null);

  void fileName;
  const src = useMemo(() => {
    if (revokeUrl) { URL.revokeObjectURL(revokeUrl); setRevokeUrl(null); }
    const b64 = fileData?.trim();
    if (b64 && b64.length > 100) {
      const url = base64ToBlobUrl(b64, "application/pdf");
      if (url) { setRevokeUrl(url); return url; }
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileData]);

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
              📤 Upload PDF
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
            ⬇️ Download PDF
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
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
            ⬇️ Download
          </button>
        )}
      </div>
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
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Progress states ──
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState("");

  // ── CRUD modal ──
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [modalForm, setModalForm] = useState({
    code: "", title: "", revision: "Rev. 1", equipmentType: "", system: "",
    dateIssued: "", nextReview: "", status: "Active", responsibleParty: "",
  });

  const utils = trpc.useUtils();

  // ── Fetch from DB ──
  const { data: smpData, isLoading } = trpc.smp.list.useQuery();
  const docs: SmpDoc[] = useMemo(() => {
    const items = (smpData?.items || []) as SmpDoc[];
    let d = [...items];
    if (search) { const q = search.toLowerCase(); d = d.filter(x => x.title.toLowerCase().includes(q) || x.code.toLowerCase().includes(q) || (x.equipmentType || "").toLowerCase().includes(q)); }
    if (eqFilter) d = d.filter(x => x.equipmentType === eqFilter);
    if (sysFilter) d = d.filter(x => x.system === sysFilter);
    if (statusFilter) d = d.filter(x => x.status === statusFilter);
    return d;
  }, [smpData, search, eqFilter, sysFilter, statusFilter]);

  // ── Stats ──
  const allDocs: SmpDoc[] = useMemo(() => (smpData?.items || []) as SmpDoc[], [smpData]);
  const stats = useMemo(() => ({
    total: allDocs.length,
    active: allDocs.filter(d => d.status === "Active").length,
    review: allDocs.filter(d => d.status === "Under Review").length,
    expired: allDocs.filter(d => d.status === "Expired").length,
  }), [allDocs]);

  const clearFilters = useCallback(() => { setSearch(""); setEqFilter(""); setSysFilter(""); setStatusFilter(""); }, []);

  // ── Mutations ──
  const createMut = trpc.smp.create.useMutation({
    onSuccess: (data) => { utils.smp.list.invalidate(); setModalMode(null); resetForm(); setBanner({ type: "success", message: `SMP "${data.title}" created` }); },
    onError: (e) => setBanner({ type: "error", message: e.message }),
  });
  const updateMut = trpc.smp.update.useMutation({
    onSuccess: (data) => {
      utils.smp.list.invalidate();
      setModalMode(null);
      if (selectedDoc?.id === data.id) setSelectedDoc({ ...selectedDoc, ...data });
      setBanner({ type: "success", message: `SMP "${data.title}" updated` });
    },
    onError: (e) => setBanner({ type: "error", message: e.message }),
  });
  const deleteMut = trpc.smp.delete.useMutation({
    onSuccess: () => { utils.smp.list.invalidate(); setModalMode(null); setSelectedDoc(null); setBanner({ type: "success", message: "SMP deleted" }); },
    onError: (e) => setBanner({ type: "error", message: e.message }),
  });
  const seedMut = trpc.smp.seed.useMutation({
    onSuccess: (data) => { utils.smp.list.invalidate(); setBanner({ type: "success", message: `Demo data loaded: ${data.count} SMPs` }); },
    onError: (e) => setBanner({ type: "error", message: e.message }),
  });

  // ── Form helpers ──
  const resetForm = useCallback(() => {
    setModalForm({ code: "", title: "", revision: "Rev. 1", equipmentType: "", system: "", dateIssued: "", nextReview: "", status: "Active", responsibleParty: "" });
  }, []);

  const openCreate = useCallback(() => { resetForm(); setModalMode("create"); }, [resetForm]);
  const openEdit = useCallback(() => {
    if (!selectedDoc) return;
    setModalForm({
      code: selectedDoc.code, title: selectedDoc.title, revision: selectedDoc.revision || "Rev. 1",
      equipmentType: selectedDoc.equipmentType || "", system: selectedDoc.system || "",
      dateIssued: selectedDoc.dateIssued || "", nextReview: selectedDoc.nextReview || "",
      status: selectedDoc.status || "Active", responsibleParty: selectedDoc.responsibleParty || "",
    });
    setModalMode("edit");
  }, [selectedDoc]);

  const submitForm = useCallback(() => {
    if (!modalForm.code.trim() || !modalForm.title.trim()) { setBanner({ type: "error", message: "Code and Title are required" }); return; }
    const payload = {
      code: modalForm.code.trim(), title: modalForm.title.trim(), revision: modalForm.revision || "Rev. 1",
      equipmentType: modalForm.equipmentType || undefined, system: modalForm.system || undefined,
      dateIssued: modalForm.dateIssued || undefined, nextReview: modalForm.nextReview || undefined,
      status: modalForm.status || "Active", responsibleParty: modalForm.responsibleParty || undefined,
    };
    if (modalMode === "create") createMut.mutate(payload);
    else if (modalMode === "edit" && selectedDoc) updateMut.mutate({ id: selectedDoc.id, ...payload });
  }, [modalForm, modalMode, selectedDoc, createMut, updateMut]);

  // ── Upload PDF ──
  const handleUpload = useCallback((file: File) => {
    if (!selectedDoc) { setBanner({ type: "error", message: "Select a document first" }); return; }
    if (isUploading) { setBanner({ type: "error", message: "Please wait for the current upload to finish." }); return; }
    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      setBanner({ type: "error", message: MAX_UPLOAD_ERROR_MESSAGE });
      return;
    }
    setIsUploading(true); setUploadProgress(0); setUploadLabel(`Reading "${file.name}"...`);
    const reader = new FileReader();
    reader.onprogress = (ev) => { if (ev.lengthComputable) { setUploadProgress(Math.round((ev.loaded / ev.total) * 50)); setUploadLabel(`Reading "${file.name}"... ${Math.round((ev.loaded / ev.total) * 100)}%`); } };
    reader.onloadstart = () => { setUploadProgress(5); };
    reader.onload = () => {
      setUploadProgress(60); setUploadLabel(`Saving "${file.name}"...`);
      const dataUrl = reader.result as string;
      const commaIndex = dataUrl.indexOf(",");
      const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "";
      if (!base64 || base64.length < 100) { setIsUploading(false); setBanner({ type: "error", message: "Invalid PDF file" }); return; }
      updateMut.mutate({ id: selectedDoc.id, fileData: base64, fileType: file.type || "application/pdf", fileName: file.name }, {
        onSuccess: (data) => { setSelectedDoc(prev => prev?.id === data.id ? { ...prev, ...data, fileData: base64 } : prev); setUploadProgress(100); setTimeout(() => setIsUploading(false), 500); setBanner({ type: "success", message: `PDF "${file.name}" uploaded` }); },
        onError: () => setIsUploading(false),
      });
    };
    reader.onerror = () => { setIsUploading(false); setBanner({ type: "error", message: `Failed to read "${file.name}"` }); };
    reader.readAsDataURL(file);
  }, [isUploading, selectedDoc, updateMut]);

  // ── Download PDF ──
  const handleDownload = useCallback(() => {
    if (!selectedDoc) return;
    setIsDownloading(true); setDownloadLabel(`Preparing "${selectedDoc.code}"...`);
    if (selectedDoc.fileData) {
      const url = base64ToBlobUrl(selectedDoc.fileData, selectedDoc.fileType || "application/pdf");
      if (url) {
        const a = document.createElement("a");
        a.href = url; a.download = selectedDoc.fileName || `${selectedDoc.code}.pdf`; a.style.display = "none";
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
        setIsDownloading(false); setBanner({ type: "success", message: `Downloaded ${selectedDoc.fileName || selectedDoc.code}` });
        return;
      }
    }
    setIsDownloading(false); setBanner({ type: "error", message: `No PDF for ${selectedDoc.code}. Upload one first.` });
  }, [selectedDoc]);

  // ── Export ──
  const handleExport = useCallback(() => {
    const rows = docs.map(d => ({
      "SMP Code": d.code, "Title": d.title, "Revision": d.revision || "",
      "Equipment Type": d.equipmentType || "", "System": d.system || "",
      "Date Issued": d.dateIssued || "", "Next Review": d.nextReview || "",
      "Status": d.status || "", "Responsible": d.responsibleParty || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 45 }, { wch: 8 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SMP Documents");
    XLSX.writeFile(wb, "SMP_Documents_Export.xlsx");
    setBanner({ type: "success", message: `${rows.length} SMP documents exported.` });
  }, [docs]);

  // ═════════════ RENDER ═════════════
  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {banner && <div className="flex-shrink-0 px-4 pt-3"><Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} /></div>}

      <ProgressOverlay visible={isUploading} label={uploadLabel} progress={uploadProgress} />
      <ProgressOverlay visible={isDownloading} label={downloadLabel} sublabel="Preparing file..." />

      {/* Header */}
      <header className="flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-3 no-underline text-white">
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div>
              <h1 className="text-lg font-bold leading-tight">Standard Maintenance Procedures</h1>
              <p className="text-xs opacity-55" style={{ letterSpacing: "1px", textTransform: "uppercase" }}>SOP &amp; SMP Document Library</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {allDocs.length === 0 && (
              <button onClick={() => seedMut.mutate()} className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700 flex items-center gap-1">
                🚀 Load Demo
              </button>
            )}
            <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold">{stats.total}</div>
              <div className="text-[0.6rem] uppercase opacity-70">Docs</div>
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
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, code, equipment type..."
                className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">&#10005;</button>}
            </div>
            {/* Filters */}
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
              <button onClick={openCreate} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 flex items-center gap-1">
                ➕ Add SMP
              </button>
              <button onClick={handleExport} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1">
                📊 Export
              </button>
              <button onClick={() => { if (selectedDoc) fileInputRef.current?.click(); else setBanner({ type: "info", message: "Select a document first" }); }}
                className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1">
                📤 Upload PDF
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
              {(search || eqFilter || sysFilter || statusFilter) && (
                <button onClick={clearFilters} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100">Clear</button>
              )}
            </div>
            {/* Stats */}
            <div className="flex gap-3 text-xs text-gray-500">
              <span><strong className="text-green-600">{stats.active}</strong> Active</span>
              <span><strong className="text-amber-600">{stats.review}</strong> Review</span>
              <span><strong className="text-red-600">{stats.expired}</strong> Expired</span>
              <span className="ml-auto"><strong>{docs.length}</strong> shown</span>
            </div>
          </div>

          {/* Document List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="text-center py-16 text-gray-400">
                <div className="relative w-8 h-8 mx-auto mb-3">
                  <div className="absolute inset-0 rounded-full border-2 border-gray-200" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-600 animate-spin" />
                </div>
                <div className="text-sm font-semibold">Loading...</div>
              </div>
            ) : docs.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">📂</div>
                <div className="text-sm font-semibold text-gray-600">{allDocs.length === 0 ? "No SMP documents" : "No documents found"}</div>
                <div className="text-xs mt-1">{allDocs.length === 0 ? "Click 'Load Demo' to add sample data" : "Try adjusting filters"}</div>
              </div>
            ) : (
              docs.map((doc) => {
                const isSelected = selectedDoc?.id === doc.id;
                const sb = statusBadge(doc.status || "Active");
                return (
                  <div key={doc.id} onClick={() => setSelectedDoc(doc)}
                    className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition hover:bg-gray-50 ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[0.65rem] font-semibold text-gray-400 uppercase tracking-wide">{doc.code} &middot; {doc.revision}</div>
                        <div className={`text-sm font-semibold mt-0.5 truncate ${isSelected ? "text-blue-800" : "text-gray-800"}`}>{doc.title}</div>
                      </div>
                      <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0" style={{ background: sb.bg, color: sb.text }}>{doc.status}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                      <span>{doc.equipmentType}</span><span>&middot;</span><span>{doc.system}</span><span>&middot;</span><span>Review: {doc.nextReview}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="hidden sm:flex flex-1 flex-col bg-gray-100">
          {selectedDoc ? (
            <div className="flex-1 flex flex-col">
              {/* Doc Header */}
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
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: statusBadge(selectedDoc.status || "Active").bg, color: statusBadge(selectedDoc.status || "Active").text }}>{selectedDoc.status}</span>
                    <span className="text-xs text-gray-400">Issued: {selectedDoc.dateIssued}</span>
                    <span className="text-xs text-gray-400">Next Review: {selectedDoc.nextReview}</span>
                  </div>
                </div>
                {/* CRUD Action buttons */}
                <div className="flex gap-2 mt-3">
                  <button onClick={openEdit} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-semibold hover:bg-blue-100 flex items-center gap-1">
                    ✏️ Edit
                  </button>
                  <button onClick={() => setModalMode("delete")} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100 flex items-center gap-1">
                    🗑️ Delete
                  </button>
                  <button onClick={handleDownload} className="px-3 py-1.5 bg-green-50 text-green-600 rounded text-xs font-semibold hover:bg-green-100 flex items-center gap-1">
                    ⬇️ Download PDF
                  </button>
                </div>
              </div>
              {/* PDF Viewer */}
              <PdfViewer
                fileData={selectedDoc.fileData}
                title={`${selectedDoc.code} — ${selectedDoc.title}`}
                fileName={selectedDoc.fileName || `${selectedDoc.code}.pdf`}
                onDownload={() => fileInputRef.current?.click()}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-6xl mb-4 opacity-30">📋</div>
                <h3 className="text-lg font-semibold text-gray-400 mb-2">Select a Document</h3>
                <p className="text-sm text-gray-400">Click on any SMP document to view details.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── CRUD Modal: Create / Edit ── */}
      {(modalMode === "create" || modalMode === "edit") && (
        <Modal title={modalMode === "create" ? "➕ Add New SMP" : "✏️ Edit SMP"} onClose={() => setModalMode(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">SMP Code *</label>
                <input value={modalForm.code} onChange={e => setModalForm(p => ({ ...p, code: e.target.value }))}
                  placeholder="SMP-EQP-001" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Revision</label>
                <input value={modalForm.revision} onChange={e => setModalForm(p => ({ ...p, revision: e.target.value }))}
                  placeholder="Rev. 1" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
              <input value={modalForm.title} onChange={e => setModalForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Procedure title..." className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Equipment Type</label>
                <select value={modalForm.equipmentType} onChange={e => setModalForm(p => ({ ...p, equipmentType: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white">
                  <option value="">Select...</option>
                  {EQUIPMENT_TYPES.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">System</label>
                <select value={modalForm.system} onChange={e => setModalForm(p => ({ ...p, system: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white">
                  <option value="">Select...</option>
                  {SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Date Issued</label>
                <input type="date" value={modalForm.dateIssued} onChange={e => setModalForm(p => ({ ...p, dateIssued: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Next Review</label>
                <input type="date" value={modalForm.nextReview} onChange={e => setModalForm(p => ({ ...p, nextReview: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                <select value={modalForm.status} onChange={e => setModalForm(p => ({ ...p, status: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Responsible Party</label>
                <input value={modalForm.responsibleParty} onChange={e => setModalForm(p => ({ ...p, responsibleParty: e.target.value }))}
                  placeholder="e.g. Maintenance" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={submitForm}
                disabled={createMut.isPending || updateMut.isPending || !modalForm.code.trim() || !modalForm.title.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {createMut.isPending || updateMut.isPending ? "Saving..." : modalMode === "create" ? "Create SMP" : "Update SMP"}
              </button>
              <button onClick={() => setModalMode(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirmation ── */}
      {modalMode === "delete" && selectedDoc && (
        <Modal title="🗑️ Delete SMP" onClose={() => setModalMode(null)}>
          <p className="text-sm text-gray-700 mb-4">
            Are you sure you want to delete <strong>{selectedDoc.code} — {selectedDoc.title}</strong>?<br />
            This action cannot be undone.
          </p>
          <div className="flex gap-2">
            <button onClick={() => deleteMut.mutate({ id: selectedDoc.id })}
              disabled={deleteMut.isPending}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
              {deleteMut.isPending ? "Deleting..." : "Delete"}
            </button>
            <button onClick={() => setModalMode(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* AI Assistant */}
      <AIAssistant contextType="smp" data={allDocs} metadata={{ sourceModule: "Standard Maintenance Procedures", sourceRecordId: "smp-library", sourceRecordLabel: "SMP Library" }} title="SMP AI" quickQuestions={[
        "Which equipment types are missing SMPs?",
        "Which SMPs are expired or under review?",
        "Summarize SMP coverage by system.",
        "Which responsible parties have the most SMPs?",
        "What is the overall SMP completion status?",
      ]} position="bottom-right" />
    </div>
  );
}
