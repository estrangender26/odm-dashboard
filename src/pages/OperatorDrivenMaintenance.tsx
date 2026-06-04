import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";

// ── Types ──
interface InspectionRecord {
  id: number;
  facilityId: string | null;
  inspector: string | null;
  inspectionDate: string | null;
  assetTag: string | null;
  assetName: string | null;
  equipmentType: string | null;
  category: string | null;
  task: string | null;
  status: string | null;
  score: number | null;
  findings: string | null;
  action: string | null;
  recommendation: string | null;
  remarks: string | null;
  date: string | null;
  month: string | null;
  plantArea: string | null;
}

function Banner({ type, message, onDismiss }: { type: "error" | "success" | "info"; message: string; onDismiss?: () => void }) {
  const s: Record<string, string> = {
    error: "bg-red-50 border-red-200 text-red-800",
    success: "bg-green-50 border-green-200 text-green-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };
  return (
    <div className={`mb-3 px-4 py-3 border rounded-lg text-sm flex items-center gap-2 ${s[type]}`}>
      <span>{type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️"}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && <button type="button" onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    Pass: { bg: "#D1FAE5", text: "#059669" },
    Fail: { bg: "#FEE2E2", text: "#DC2626" },
    Warning: { bg: "#FEF3C7", text: "#D97706" },
    Pending: { bg: "#E2E8F0", text: "#64748B" },
    Corrective: { bg: "#DBEAFE", text: "#2563EB" },
    Open: { bg: "#FEF3C7", text: "#D97706" },
    Closed: { bg: "#D1FAE5", text: "#059669" },
  };
  const st = map[status] || { bg: "#F1F5F9", text: "#64748B" };
  return <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.text }}>{status}</span>;
}

// ── Severity classification ──
function classifySeverity(r: InspectionRecord): "critical" | "warning" | "info" {
  const criticalKw = ["critical", "urgent", "emergency", "shutdown", "catastrophic", "danger"];
  const warningKw = ["leak", "vibration", "loose", "worn", "hot", "overheat", "abnormal", "noisy", "corrosion", "misaligned"];
  const text = String(r.findings || r.action || "").toLowerCase();
  if (criticalKw.some(k => text.includes(k))) return "critical";
  if (warningKw.some(k => text.includes(k))) return "warning";
  return "info";
}

// ── AI Analysis Display ──
function AIAnalysisPanel({ finding }: { finding: InspectionRecord }) {
  const sev = classifySeverity(finding);
  const sevStyle = { critical: { bg: "#FEE2E2", text: "#DC2626", label: "Critical" }, warning: { bg: "#FEF3C7", text: "#D97706", label: "Warning" }, info: { bg: "#E2E8F0", text: "#475569", label: "Info" } };
  const s = sevStyle[sev];

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      {/* 1. Finding Summary */}
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">1. Finding Summary</h4>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="bg-gray-50 rounded px-2 py-1"><span className="text-gray-400">Asset:</span> <strong className="text-gray-700">{finding.assetTag || "—"}</strong></div>
          <div className="bg-gray-50 rounded px-2 py-1"><span className="text-gray-400">Name:</span> <strong className="text-gray-700">{finding.assetName || "—"}</strong></div>
          <div className="bg-gray-50 rounded px-2 py-1"><span className="text-gray-400">Equipment:</span> <strong className="text-gray-700">{finding.equipmentType || "—"}</strong></div>
          <div className="bg-gray-50 rounded px-2 py-1"><span className="text-gray-400">Area:</span> <strong className="text-gray-700">{finding.plantArea || finding.facilityId || "—"}</strong></div>
          <div className="bg-gray-50 rounded px-2 py-1"><span className="text-gray-400">Date:</span> <strong className="text-gray-700">{finding.date || "—"}</strong></div>
          <div className="bg-gray-50 rounded px-2 py-1"><span className="text-gray-400">Severity:</span> <strong style={{ color: s.text }}>{s.label}</strong></div>
        </div>
        <div className="mt-1.5 bg-gray-50 rounded px-2 py-1.5 text-xs text-gray-700">
          <span className="text-gray-400">Finding:</span> {finding.findings || "No finding recorded"}
        </div>
      </div>

      {/* 2. Probable Cause */}
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">2. Probable Cause Analysis</h4>
        <div className="space-y-1 text-xs">
          <div className="flex gap-2"><span className="text-gray-400 w-28 flex-shrink-0">Failure Mode:</span><span className="text-gray-700">{finding.category || "To be determined"}</span></div>
          <div className="flex gap-2"><span className="text-gray-400 w-28 flex-shrink-0">Possible Cause:</span><span className="text-gray-700">{finding.task || "Requires inspection"}</span></div>
          <div className="flex gap-2"><span className="text-gray-400 w-28 flex-shrink-0">Equipment Type:</span><span className="text-gray-700">{finding.equipmentType || "—"}</span></div>
        </div>
      </div>

      {/* 3. Recommended Action */}
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">3. Recommended Maintenance Action</h4>
        <div className="space-y-1 text-xs">
          <div className="flex gap-2"><span className="text-gray-400 w-28 flex-shrink-0">Immediate:</span><span className="text-gray-700">{finding.action || "No action recorded"}</span></div>
          <div className="flex gap-2"><span className="text-gray-400 w-28 flex-shrink-0">Recommendation:</span><span className="text-gray-700">{finding.recommendation || "—"}</span></div>
          <div className="flex gap-2"><span className="text-gray-400 w-28 flex-shrink-0">Work Type:</span><span className="text-gray-700">{sev === "critical" ? "CM — Corrective Maintenance (Immediate)" : sev === "warning" ? "PM — Schedule Preventive Maintenance" : "IN — Continue Inspection"}</span></div>
        </div>
      </div>

      {/* 4. Service Provider */}
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">4. Service Provider Recommendation</h4>
        <div className="text-xs text-gray-700">
          {finding.equipmentType?.toLowerCase().includes("pump") ? "🔧 Pump overhaul specialist recommended." :
           finding.equipmentType?.toLowerCase().includes("motor") ? "⚡ Motor rewinding/replacement contractor." :
           finding.equipmentType?.toLowerCase().includes("scada") || finding.equipmentType?.toLowerCase().includes("instrument") ? "🎛️ SCADA/Instrumentation calibration service." :
           finding.equipmentType?.toLowerCase().includes("electrical") ? "⚡ Electrical testing contractor." :
           finding.equipmentType?.toLowerCase().includes("valve") ? "🔧 Valve maintenance specialist." :
           finding.equipmentType?.toLowerCase().includes("transformer") ? "⚡ Transformer testing/oil analysis vendor." :
           finding.equipmentType?.toLowerCase().includes("blower") ? "🔧 Blower/motor overhaul specialist." :
           "👷 In-house maintenance team or general contractor."}
        </div>
      </div>

      {/* 5. SAP Readiness */}
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">5. SAP CO/FI & PM Readiness</h4>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="bg-blue-50 rounded px-2 py-1"><span className="text-blue-400">Func. Location:</span> <strong className="text-blue-800">{finding.facilityId || "TBD"}</strong></div>
          <div className="bg-blue-50 rounded px-2 py-1"><span className="text-blue-400">Equipment No.:</span> <strong className="text-blue-800">{finding.assetTag || "TBD"}</strong></div>
          <div className="bg-blue-50 rounded px-2 py-1"><span className="text-blue-400">Cost Center:</span> <strong className="text-blue-800">{finding.plantArea || "TBD"}</strong></div>
          <div className="bg-blue-50 rounded px-2 py-1"><span className="text-blue-400">GL Account:</span> <strong className="text-blue-800">{sev === "critical" ? "64000-CM" : sev === "warning" ? "63000-PM" : "61000-IN"}</strong></div>
          <div className="bg-blue-50 rounded px-2 py-1"><span className="text-blue-400">WBS/IO:</span> <strong className="text-blue-800">TBD</strong></div>
          <div className="bg-blue-50 rounded px-2 py-1"><span className="text-blue-400">Est. Cost:</span> <strong className="text-blue-800">TBD</strong></div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════

export default function OperatorDrivenMaintenance() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [equipFilter, setEquipFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [selectedFinding, setSelectedFinding] = useState<InspectionRecord | null>(null);
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const [view, setView] = useState<"table" | "ai">("table");

  // Fetch data
  const hasFetchedInspections = useRef(false);
  const inspectionsMutation = trpc.mw.listInspections.useMutation();

  useEffect(() => {
    if (hasFetchedInspections.current) return;
    hasFetchedInspections.current = true;
    inspectionsMutation.mutate({});
  }, [inspectionsMutation]);

  const rawRecords: InspectionRecord[] = useMemo(() => (inspectionsMutation.data as InspectionRecord[]) || [], [inspectionsMutation.data]);
  const isLoading = inspectionsMutation.isPending;

  // Filters
  const filtered = useMemo(() => {
    let d = rawRecords;
    if (search) {
      const s = search.toLowerCase();
      d = d.filter(r =>
        String(r.assetTag).toLowerCase().includes(s) ||
        String(r.assetName).toLowerCase().includes(s) ||
        String(r.findings).toLowerCase().includes(s) ||
        String(r.equipmentType).toLowerCase().includes(s) ||
        String(r.plantArea).toLowerCase().includes(s)
      );
    }
    if (statusFilter) d = d.filter(r => r.status === statusFilter);
    if (equipFilter) d = d.filter(r => r.equipmentType === equipFilter);
    if (areaFilter) d = d.filter(r => r.plantArea === areaFilter);
    return d;
  }, [rawRecords, search, statusFilter, equipFilter, areaFilter]);

  // Unique filter values
  const statuses = useMemo(() => [...new Set(rawRecords.map(r => r.status).filter((v): v is string => Boolean(v)))].sort(), [rawRecords]);
  const equipTypes = useMemo(() => [...new Set(rawRecords.map(r => r.equipmentType).filter((v): v is string => Boolean(v)))].sort(), [rawRecords]);
  const areas = useMemo(() => [...new Set(rawRecords.map(r => r.plantArea).filter((v): v is string => Boolean(v)))].sort(), [rawRecords]);

  // Stats
  const stats = useMemo(() => {
    const critical = filtered.filter(r => classifySeverity(r) === "critical").length;
    const warning = filtered.filter(r => classifySeverity(r) === "warning").length;
    const info = filtered.filter(r => classifySeverity(r) === "info").length;
    const pass = filtered.filter(r => r.status === "Pass").length;
    const fail = filtered.filter(r => r.status === "Fail").length;
    return { total: filtered.length, critical, warning, info, pass, fail };
  }, [filtered]);

  // AI data context
  const aiData = useMemo(() => {
    if (!selectedFinding) return filtered;
    return [selectedFinding];
  }, [filtered, selectedFinding]);

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {banner && <div className="flex-shrink-0 px-4 pt-3"><Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} /></div>}
      {inspectionsMutation.error && (
        <div className="flex-shrink-0 px-4 pt-3">
          <Banner type="error" message={`Unable to load inspections: ${inspectionsMutation.error.message}`} />
        </div>
      )}

      {/* Header */}
      <header className="flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)" }}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <Link to="/" className="flex items-center gap-3 no-underline text-white">
            <ProgramsEngineeringLogo size={56} borderRadius={8} />
            <div>
              <h1 className="text-base font-bold leading-tight">Operator Driven Maintenance</h1>
              <p className="text-[0.6rem] opacity-55 uppercase tracking-wider">Inspection &middot; AI Analysis &middot; SAP Readiness</p>
            </div>
          </Link>
          <div className="flex gap-2">
            <div className="bg-white/10 border border-white/20 rounded px-2.5 py-1.5 text-center">
              <div className="text-sm font-bold">{stats.total}</div>
              <div className="text-[0.55rem] uppercase opacity-70">Findings</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded px-2.5 py-1.5 text-center hidden sm:block">
              <div className="text-sm font-bold text-red-300">{stats.critical}</div>
              <div className="text-[0.55rem] uppercase opacity-70">Critical</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded px-2.5 py-1.5 text-center hidden sm:block">
              <div className="text-sm font-bold text-amber-300">{stats.warning}</div>
              <div className="text-[0.55rem] uppercase opacity-70">Warning</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Table */}
        <div className="w-full sm:w-[420px] lg:w-[480px] flex flex-col border-r border-gray-200 bg-white">
          {/* Toolbar */}
          <div className="flex-shrink-0 p-2.5 border-b border-gray-200 space-y-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#128269;</span>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search asset, finding, equipment..."
                className="w-full pl-8 pr-7 py-1.5 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
              {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#10005;</button>}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs bg-white flex-1 min-w-0">
                <option value="">All Status</option>
                {statuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={equipFilter} onChange={(e) => setEquipFilter(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs bg-white flex-1 min-w-0">
                <option value="">All Equipment</option>
                {equipTypes.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs bg-white flex-1 min-w-0">
                <option value="">All Areas</option>
                {areas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex gap-2 text-xs text-gray-500">
              <span><strong className="text-red-600">{stats.critical}</strong> Critical</span>
              <span><strong className="text-amber-600">{stats.warning}</strong> Warning</span>
              <span><strong className="text-green-600">{stats.pass}</strong> Pass</span>
              <span className="ml-auto"><strong>{filtered.length}</strong> shown</span>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading inspection records...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">🔍</div>
                <div className="text-sm font-semibold text-gray-600">No findings match</div>
              </div>
            ) : (
              filtered.map(r => {
                const sev = classifySeverity(r);
                const isSelected = selectedFinding?.id === r.id;
                return (
                  <div key={r.id}
                    onClick={() => { setSelectedFinding(r); setView("ai"); }}
                    className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition hover:bg-gray-50 ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sev === "critical" ? "bg-red-500" : sev === "warning" ? "bg-amber-500" : "bg-gray-300"}`} />
                          <span className={`text-xs font-semibold truncate ${isSelected ? "text-blue-800" : "text-gray-800"}`}>{r.assetTag || "—"}</span>
                          <StatusBadge status={r.status || "Pending"} />
                        </div>
                        <div className="text-[0.7rem] text-gray-500 mt-0.5">{r.assetName} &middot; {r.equipmentType} &middot; {r.plantArea}</div>
                        <div className="text-xs text-gray-700 mt-1 line-clamp-2">{r.findings || r.action || "No finding recorded"}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-1.5 text-[0.6rem] text-gray-400">
                      <span>{r.date}</span>
                      <span>&middot;</span>
                      <span>{r.inspector}</span>
                      <span>&middot;</span>
                      <span>Score: {r.score ?? "—"}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: AI Analysis Panel */}
        <div className="hidden sm:flex flex-1 flex-col bg-gray-100 overflow-hidden">
          {/* View tabs */}
          <div className="flex-shrink-0 flex items-center gap-1 px-4 py-2 bg-white border-b border-gray-200">
            <button type="button" onClick={() => setView("ai")} className={`px-3 py-1.5 rounded text-xs font-semibold ${view === "ai" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              🤖 AI Analysis
            </button>
            <button type="button" onClick={() => setView("table")} className={`px-3 py-1.5 rounded text-xs font-semibold ${view === "table" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              📋 Raw Data
            </button>
            {selectedFinding && (
              <span className="ml-auto text-xs text-gray-400">{selectedFinding.assetTag}</span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {view === "ai" ? (
              selectedFinding ? (
                <AIAnalysisPanel finding={selectedFinding} />
              ) : (
                <div className="text-center text-gray-400 py-16">
                  <div className="text-5xl mb-4">🤖</div>
                  <h3 className="text-base font-semibold text-gray-500 mb-2">Select a Finding</h3>
                  <p className="text-sm text-gray-400">Click any inspection finding in the left panel to see the AI analysis workflow.</p>
                </div>
              )
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Field</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedFinding ? Object.entries(selectedFinding).filter(([,v]) => v !== null && v !== undefined).map(([k, v]) => (
                      <tr key={k} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 text-gray-500 font-medium capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}</td>
                        <td className="px-3 py-1.5 text-gray-800">{String(v)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={2} className="text-center py-8 text-gray-400">Select a finding to view raw data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistant
        contextType="inspection"
        data={aiData}
        quickQuestions={[
          "Summarize critical findings",
          "Which findings need vendor support?",
          "Generate scope of work for this finding",
          "What SAP fields are needed for this finding?",
          "Which findings may become corrective maintenance?",
          "Prioritize findings by severity",
        ]}
      />
    </div>
  );
}
