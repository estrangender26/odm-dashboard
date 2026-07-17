import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  MAX_UPLOAD_FILE_SIZE_BYTES,
} from "@contracts/upload-limits";
import { deleteFileWithVerification, shouldUseDirectStorage, storageFileUrl, uploadFileDirect } from "@/lib/direct-storage-upload";

/* ── Banner (replaces alert) ── */
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

/* ───── Static Reference Data ───── */
const FACILITIES = [
  { slug: "aglipay", name: "AGLIPAY Sewage Treatment Plant", short: "AGLIPAY STP", color: "#f97316" },
  { slug: "htt", name: "HTT Sewage Treatment Plant", short: "HTT STP", color: "#3b82f6" },
  { slug: "eastbay", name: "EASTBAY Phase 2 Treatment Plant", short: "EASTBAY PH-2 TP", color: "#10b981" },
  { slug: "kaysakat", name: "KAYSAKAT Treatment Plant", short: "KAYSAKAT TP", color: "#8b5cf6" },
];

const MSD = [
  { id: "M1", label: "M1 - Technical Audit", offset: 0, toc: ["1","1A","1C","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["1","7"] },
  { id: "M2", label: "M2 - Design Validation & Basis of Design", offset: 1, toc: ["1","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["2","7","8"] },
  { id: "M3", label: "M3 - Construction Completion / O&M Transition", offset: 1, toc: ["1","1A","1B","1C","1D","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["3","6","7"] },
  { id: "M4", label: "M4 - P1 Acceptance", offset: 1, toc: ["1","1A","1B","1C","1D","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["3","4","7","8","9"] },
  { id: "M5", label: "M5 - P1 Defects Rectification", offset: 2, toc: ["1","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["4","5","7"] },
  { id: "M6", label: "M6 - P2 Acceptance", offset: 2, toc: ["1","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["3","4","6","7","8","9"] },
  { id: "M7", label: "M7 - P2 Defects Rectification", offset: 2, toc: ["1","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["3","4","5","6","7","8","9"] },
  { id: "M8", label: "M8 - TOC Performance Certificate", offset: 2, toc: ["1","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["3","4","5","6","7","8","9"] },
  { id: "M9", label: "M9 - Final TOC / Project Close-out", offset: 0, toc: ["1","1A","1B","1C","1D","2","3","4","5","6","7","8","9","10","11","12","13","14"], annex: ["1","2","3","4","5","6","7","8","9"] },
];

const TOC = [
  { id: "1", label: "1. Overview" },
  { id: "1A", label: "1A. Executive Summary" },
  { id: "1B", label: "1B. Project Overview" },
  { id: "1C", label: "1C. Scope of Work" },
  { id: "1D", label: "1D. Objectives" },
  { id: "2", label: "2. Design & Engineering" },
  { id: "3", label: "3. Construction & Commissioning" },
  { id: "4", label: "4. Operations & Maintenance" },
  { id: "5", label: "5. Environmental Compliance" },
  { id: "6", label: "6. Health & Safety" },
  { id: "7", label: "7. Quality Assurance" },
  { id: "8", label: "8. Training & Documentation" },
  { id: "9", label: "9. Financial Summary" },
  { id: "10", label: "10. Risk Assessment" },
  { id: "11", label: "11. Stakeholder Management" },
  { id: "12", label: "12. Performance Monitoring" },
  { id: "13", label: "13. Compliance & Permits" },
  { id: "14", label: "14. Close-out & Handover" },
];

const ANX = [
  { id: "1", label: "A. Technical Drawings" },
  { id: "2", label: "B. Design Calculations" },
  { id: "3", label: "C. Construction Records" },
  { id: "4", label: "D. Test Reports" },
  { id: "5", label: "E. Inspection Reports" },
  { id: "6", label: "F. Commissioning Records" },
  { id: "7", label: "G. O&M Manuals" },
  { id: "8", label: "H. Training Records" },
  { id: "9", label: "I. Warranty Certificates" },
];

const RJG = [
  { code: "R1", label: "Incomplete documentation" },
  { code: "R2", label: "Non-conformance with design specs" },
  { code: "R3", label: "Missing test results" },
  { code: "R4", label: "Non-compliance with regulations" },
  { code: "R5", label: "Incomplete training records" },
  { code: "R6", label: "Equipment defects found" },
  { code: "R7", label: "Missing permits/certifications" },
  { code: "R8", label: "Performance criteria not met" },
  { code: "R9", label: "Environmental violation" },
  { code: "R10", label: "Safety hazard identified" },
];

/* ───── Helpers ───── */
function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0];
}

function fmtDate(d: string) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ───── S-Curve Canvas ───── */
function SCurve({
  msState,
  color,
}: {
  msState: Record<string, { compDate?: string | null; customPct?: number | null; pppDate?: string | null }>;
  color: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const y = h - 40 - ((h - 80) * i) / 10;
      ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(w - 20, y); ctx.stroke();
      ctx.fillStyle = "#6b7280"; ctx.font = "10px sans-serif";
      ctx.fillText(`${i * 10}%`, 20, y + 3);
    }
    for (let i = 0; i <= 9; i++) {
      const x = 60 + ((w - 80) * i) / 9;
      ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, h - 40); ctx.stroke();
    }

    // Labels
    ctx.fillStyle = "#374151"; ctx.font = "bold 10px sans-serif";
    ctx.fillText("0%", 35, h - 38);
    ctx.fillText("100%", 25, 45);
    MSD.forEach((m, i) => {
      const x = 60 + ((w - 80) * (i + 1)) / 10;
      ctx.save(); ctx.translate(x, h - 20); ctx.rotate(-Math.PI / 4);
      ctx.fillText(m.id, 0, 0); ctx.restore();
    });

    // Planned curve (smooth)
    ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(60, h - 40);
    for (let i = 0; i < MSD.length; i++) {
      const x = 60 + ((w - 80) * (i + 1)) / 10;
      const y = h - 40 - ((h - 80) * ((i + 1) / MSD.length));
      ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#9ca3af"; ctx.font = "10px sans-serif";
    ctx.fillText("Planned", w - 70, h - 50);

    // Actual curve (from DB state)
    const actualPts: { x: number; y: number }[] = [];
    void 0;
    for (let i = 0; i < MSD.length; i++) {
      const st = msState[MSD[i].id];
      const pct = st?.customPct ?? (st?.compDate ? 100 : 0);
      if (i === 0) console.log("[SCURVE] msState keys:", Object.keys(msState), "M1 compDate:", msState["M1"]?.compDate, "→ pct:", pct);
      void pct;
      const x = 60 + ((w - 80) * (i + 1)) / 10;
      const y = h - 40 - ((h - 80) * pct) / 100;
      actualPts.push({ x, y });
    }

    if (actualPts.length > 0) {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(60, h - 40);
      for (const p of actualPts) ctx.lineTo(p.x, p.y);
      ctx.stroke();

      ctx.fillStyle = color;
      for (const p of actualPts) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = "10px sans-serif"; ctx.fillText("Actual", w - 70, 55);
    }
  }, [msState, color]);

  return (
    <div className="w-full overflow-x-auto">
      <canvas ref={canvasRef} width={700} height={300} className="min-w-[600px] w-full max-w-[700px]" />
    </div>
  );
}

/* ───── Main Component ───── */
export default function GovernanceDashboard() {
  const { user } = useAuth();
  const [activeFacility, setActiveFacility] = useState(FACILITIES[0].slug);
  const [activeTab, setActiveTab] = useState<"progress" | "deliverables" | "acceptance" | "references">("progress");
  const [editMode, setEditMode] = useState(false);
  const [pppDate, setPppDate] = useState("");

  // Pending state for edit mode
  const [pendingMilestones, setPendingMilestones] = useState<Record<string, { compDate?: string; customPct?: number }>>({});

  // Date input refs for focus after upload completion
  const dateInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const utils = trpc.useUtils();

  // tRPC queries with aggressive multi-user sync
  trpc.governance.facilities.useQuery();
  const { data: milestoneState, error: msError } = trpc.governance.milestoneState.useQuery(
    { facilitySlug: activeFacility },
    { enabled: !!activeFacility, refetchInterval: 15000, refetchIntervalInBackground: true }
  );
  const { data: uploads, error: uploadsError } = trpc.governance.uploads.useQuery(
    { facilitySlug: activeFacility },
    { enabled: !!activeFacility, refetchInterval: 15000, refetchIntervalInBackground: true }
  );
  trpc.governance.uploadCounts.useQuery(
    { facilitySlug: activeFacility },
    { enabled: !!activeFacility, refetchInterval: 15000, refetchIntervalInBackground: true }
  );

  useEffect(() => {
    if (msError) {
      console.error("[GOV] milestoneState error:", msError);
      setBanner({ type: "error", message: `Failed to load milestone data: ${msError.message}` });
    }
    if (uploadsError) {
      console.error("[GOV] uploads error:", uploadsError);
      setBanner({ type: "error", message: `Failed to load upload data: ${uploadsError.message}` });
    }
  }, [msError, uploadsError]);

  // Sync status feedback
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string>("");
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);

  const saveMilestone = trpc.governance.saveMilestone.useMutation({
    onMutate: () => setSyncStatus("saving"),
    onSuccess: () => {
      setSyncStatus("saved");
      setLastSavedAt(new Date().toLocaleTimeString());
      utils.governance.milestoneState.invalidate();
      utils.governance.uploadCounts.invalidate();
      setTimeout(() => setSyncStatus("idle"), 2000);
    },
    onError: (err) => {
      setSyncStatus("error");
      console.error("[GOV] Save failed:", err);
      setBanner({ type: "error", message: "Save failed: " + (err.message || "Server error") });
      setTimeout(() => setSyncStatus("idle"), 3000);
    },
  });

  const deleteUpload = trpc.governance.deleteUpload.useMutation({
    onSuccess: () => {
      utils.governance.uploads.invalidate();
      utils.governance.milestoneState.invalidate();
      showStatus("File removed — milestone completion updated");
    },
    onError: (err) => {
      showStatus(`Remove failed: ${err.message}`);
    },
  });

  const addUpload = trpc.governance.addUpload.useMutation({
    onSuccess: () => {
      // Immediately refetch so the user sees their upload AND invalidate for other queries
      utils.governance.uploads.invalidate().then(() => {
        utils.governance.uploads.refetch().then(() => {
          console.log("[GOV] Uploads refetched after addUpload");
        });
      });
    },
    onError: (err) => {
      console.error("[GOV] addUpload error:", err);
    },
  });

  // Build state map from DB (includes all persisted fields)
  const msStateMap = useMemo(() => {
    const map: Record<string, {
      compDate?: string | null;
      customPct?: number | null;
      pppDate?: string | null;
      readyStatus?: string | null;
      remarks?: string | null;
      updatedBy?: string | null;
      updatedAt?: Date | null;
    }> = {};
    if (milestoneState) {
      for (const s of milestoneState) {
        map[s.milestoneId] = {
          compDate: s.compDate,
          customPct: s.customPct,
          pppDate: s.pppDate,
          readyStatus: s.readyStatus,
          remarks: s.remarks,
          updatedBy: s.updatedBy,
          updatedAt: s.updatedAt,
        };
      }
    }
    return map;
  }, [milestoneState]);

  // Get effective PPP date
  const effectivePpp = pppDate || msStateMap["M1"]?.pppDate || "";

  // Get completion date for a milestone
  const getCompDate = (mId: string) => {
    const pend = pendingMilestones[mId];
    if (pend?.compDate !== undefined) return pend.compDate;
    return msStateMap[mId]?.compDate || "";
  };

  // Get custom pct for a milestone
  const getCustomPct = (mId: string) => {
    const pend = pendingMilestones[mId];
    if (pend?.customPct !== undefined) return pend.customPct ?? 0;
    return msStateMap[mId]?.customPct ?? 0;
  };

  // Checkbox simulation local override for chart preview only.
  // Stores `false` for milestones that should simulate as incomplete (0%).
  // When a milestone is NOT in this map, the DB value is used.
  // Resets on every page refresh (no localStorage).
  const [checkboxSim, setCheckboxSim] = useState<Record<string, false>>({});

  // Helper: is this milestone currently simulated as unchecked?
  const isSimUnchecked = (mId: string) => checkboxSim[mId] === false;

  // Merged state for S-Curve: DB + pending changes + checkbox simulation.
  // Uses deep-clone to avoid mutating the original msStateMap objects.
  const mergedStateMap = useMemo(() => {
    // Deep clone: new outer object + new inner objects
    const merged: typeof msStateMap = {};
    for (const [mId, st] of Object.entries(msStateMap)) {
      merged[mId] = { ...st };
    }

    // Apply pending edit changes
    for (const [mId, pend] of Object.entries(pendingMilestones)) {
      if (!merged[mId]) merged[mId] = {};
      if (pend.compDate !== undefined) merged[mId]!.compDate = pend.compDate;
      if (pend.customPct !== undefined) merged[mId]!.customPct = pend.customPct;
    }

    // Checkbox simulation: `false` means "simulate incomplete" (0% on chart).
    // Does NOT touch the database — purely visual.
    for (const mId of Object.keys(checkboxSim)) {
      if (checkboxSim[mId] === false) {
        if (!merged[mId]) merged[mId] = {};
        merged[mId] = { ...merged[mId]!, compDate: null };
      }
    }
    return merged;
  }, [msStateMap, pendingMilestones, checkboxSim]);

  // Get planned date
  const getPlannedDate = (mId: string) => {
    const m = MSD.find(x => x.id === mId);
    if (!m || !effectivePpp) return "";
    return addMonths(effectivePpp, m.offset);
  };

  // Upload completion: are ALL required TOC items for this milestone uploaded?
  const isMilestoneUploadComplete = (mId: string) => {
    const m = MSD.find(x => x.id === mId);
    if (!m || m.toc.length === 0 || !uploads) return false;
    return m.toc.every(tocId => uploads.some(u => u.tocItem === tocId));
  };

  const getUploadProgress = (mId: string) => {
    const m = MSD.find(x => x.id === mId);
    if (!m || m.toc.length === 0 || !uploads) return { complete: 0, total: 0 };
    const complete = m.toc.filter(tocId => uploads.some(u => u.tocItem === tocId)).length;
    return { complete, total: m.toc.length };
  };

  const currentFacility = FACILITIES.find(f => f.slug === activeFacility) || FACILITIES[0];

  // Edit handlers
  const startEdit = () => { setEditMode(true); setPendingMilestones({}); };
  const cancelEdit = () => { setEditMode(false); setPendingMilestones({}); setPppDate(""); };

  const saveAll = () => {
    const updates = Object.entries(pendingMilestones).map(([mId, v]) => ({
      facilitySlug: activeFacility,
      milestoneId: mId,
      compDate: v.compDate || null,
      customPct: v.customPct ?? null,
      pppDate: mId === "M1" && pppDate ? pppDate : undefined,
    }));

    // Also save PPP date if changed
    if (pppDate) {
      updates.push({
        facilitySlug: activeFacility,
        milestoneId: "M1",
        compDate: (pendingMilestones["M1"]?.compDate ?? getCompDate("M1")) || null,
        customPct: pendingMilestones["M1"]?.customPct ?? getCustomPct("M1"),
        pppDate,
      });
    }

    // Deduplicate by milestoneId
    const seen = new Set<string>();
    const unique = updates.filter(u => { if (seen.has(u.milestoneId)) return false; seen.add(u.milestoneId); return true; });

    for (const u of unique) {
      saveMilestone.mutate(u);
    }
    setEditMode(false);
    setPendingMilestones({});
    setPppDate("");
  };

  const onMsChange = (mId: string, field: "compDate" | "customPct", value: string | number) => {
    setPendingMilestones(prev => ({ ...prev, [mId]: { ...prev[mId], [field]: value } }));
  };

  // ─── Upload debug (visible on screen) ───
  const SHOW_UPLOAD_DEBUG = true;
  const [uploadDebug, setUploadDebug] = useState<{
    clicked?: string;
    selectedFile?: string;
    status?: string;
    responseStatus?: number;
    responseJson?: any;
    error?: string;
    dbUploadId?: number;
    lastDbCheck?: any;
  }>({});

  // ─── Upload status feedback ───
  const [uploadStatus, setUploadStatus] = useState<{ text: string; ts: number } | null>(null);
  const governanceUploadInProgressRef = useRef(false);

  const showStatus = (text: string) => setUploadStatus({ text, ts: Date.now() });

  // Dismiss status after 4s
  useEffect(() => {
    if (!uploadStatus) return;
    const t = setTimeout(() => setUploadStatus(null), 4000);
    return () => clearTimeout(t);
  }, [uploadStatus?.ts]);

  // ─── Upload handler — receives all params directly (no shared state) ───
  const handleFileUpload = async (
    file: File,
    mId: string,
    cat: string,
    tocItem?: string
  ) => {
    console.log("[UPLOAD] File selected:", file.name, "mId:", mId, "cat:", cat, "tocItem:", tocItem);
    if (governanceUploadInProgressRef.current) {
      showStatus("Another upload is already in progress.");
      setBanner({ type: "error", message: "Please wait for the current upload to finish." });
      return;
    }
    showStatus(`Uploading ${file.name}...`);
    setUploadDebug({
      clicked: `${cat} ${tocItem || ""} (ms: ${mId})`,
      selectedFile: file.name,
      status: "preparing",
      responseStatus: undefined,
      responseJson: undefined,
      error: undefined,
      dbUploadId: undefined,
    });

    // File size check
    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      showStatus(MAX_UPLOAD_ERROR_MESSAGE);
      setBanner({ type: "error", message: MAX_UPLOAD_ERROR_MESSAGE });
      return;
    }

    governanceUploadInProgressRef.current = true;
    let useStorage: boolean;
    try {
      useStorage = await shouldUseDirectStorage("governance");
    } catch (error) {
      governanceUploadInProgressRef.current = false;
      const message = error instanceof Error ? error.message : "Unable to determine the upload route.";
      showStatus(`Upload failed: ${message}`);
      setBanner({ type: "error", message });
      setUploadDebug(prev => ({ ...prev, status: "error", error: message }));
      return;
    }
    if (useStorage) {
      try {
        setUploadDebug(prev => ({ ...prev, status: "uploading" }));
        const result = await uploadFileDirect({
          module: "governance",
          file,
          target: {
            facilitySlug: activeFacility,
            milestoneId: mId,
            category: cat,
            tocItem: tocItem || null,
          },
          onProgress: (pct) => showStatus(`Uploading ${file.name} directly to Storage... ${pct}%`),
        });
        await Promise.all([utils.governance.uploads.invalidate(), utils.governance.uploadCounts.invalidate()]);
        showStatus(`Uploaded: ${file.name}`);
        setUploadDebug(prev => ({ ...prev, status: "success", responseStatus: 200, responseJson: result, dbUploadId: result.fileId }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Storage upload failed.";
        showStatus(`Upload failed: ${message}`);
        setBanner({ type: "error", message });
        setUploadDebug(prev => ({ ...prev, status: "error", error: message }));
      } finally {
        governanceUploadInProgressRef.current = false;
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      console.log("[UPLOAD] Sending:", file.name, "size:", (base64.length / 1024).toFixed(1), "KB");
      setUploadDebug(prev => ({ ...prev, status: "uploading" }));
      addUpload.mutate(
        {
          facilitySlug: activeFacility,
          milestoneId: mId,
          category: cat,
          tocItem: tocItem || null,
          fileName: file.name,
          fileUrl: base64,
        },
        {
          onSuccess: (data) => {
            governanceUploadInProgressRef.current = false;
            console.log("[UPLOAD] Success:", file.name, data);
            showStatus(`Uploaded: ${file.name}`);
            setUploadDebug(prev => ({
              ...prev,
              status: "success",
              responseStatus: 200,
              responseJson: data,
              dbUploadId: data?.id || (Array.isArray(data) ? data[0]?.id : undefined),
            }));
            // Check if milestone is now upload-complete
            utils.governance.uploads.invalidate().then(() => {
              // After refetch, check completion status
              const nowComplete = isMilestoneUploadComplete(mId);
              if (nowComplete) {
                // Auto-set completion date to target date if not already set
                const target = getPlannedDate(mId);
                if (target && !getCompDate(mId)) {
                  onMsChange(mId, "compDate", target);
                  showStatus(`All required files uploaded — completion set to ${fmtDate(target)}. Click Save.`);
                  // Focus the date input
                  setTimeout(() => {
                    const input = dateInputRefs.current[mId];
                    if (input) input.focus();
                  }, 100);
                }
              }
            });
          },
          onError: (err) => {
            governanceUploadInProgressRef.current = false;
            console.error("[UPLOAD] Failed:", err);
            showStatus(`Upload failed: ${err.message || "Server error"}`);
            setUploadDebug(prev => ({
              ...prev,
              status: "error",
              error: err.message || "Server error",
            }));
          },
        }
      );
    };
    reader.onerror = () => {
      governanceUploadInProgressRef.current = false;
      console.error("[UPLOAD] FileReader error");
      showStatus("Failed to read file");
      setBanner({ type: "error", message: "Failed to read file. Please try again." });
    };
    reader.readAsDataURL(file);
  };

  const removeGovernanceUpload = async (upload: { id: number; fileName: string; storagePath?: string | null }) => {
    if (!window.confirm(`Remove "${upload.fileName}"?\n\nThis will update milestone completion and the S-Curve.`)) return;
    if (upload.storagePath) {
      try {
        await deleteFileWithVerification("governance_uploads", upload.id);
        await Promise.all([utils.governance.uploads.invalidate(), utils.governance.uploadCounts.invalidate(), utils.governance.milestoneState.invalidate()]);
        showStatus("File removed");
      } catch (error) {
        setBanner({ type: "error", message: error instanceof Error ? error.message : "Remove failed." });
      }
      return;
    }
    deleteUpload.mutate({ id: upload.id });
  };

  // Reusable file input + label button
  const FileUploadButton = ({
    mId, cat, tocItem, label = "📎 Upload", className = "",
  }: {
    mId: string; cat: string; tocItem?: string; label?: string; className?: string;
  }) => {
    const inputId = `up-${mId}-${cat}-${tocItem || "x"}-${Math.random().toString(36).slice(2, 6)}`;
    return (
      <>
        <input
          id={inputId}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.rar,.txt,.csv,.ppt,.pptx"
          className="sr-only"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) {
              setUploadDebug(prev => ({ ...prev, clicked: `${cat} ${tocItem || ""} (ms: ${mId})`, status: "file_selected" }));
              handleFileUpload(file, mId, cat, tocItem);
            }
          }}
        />
        <label
          htmlFor={inputId}
          className={`inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 active:bg-blue-800 cursor-pointer select-none ${className}`}
        >
          {label}
        </label>
      </>
    );
  };


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="text-white sticky top-0 z-50" style={{ background: 'linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)', boxShadow: '0 4px 12px rgba(22,50,79,0.10)' }}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-3 min-w-0 no-underline text-white">
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold truncate">OM Governance Dashboard</h1>
              <p className="text-xs sm:text-sm opacity-55" style={{ letterSpacing: '0.5px' }}>Multi-facility project tracking</p>
            </div>
          </Link>
          {user && (
            <div className="flex items-center gap-2 text-xs sm:text-sm ml-auto">
              <img src={user.avatar || undefined} alt="" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 object-cover" />
              <span className="hidden sm:inline truncate max-w-[120px]">{user.name}</span>
            </div>
          )}
        </div>
      </header>

      {/* Banner */}
      {banner && <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />}

      {/* Responsive milestone styles */}
      <style>{`
        /* ─── DESKTOP >=1100px: 4-column table ─── */
        @media (min-width: 1100px) {
          .ms-table { table-layout: fixed; width: 100%; border-collapse: collapse; }
          .ms-table th, .ms-table td { padding: 12px 14px; vertical-align: middle; border-bottom: 1px solid #e5e7eb; }
          .ms-table th { font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; background: #f9fafb; }
          .ms-table td { font-size: 13px; }
          .ms-col-id  { width: 60px; }
          .ms-col-info { width: auto; }
          .ms-col-schedule { width: 120px; }
          .ms-col-completion { width: 420px; }
          /* Completion flex group */
          .ms-completion-group { display: flex; align-items: center; gap: 14px; }
          .ms-completion-group input[type="date"] { width: 150px; height: 36px; font-size: 12px; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #0f2d4a; }
          .ms-completion-group .ms-badge-stat { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; white-space: nowrap; display: inline-block; }
          .ms-completion-group .ms-done { width: 20px; height: 20px; accent-color: #16a34a; flex-shrink: 0; }
        }
        @media (min-width: 1280px) {
          .ms-col-completion { width: 480px; }
          .ms-completion-group input[type="date"] { width: 170px; }
        }

        /* ─── BELOW 1100px: card layout ─── */
        @media (max-width: 1099px) {
          .ms-table { display: block; width: 100%; border-collapse: separate; border-spacing: 0 8px; }
          .ms-table thead { display: none; }
          .ms-table tbody { display: block; }
          .ms-table tr { display: block; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
          .ms-table td.ms-card { display: block; border: none; padding: 14px 16px; }
          .ms-table td.ms-hide-below-1100 { display: none; }
          .ms-card-badge { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
          .ms-card-badge .badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 6px; color: #fff; flex-shrink: 0; }
          .ms-card-badge .title { font-size: 14px; font-weight: 600; color: #1f2937; }
          .ms-card-badge .subtitle { font-size: 11px; color: #6b7280; }
          .ms-card-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
          .ms-card-field label { font-size: 10px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; display: block; }
          .ms-card-field input[type="date"] { width: 100%; height: 38px; font-size: 13px; }
          .ms-card-field .stat { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
      `}</style>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 sm:py-5">
        {/* Facility Selector + Sync */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {FACILITIES.map(f => (
            <button
              key={f.slug}
              onClick={() => setActiveFacility(f.slug)}
              className={`px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${
                activeFacility === f.slug
                  ? "text-white shadow-md"
                  : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
              style={activeFacility === f.slug ? { backgroundColor: f.color } : {}}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.color }} />
              {f.short}
            </button>
          ))}
          {/* Sync status indicator */}
          {syncStatus !== "idle" && (
            <span className={`text-xs font-semibold px-2 py-1 rounded ${
              syncStatus === "saving" ? "bg-yellow-100 text-yellow-700" :
              syncStatus === "saved" ? "bg-green-100 text-green-700" :
              "bg-red-100 text-red-700"
            }`}>
              {syncStatus === "saving" && "⏳ Saving..."}
              {syncStatus === "saved" && "✓ Saved"}
              {syncStatus === "error" && "✗ Save failed"}
              {lastSavedAt && syncStatus === "saved" ? ` at ${lastSavedAt}` : ""}
            </span>
          )}
          <button
            onClick={async () => {
              console.log("[GOV] Refresh clicked — refetching...");
              setSyncStatus("saving");
              try {
                await Promise.all([
                  utils.governance.milestoneState.refetch(),
                  utils.governance.uploads.refetch(),
                  utils.governance.uploadCounts.refetch(),
                ]);
                // Clear checkbox simulation on refresh so chart reverts to DB
                setCheckboxSim({});
                setSyncStatus("saved");
                setLastSavedAt(new Date().toLocaleTimeString());
                setTimeout(() => setSyncStatus("idle"), 1500);
                console.log("[GOV] Refresh complete — DB values reloaded");
              } catch (err) {
                console.error("[GOV] Refresh failed:", err);
                setSyncStatus("error");
                setTimeout(() => setSyncStatus("idle"), 3000);
              }
            }}
            className="ml-auto px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 flex items-center gap-1"
            title="Force refresh for multi-user sync"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Edit banner */}
        {editMode && (
          <div className="mb-3 px-4 py-3 bg-yellow-50 border border-yellow-400 rounded-lg text-sm font-semibold text-yellow-800">
            ✏️ Edit mode: changes are not saved yet. Click <strong>Save</strong> to commit or <strong>Cancel</strong> to discard.
          </div>
        )}

        {/* Action bar */}
        <div className="flex flex-wrap gap-2 mb-4 p-3 bg-white border border-gray-200 rounded-lg items-center">
          <div className="text-sm font-semibold text-gray-700">{currentFacility.name}</div>
          <div className="ml-auto flex gap-2">
            {!editMode ? (
              <button onClick={startEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
                ✏️ Edit
              </button>
            ) : (
              <>
                <button onClick={saveAll} className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold hover:bg-green-800">
                  💾 Save
                </button>
                <button onClick={cancelEdit} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-200">
                  ✕ Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 scrollbar-none" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {(["progress", "deliverables", "acceptance", "references"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold capitalize border-b-2 transition whitespace-nowrap flex-shrink-0 ${
                activeTab === tab
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Upload status banner */}
        {uploadStatus && (
          <div className={`mb-3 px-3 py-2 rounded-lg text-sm font-semibold text-center transition-opacity ${
            uploadStatus.text.includes("failed")
              || uploadStatus.text.includes("too large")
              || uploadStatus.text === MAX_UPLOAD_ERROR_MESSAGE
              ? "bg-red-100 text-red-700"
              : uploadStatus.text.includes("Uploading")
              ? "bg-yellow-100 text-yellow-700"
              : "bg-green-100 text-green-700"
          }`}>
            {uploadStatus.text}
          </div>
        )}

        {/* ─── UPLOAD DEBUG PANEL (visible) ─── */}
        {SHOW_UPLOAD_DEBUG && (
          <div className="mb-4 border-2 border-orange-300 rounded-xl bg-orange-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-orange-800">Upload Debug</h3>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch("/api/debug/uploads");
                      const j = await r.json();
                      setUploadDebug(prev => ({ ...prev, lastDbCheck: j }));
                    } catch (e: any) {
                      setUploadDebug(prev => ({ ...prev, lastDbCheck: { error: e.message } }));
                    }
                  }}
                  className="px-3 py-1 bg-orange-600 text-white rounded text-xs font-semibold hover:bg-orange-700"
                >
                  Check DB uploads
                </button>
                <button
                  onClick={() => setUploadDebug({})}
                  className="px-3 py-1 bg-gray-400 text-white rounded text-xs font-semibold hover:bg-gray-500"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="space-y-1 text-xs font-mono">
              <div><strong>Clicked:</strong> {uploadDebug.clicked || "—"}</div>
              <div><strong>File:</strong> {uploadDebug.selectedFile || "—"}</div>
              <div><strong>Status:</strong> <span className={
                uploadDebug.status === "success" ? "text-green-700 font-bold" :
                uploadDebug.status === "error" ? "text-red-700 font-bold" :
                uploadDebug.status ? "text-blue-700" : "text-gray-500"
              }>{uploadDebug.status || "idle"}</span></div>
              {uploadDebug.responseStatus && (
                <div><strong>Response:</strong> {uploadDebug.responseStatus} {uploadDebug.responseStatus >= 200 && uploadDebug.responseStatus < 300 ? "OK" : "FAILED"}</div>
              )}
              {uploadDebug.dbUploadId && (
                <div><strong>DB ID:</strong> {uploadDebug.dbUploadId}</div>
              )}
              {uploadDebug.error && (
                <div className="text-red-700"><strong>Error:</strong> {uploadDebug.error}</div>
              )}
              {uploadDebug.lastDbCheck && (
                <div className="mt-2">
                  <strong>DB Check ({uploadDebug.lastDbCheck.count || 0} rows):</strong>
                  <pre className="mt-1 bg-white p-2 rounded text-[10px] overflow-auto max-h-40 border">
                    {JSON.stringify(uploadDebug.lastDbCheck, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            {/* Raw uploads from API */}
            <div className="mt-3">
              <strong className="text-xs">API uploads count:</strong>{" "}
              <span className="text-xs font-bold">{uploads?.length || 0}</span>
              {uploads && uploads.length > 0 && (
                <pre className="mt-1 bg-white p-2 rounded text-[10px] overflow-auto max-h-40 border">
                  {JSON.stringify(uploads.map(u => ({
                    id: u.id,
                    mId: u.milestoneId,
                    toc: u.tocItem,
                    cat: u.category,
                    name: u.fileName,
                  })), null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* ──── PROGRESS TAB ──── */}
        {activeTab === "progress" && (
          <div className="space-y-6">
            {/* S-Curve Chart */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Project S-Curve — {currentFacility.short}</h3>
              <SCurve msState={mergedStateMap} color={currentFacility.color} />
            </div>

            {/* PPP Date */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center gap-4">
                <label className="text-sm font-semibold text-gray-700">PPP Start Date:</label>
                {editMode ? (
                  <input
                    type="date"
                    value={pppDate || msStateMap["M1"]?.pppDate || ""}
                    onChange={e => setPppDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 opacity-100"
                    style={{ minWidth: 140, height: 40, WebkitAppearance: 'none' }}
                  />
                ) : (
                  <span className="text-sm font-semibold text-blue-700">
                    {fmtDate(msStateMap["M1"]?.pppDate || "")}
                  </span>
                )}
              </div>
            </div>

            {/* Milestone Tracker — 4-column: M# | Milestone | Schedule | Completion */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="ms-table">
                  <thead>
                    <tr>
                      <th className="ms-col-id">M#</th>
                      <th className="ms-col-info">MILESTONE</th>
                      <th className="ms-col-schedule">SCHEDULE</th>
                      <th className="ms-col-completion">COMPLETION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MSD.map(m => {
                      const comp = getCompDate(m.id);
                      const pct = getCustomPct(m.id);
                      const planned = getPlannedDate(m.id);
                      const isComplete = !!comp;

                      return (
                        <tr key={m.id} className="hover:bg-gray-50">
                          {/* ── Card cell: visible below 1100px ── */}
                          <td className="ms-card" colSpan={4}>
                            <div className="ms-card-badge">
                              <span className="badge" style={{ backgroundColor: currentFacility.color }}>{m.id}</span>
                              <div>
                                <div className="title">{m.label}</div>
                                <div className="subtitle">Target: {fmtDate(planned)}</div>
                                {(() => {
                                  const { complete, total } = getUploadProgress(m.id);
                                  if (total === 0) return null;
                                  const allDone = complete === total;
                                  return (
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${allDone ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                      {complete}/{total} files{allDone ? " ✓" : ""}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="ms-card-fields">
                              <div className="ms-card-field">
                                <label>Target</label>
                                <span className="text-gray-600 text-sm">{fmtDate(planned)}</span>
                              </div>
                              <div className="ms-card-field">
                                <label>Completed</label>
                                {editMode ? (
                                  <input type="date" value={comp} onChange={e => onMsChange(m.id, "compDate", e.target.value)}
                                    className="px-2 py-1 border border-gray-300 rounded text-sm bg-white" style={{ height: 38 }} />
                                ) : (
                                  <span className={isComplete ? "text-green-700 font-semibold text-sm" : "text-gray-400 text-sm"}>{fmtDate(comp)}</span>
                                )}
                              </div>
                              <div className="ms-card-field">
                                <label>Status</label>
                                <div className="flex items-center gap-2">
                                  {isSimUnchecked(m.id) ? (
                                    <span className="stat bg-orange-100 text-orange-700">Simulated</span>
                                  ) : isComplete ? (
                                    <span className="stat bg-green-100 text-green-700">Completed</span>
                                  ) : pct > 0 ? (
                                    <span className="stat bg-yellow-100 text-yellow-700">In Progress</span>
                                  ) : (
                                    <span className="stat bg-gray-100 text-gray-500">Pending</span>
                                  )}
                                  <input
                                    type="checkbox"
                                    checked={!isSimUnchecked(m.id)}
                                    className="w-5 h-5 accent-green-600"
                                    title={isSimUnchecked(m.id) ? "Check to revert to DB value" : "Uncheck to simulate incomplete"}
                                    onChange={() => {
                                      // Toggle simulation: unchecked → simulate incomplete (0%)
                                      //                    checked → revert to DB value
                                      setCheckboxSim(prev => {
                                        const next = { ...prev };
                                        if (prev[m.id] === false) {
                                          // Currently simulated incomplete → revert to DB
                                          delete next[m.id];
                                        } else {
                                          // Currently using DB → simulate incomplete
                                          next[m.id] = false;
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* ── Desktop columns: hidden below 1100px ── */}
                          <td className="ms-col-id ms-hide-below-1100">
                            <span className="text-xs font-bold px-2 py-1 rounded text-white" style={{ backgroundColor: currentFacility.color }}>{m.id}</span>
                          </td>
                          <td className="ms-col-info ms-hide-below-1100">
                            <div className="font-semibold text-gray-800">{m.label}</div>
                            {(() => {
                              const { complete, total } = getUploadProgress(m.id);
                              if (total === 0) return null;
                              const allDone = complete === total;
                              return (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1 inline-block ${allDone ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                  {complete}/{total} uploads{allDone ? " ✓" : ""}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="ms-col-schedule ms-hide-below-1100">
                            <div className="text-gray-600 text-sm whitespace-nowrap">{fmtDate(planned)}</div>
                          </td>
                          <td className="ms-col-completion ms-hide-below-1100">
                            <div className="ms-completion-group">
                              {editMode ? (
                                <input type="date" value={comp} onChange={e => onMsChange(m.id, "compDate", e.target.value)} />
                              ) : (
                                <span className={isComplete ? "text-green-700 font-semibold text-sm whitespace-nowrap" : "text-gray-400 text-sm whitespace-nowrap"}>{fmtDate(comp)}</span>
                              )}
                              {isSimUnchecked(m.id) ? (
                                <span className="ms-badge-stat bg-orange-100 text-orange-700">Simulated</span>
                              ) : isComplete ? (
                                <span className="ms-badge-stat bg-green-100 text-green-700">Completed</span>
                              ) : pct > 0 ? (
                                <span className="ms-badge-stat bg-yellow-100 text-yellow-700">In Progress</span>
                              ) : (
                                <span className="ms-badge-stat bg-gray-100 text-gray-500">Pending</span>
                              )}
                              <input
                                type="checkbox"
                                checked={!isSimUnchecked(m.id)}
                                className="ms-done"
                                title={isSimUnchecked(m.id) ? "Check to revert to DB value" : "Uncheck to simulate incomplete"}
                                onChange={() => {
                                  // Toggle simulation: unchecked → simulate incomplete (0%)
                                  //                    checked → revert to DB value
                                  setCheckboxSim(prev => {
                                    const next = { ...prev };
                                    if (prev[m.id] === false) {
                                      // Currently simulated incomplete → revert to DB
                                      delete next[m.id];
                                    } else {
                                      // Currently using DB → simulate incomplete
                                      next[m.id] = false;
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* TOC Deliverables Upload */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-bold text-gray-800 mb-4">TOC Deliverables</h3>
              <div className="space-y-2">
                {TOC.map(toc => {
                  const msIds = MSD.filter(m => m.toc.includes(toc.id)).map(m => m.id);
                  const tocUploads = uploads?.filter(u => u.tocItem === toc.id) || [];
                  return (
                    <div key={toc.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-gray-50 rounded-lg gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs font-mono text-gray-500 w-6 flex-shrink-0">{toc.id}</span>
                        <span className="text-sm font-medium text-gray-800 truncate">{toc.label}</span>
                        {msIds.length > 0 && (
                          <span className="text-xs text-gray-400 flex-shrink-0">M{msIds.join(",")}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Uploaded file names */}
                        {tocUploads.length > 0 && (
                          <div className="flex flex-col gap-1">
                            {tocUploads.map(u => (
                              <span key={u.id} className="text-xs text-green-700 font-medium flex items-center gap-2">
                                ✓ {u.fileName}
                                <button type="button" onClick={() => window.open(storageFileUrl("governance_uploads", u.id, "view"), "_blank")} className="text-blue-500 hover:text-blue-700 text-xs px-1">View</button>
                                <button type="button" onClick={() => window.open(storageFileUrl("governance_uploads", u.id, "download"), "_blank")} className="text-blue-500 hover:text-blue-700 text-xs px-1">Download</button>
                                <button
                                  onClick={() => void removeGovernanceUpload(u)}
                                  className="text-red-400 hover:text-red-600 text-xs px-1"
                                  title="Remove file"
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        <FileUploadButton
                          mId={msIds[0] || "M1"}
                          cat="toc"
                          tocItem={toc.id}
                          label={tocUploads.length > 0 ? "📎 Upload more" : "📎 Upload"}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ──── DELIVERABLES TAB ──── */}
        {activeTab === "deliverables" && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">ID</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Deliverable</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Linked Milestones</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Uploads</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {TOC.map(toc => {
                  const msIds = MSD.filter(m => m.toc.includes(toc.id)).map(m => m.id);
                  const tocUploads = uploads?.filter(u => u.tocItem === toc.id || msIds.includes(u.milestoneId)) || [];
                  return (
                    <tr key={toc.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 border-b border-gray-100 font-mono text-gray-500">{toc.id}</td>
                      <td className="px-4 py-3 border-b border-gray-100 font-medium text-gray-800">{toc.label}</td>
                      <td className="px-4 py-3 border-b border-gray-100">
                        {msIds.map(id => (
                          <span key={id} className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs mr-1">{id}</span>
                        ))}
                      </td>
                      <td className="px-4 py-3 border-b border-gray-100">
                        {tocUploads.length > 0 ? (
                          <div className="space-y-1">
                            {tocUploads.map(u => (
                              <div key={u.id} className="flex items-center gap-2">
                                <span className="text-xs text-green-600">✓ {u.fileName}</span>
                                <button type="button" onClick={() => window.open(storageFileUrl("governance_uploads", u.id, "view"), "_blank")} className="text-blue-500 hover:text-blue-700 text-xs px-1">View</button>
                                <button type="button" onClick={() => window.open(storageFileUrl("governance_uploads", u.id, "download"), "_blank")} className="text-blue-500 hover:text-blue-700 text-xs px-1">Download</button>
                                <button
                                  onClick={() => void removeGovernanceUpload(u)}
                                  className="text-red-400 hover:text-red-600 text-xs px-1"
                                  title="Remove file"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 border-b border-gray-100">
                        <FileUploadButton
                          mId={msIds[0] || "M1"}
                          cat="deliverable"
                          tocItem={toc.id}
                          label="📎 Upload"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ──── ACCEPTANCE TAB ──── */}
        {activeTab === "acceptance" && (
          <div className="space-y-6">
            {/* P1 / P2 Acceptance */}
            {["P1", "P2"].map(stage => (
              <div key={stage} className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-lg font-bold text-gray-800 mb-4">{stage} Acceptance</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {MSD.filter(m => m.id.includes(stage === "P1" ? "M4" : "M6")).map(m => (
                    <div key={m.id} className="p-4 bg-gray-50 rounded-lg">
                      <div className="font-semibold text-gray-800 mb-2">{m.label}</div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-500">Completion:</span>
                        {editMode ? (
                          <input
                            type="date"
                            value={getCompDate(m.id)}
                            onChange={e => onMsChange(m.id, "compDate", e.target.value)}
                            className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-900 opacity-100"
                            style={{ minWidth: 130, height: 38, WebkitAppearance: 'none' }}
                          />
                        ) : (
                          <span className="text-sm font-semibold text-green-700">{fmtDate(getCompDate(m.id))}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{m.toc.length} TOC items</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Rejection Grounds */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Rejection Grounds</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {RJG.map(rj => (
                  <div key={rj.code} className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
                    <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-bold">{rj.code}</span>
                    <span className="text-sm text-gray-700">{rj.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ──── REFERENCES TAB ──── */}
        {activeTab === "references" && (
          <div className="space-y-6">
            {/* TOC-to-Annex Mapping */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-bold text-gray-800 mb-4">TOC-to-Milestone Mapping</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 text-xs">TOC Item</th>
                      {MSD.map(m => (
                        <th key={m.id} className="px-2 py-2 text-center font-semibold text-gray-600 text-xs">{m.id}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TOC.map(toc => (
                      <tr key={toc.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 border-b border-gray-100">
                          <span className="font-mono text-xs text-gray-500">{toc.id}</span>{" "}
                          <span className="text-gray-700">{toc.label}</span>
                        </td>
                        {MSD.map(m => (
                          <td key={m.id} className="px-2 py-2 border-b border-gray-100 text-center">
                            {m.toc.includes(toc.id) ? (
                              <span className="inline-block w-5 h-5 rounded-full" style={{ backgroundColor: currentFacility.color }} />
                            ) : (
                              <span className="inline-block w-5 h-5 rounded-full bg-gray-200" />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Annexes Reference */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Annexes Reference</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {ANX.map(anx => (
                  <div key={anx.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">{anx.id}</span>
                      <span className="font-medium text-gray-800 text-sm">{anx.label}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Milestones: {MSD.filter(m => m.annex.includes(anx.id)).map(m => m.id).join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="text-right py-5 px-5 text-sm text-gray-500 border-t border-gray-200 mt-6">
        Program Oversight Center &copy; 2026
      </footer>

      {/* AI Assistant */}
      <AIAssistant
        contextType="governance"
        data={milestoneState || []}
        filters={{ facility: activeFacility }}
        metadata={{ uploads: uploads || [], facilityName: FACILITIES.find(f => f.slug === activeFacility)?.name }}
        title="Governance AI"
      />
    </div>
  );
}
