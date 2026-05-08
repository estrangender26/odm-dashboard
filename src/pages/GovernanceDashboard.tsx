import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";

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
  msState: Record<string, { compDate?: string | null; customPct?: number | null }>;
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
    let totalPct = 0;
    for (let i = 0; i < MSD.length; i++) {
      const st = msState[MSD[i].id];
      const pct = st?.customPct ?? (st?.compDate ? 100 : 0);
      totalPct = pct;
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

  const utils = trpc.useUtils();

  // tRPC queries with aggressive multi-user sync
  const { data: facilities } = trpc.governance.facilities.useQuery();
  const { data: milestoneState, error: msError } = trpc.governance.milestoneState.useQuery(
    { facilitySlug: activeFacility },
    { enabled: !!activeFacility, refetchInterval: 15000, refetchIntervalInBackground: true }
  );
  const { data: uploads, error: uploadsError } = trpc.governance.uploads.useQuery(
    { facilitySlug: activeFacility },
    { enabled: !!activeFacility, refetchInterval: 15000, refetchIntervalInBackground: true }
  );

  // Show query errors in console
  if (msError) console.error("[GOV] milestoneState error:", msError);
  if (uploadsError) console.error("[GOV] uploads error:", uploadsError);

  const saveMilestone = trpc.governance.saveMilestone.useMutation({
    onSuccess: () => {
      utils.governance.milestoneState.invalidate();
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
      alert("Upload failed: " + (err.message || "Server error"));
    },
  });

  // Build state map from DB
  const msStateMap = useMemo(() => {
    const map: Record<string, { compDate?: string | null; customPct?: number | null; pppDate?: string | null }> = {};
    if (milestoneState) {
      for (const s of milestoneState) {
        map[s.milestoneId] = {
          compDate: s.compDate,
          customPct: s.customPct,
          pppDate: s.pppDate,
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

  // Get planned date
  const getPlannedDate = (mId: string) => {
    const m = MSD.find(x => x.id === mId);
    if (!m || !effectivePpp) return "";
    return addMonths(effectivePpp, m.offset);
  };

  const currentFacility = FACILITIES.find(f => f.slug === activeFacility) || FACILITIES[0];

  // Edit handlers
  const startEdit = () => { setEditMode(true); setPendingMilestones({}); };
  const cancelEdit = () => { setEditMode(false); setPendingMilestones({}); setPppDate(""); };

  const saveAll = () => {
    const updates = Object.entries(pendingMilestones).map(([mId, v]) => ({
      facilitySlug: activeFacility,
      milestoneId: mId,
      compDate: v.compDate ?? null,
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

  // Upload handler
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ mId: string; cat: string; tocItem?: string } | null>(null);

  const handleFileSelect = (mId: string, cat: string, tocItem?: string) => {
    setUploadTarget({ mId, cat, tocItem });
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (file: File) => {
    if (!uploadTarget) return;

    // File size check: warn if > 5MB (base64 inflates by ~33%)
    const MAX_SIZE_MB = 5;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      alert(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_SIZE_MB}MB.`);
      setUploadTarget(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      console.log("[GOV CLIENT] Uploading file:", file.name, "size:", (base64.length / 1024).toFixed(1), "KB", "tocItem:", uploadTarget.tocItem || "null");
      addUpload.mutate({
        facilitySlug: activeFacility,
        milestoneId: uploadTarget.mId,
        category: uploadTarget.cat,
        tocItem: uploadTarget.tocItem || null,
        fileName: file.name,
        fileUrl: base64,
      });
      setUploadTarget(null);
    };
    reader.onerror = () => {
      alert("Failed to read file. Please try again.");
      setUploadTarget(null);
    };
    reader.readAsDataURL(file);
  };

  // Get uploads for a milestone
  const getUploadsForMs = (mId: string) => uploads?.filter(u => u.milestoneId === mId) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="text-white sticky top-0 z-50" style={{ background: 'linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)', boxShadow: '0 4px 12px rgba(22,50,79,0.10)' }}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/amd-logo.jpeg" alt="AMD" className="w-9 h-9 sm:w-10 sm:h-10 bg-white rounded-lg p-1 object-contain flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold truncate">OM Governance Dashboard</h1>
              <p className="text-xs sm:text-sm opacity-55" style={{ letterSpacing: '0.5px' }}>Multi-facility project tracking</p>
            </div>
          </div>
          {user && (
            <div className="flex items-center gap-2 text-xs sm:text-sm ml-auto">
              <img src={user.avatar || undefined} alt="" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 object-cover" />
              <span className="hidden sm:inline truncate max-w-[120px]">{user.name}</span>
            </div>
          )}
        </div>
      </header>

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
          <button
            onClick={() => {
              utils.governance.uploads.invalidate().then(() => {
                utils.governance.milestoneState.invalidate().then(() => {
                  console.log("[GOV] Manual refresh complete");
                });
              });
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

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
            e.target.value = "";
          }}
        />

        {/* ──── PROGRESS TAB ──── */}
        {activeTab === "progress" && (
          <div className="space-y-6">
            {/* S-Curve Chart */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Project S-Curve — {currentFacility.short}</h3>
              <SCurve msState={msStateMap} color={currentFacility.color} />
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
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                ) : (
                  <span className="text-sm font-semibold text-blue-700">
                    {fmtDate(msStateMap["M1"]?.pppDate || "")}
                  </span>
                )}
              </div>
            </div>

            {/* Milestone Tracker */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 sm:px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Milestone</th>
                      <th className="px-3 sm:px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Planned</th>
                      <th className="px-3 sm:px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Completion</th>
                      <th className="px-3 sm:px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Progress</th>
                      <th className="px-3 sm:px-4 py-3 text-left font-semibold text-gray-600 text-xs uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MSD.map(m => {
                      const comp = getCompDate(m.id);
                      const pct = getCustomPct(m.id);
                      const planned = getPlannedDate(m.id);
                      const isComplete = !!comp;

                      return (
                        <tr key={m.id} className="hover:bg-gray-50 transition">
                          <td className="px-3 sm:px-4 py-3 border-b border-gray-100">
                            <div className="font-semibold text-gray-800 text-xs sm:text-sm">{m.label}</div>
                          </td>
                          <td className="px-3 sm:px-4 py-3 border-b border-gray-100 text-gray-600 whitespace-nowrap text-xs sm:text-sm">{fmtDate(planned)}</td>
                          <td className="px-3 sm:px-4 py-3 border-b border-gray-100">
                            {editMode ? (
                              <input
                                type="date"
                                value={comp}
                                onChange={e => onMsChange(m.id, "compDate", e.target.value)}
                                className="px-2 py-1 border border-gray-300 rounded text-xs w-full sm:w-32"
                              />
                            ) : (
                              <span className={isComplete ? "text-green-700 font-semibold text-xs sm:text-sm" : "text-gray-400 text-xs sm:text-sm"}>
                                {fmtDate(comp)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 sm:px-4 py-3 border-b border-gray-100">
                            {editMode ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  value={pct}
                                  onChange={e => onMsChange(m.id, "customPct", Number(e.target.value))}
                                  className="w-16 sm:w-24"
                                />
                                <span className="text-xs font-semibold w-8">{pct}%</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="w-16 sm:w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${pct}%`, backgroundColor: currentFacility.color }}
                                  />
                                </div>
                                <span className="text-xs font-semibold">{pct}%</span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 sm:px-4 py-3 border-b border-gray-100">
                            {isComplete ? (
                              <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">Completed</span>
                            ) : pct > 0 ? (
                              <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-semibold">In Progress</span>
                            ) : (
                              <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs font-semibold">Pending</span>
                            )}
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
                      <div className="flex items-center gap-2">
                        {tocUploads.length > 0 && (
                          <span className="text-xs text-green-600 font-semibold">{tocUploads.length} uploaded</span>
                        )}
                        <button
                          onClick={() => handleFileSelect(msIds[0] || "M1", "toc", toc.id)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                        >
                          📎 Upload
                        </button>
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
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 border-b border-gray-100">
                        <button
                          onClick={() => handleFileSelect(msIds[0] || "M1", "deliverable", toc.id)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                        >
                          📎 Upload
                        </button>
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
                            className="px-2 py-1 border border-gray-300 rounded text-xs"
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

      <footer className="text-center py-5 text-sm text-gray-500 border-t border-gray-200 mt-6">
        OM Governance Dashboard — Multi-User Facility Tracking
      </footer>
    </div>
  );
}
