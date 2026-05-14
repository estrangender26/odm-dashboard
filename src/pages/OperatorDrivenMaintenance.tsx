import { useState, useMemo } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";

interface Finding {
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

function mapRecord(raw: any): Finding {
  return {
    id: raw.id ?? 0,
    facilityId: raw.facility_id ?? raw.facilityId ?? null,
    inspector: raw.inspector ?? null,
    inspectionDate: raw.inspection_date ?? raw.inspectionDate ?? null,
    assetTag: raw.asset_tag ?? raw.assetTag ?? null,
    assetName: raw.asset_name ?? raw.assetName ?? null,
    equipmentType: raw.equipment_type ?? raw.equipmentType ?? null,
    category: raw.category ?? null,
    task: raw.task ?? null,
    status: raw.status ?? null,
    score: raw.score ?? null,
    findings: raw.findings ?? null,
    action: raw.action ?? null,
    recommendation: raw.recommendation ?? null,
    remarks: raw.remarks ?? null,
    date: raw.date ?? null,
    month: raw.month ?? null,
    plantArea: raw.plant_area ?? raw.plantArea ?? null,
  };
}

function classifySeverity(r: Finding): "critical" | "warning" | "info" {
  const criticalKw = ["critical", "urgent", "emergency", "shutdown", "catastrophic", "danger"];
  const warningKw = ["leak", "vibration", "loose", "worn", "hot", "overheat", "abnormal", "noisy", "corrosion", "misaligned"];
  const text = String(r.findings || "").toLowerCase();
  if (criticalKw.some(k => text.includes(k))) return "critical";
  if (warningKw.some(k => text.includes(k))) return "warning";
  return "info";
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { bg: string; text: string }> = {
    Pass: { bg: "#D1FAE5", text: "#059669" },
    Fail: { bg: "#FEE2E2", text: "#DC2626" },
    Warning: { bg: "#FEF3C7", text: "#D97706" },
    Open: { bg: "#FEF3C7", text: "#D97706" },
    Closed: { bg: "#D1FAE5", text: "#059669" },
  };
  const s = m[status] || { bg: "#F1F5F9", text: "#64748B" };
  return <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.text }}>{status}</span>;
}

function SeverityDot({ severity }: { severity: string }) {
  const c = severity === "critical" ? "bg-red-500" : severity === "warning" ? "bg-amber-500" : "bg-gray-300";
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c}`} />;
}

export default function OperatorDrivenMaintenance() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [equipFilter, setEquipFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  // Fetch real data
  const { data: apiResponse, isLoading, isError } = trpc.mw.listInspections.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Map API response
  const rawRecords: Finding[] = useMemo(() => {
    if (isError || !apiResponse) return [];
    const rows = (apiResponse as any)?.rows || apiResponse;
    if (!Array.isArray(rows)) return [];
    return rows.map(mapRecord);
  }, [apiResponse, isError]);

  // Filter: findings only (no blank/null/"No finding recorded")
  const findingsOnly = useMemo(() => {
    return rawRecords.filter(r => {
      const f = String(r.findings || "").trim();
      return f && f !== "No finding recorded" && f !== "-" && f.length > 3;
    });
  }, [rawRecords]);

  // Apply filters to findings
  const filtered = useMemo(() => {
    let d = findingsOnly;
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
  }, [findingsOnly, search, statusFilter, equipFilter, areaFilter]);

  // Filter options
  const statuses = useMemo(() => [...new Set(findingsOnly.map(r => r.status).filter(Boolean))].sort(), [findingsOnly]);
  const equipTypes = useMemo(() => [...new Set(findingsOnly.map(r => r.equipmentType).filter(Boolean))].sort(), [findingsOnly]);
  const areas = useMemo(() => [...new Set(findingsOnly.map(r => r.plantArea).filter(Boolean))].sort(), [findingsOnly]);

  // Stats
  const stats = useMemo(() => {
    const critical = findingsOnly.filter(r => classifySeverity(r) === "critical").length;
    const warning = findingsOnly.filter(r => classifySeverity(r) === "warning").length;
    const info = findingsOnly.filter(r => classifySeverity(r) === "info").length;
    return { total: findingsOnly.length, critical, warning, info };
  }, [findingsOnly]);

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)" }}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <Link to="/" className="flex items-center gap-3 no-underline text-white">
            <ProgramsEngineeringLogo size={56} borderRadius={8} />
            <div>
              <h1 className="text-base font-bold leading-tight">Operator Driven Maintenance</h1>
              <p className="text-[0.6rem] opacity-55 uppercase tracking-wider">Inspection Findings Dashboard</p>
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

      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Findings List */}
        <div className="w-full sm:w-[420px] lg:w-[460px] flex flex-col border-r border-gray-200 bg-white">
          {/* Toolbar */}
          <div className="flex-shrink-0 p-2.5 border-b border-gray-200 space-y-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#128269;</span>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search asset, finding, equipment..."
                className="w-full pl-8 pr-7 py-1.5 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
              {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#10005;</button>}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs bg-white flex-1 min-w-0">
                <option value="">All Status</option>
                {statuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={equipFilter} onChange={e => setEquipFilter(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs bg-white flex-1 min-w-0">
                <option value="">All Equipment</option>
                {equipTypes.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs bg-white flex-1 min-w-0">
                <option value="">All Areas</option>
                {areas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex gap-2 text-xs text-gray-500">
              <span><strong className="text-red-600">{stats.critical}</strong> Critical</span>
              <span><strong className="text-amber-600">{stats.warning}</strong> Warning</span>
              <span><strong className="text-blue-600">{stats.info}</strong> Info</span>
              <span className="ml-auto"><strong>{filtered.length}</strong> shown</span>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading findings...</div>
            ) : isError ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-2xl mb-2">⚠️</div>
                <div className="text-sm font-semibold text-gray-600">Failed to load findings</div>
                <div className="text-xs mt-1">Check your network connection</div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">🔍</div>
                <div className="text-sm font-semibold text-gray-600">No findings match</div>
                {stats.total > 0 && <div className="text-xs mt-1">{stats.total} total findings — try adjusting filters</div>}
              </div>
            ) : (
              filtered.map(r => {
                const sev = classifySeverity(r);
                const isSelected = selectedFinding?.id === r.id;
                return (
                  <div key={r.id} onClick={() => setSelectedFinding(r)}
                    className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition hover:bg-gray-50 ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"}`}>
                    <div className="flex items-start gap-2">
                      <SeverityDot severity={sev} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-semibold truncate ${isSelected ? "text-blue-800" : "text-gray-800"}`}>{r.assetTag || "—"}</span>
                          <StatusBadge status={r.status || "Pending"} />
                        </div>
                        <div className="text-[0.7rem] text-gray-500 mt-0.5">{r.assetName} &middot; {r.equipmentType} &middot; {r.plantArea}</div>
                        <div className="text-xs text-gray-700 mt-1 line-clamp-2">{r.findings}</div>
                        <div className="flex gap-2 mt-1.5 text-[0.6rem] text-gray-400">
                          <span>{r.date}</span><span>&middot;</span><span>{r.inspector}</span><span>&middot;</span><span>Score: {r.score ?? "—"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: Finding Detail */}
        <div className="hidden sm:flex flex-1 flex-col bg-gray-100 overflow-hidden">
          {selectedFinding ? (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="max-w-lg mx-auto space-y-4">
                {/* Header */}
                <div className="flex items-center gap-2">
                  <SeverityDot severity={classifySeverity(selectedFinding)} />
                  <h2 className="text-lg font-bold text-gray-800">{selectedFinding.assetTag}</h2>
                  <StatusBadge status={selectedFinding.status || "Pending"} />
                </div>
                <div className="text-sm text-gray-500">{selectedFinding.assetName} &middot; {selectedFinding.equipmentType} &middot; {selectedFinding.plantArea}</div>

                {/* Finding */}
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Finding</h3>
                  <p className="text-sm text-gray-800">{selectedFinding.findings}</p>
                </div>

                {/* Action */}
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Action Taken</h3>
                  <p className="text-sm text-gray-800">{selectedFinding.action || "—"}</p>
                </div>

                {/* Recommendation */}
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Recommendation</h3>
                  <p className="text-sm text-gray-800">{selectedFinding.recommendation || "—"}</p>
                </div>

                {/* Meta */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white rounded border border-gray-200 px-3 py-2"><span className="text-gray-400">Inspector:</span> <strong className="text-gray-700">{selectedFinding.inspector || "—"}</strong></div>
                  <div className="bg-white rounded border border-gray-200 px-3 py-2"><span className="text-gray-400">Date:</span> <strong className="text-gray-700">{selectedFinding.date || "—"}</strong></div>
                  <div className="bg-white rounded border border-gray-200 px-3 py-2"><span className="text-gray-400">Facility:</span> <strong className="text-gray-700">{selectedFinding.facilityId || "—"}</strong></div>
                  <div className="bg-white rounded border border-gray-200 px-3 py-2"><span className="text-gray-400">Score:</span> <strong className="text-gray-700">{selectedFinding.score ?? "—"}</strong></div>
                  <div className="bg-white rounded border border-gray-200 px-3 py-2"><span className="text-gray-400">Category:</span> <strong className="text-gray-700">{selectedFinding.category || "—"}</strong></div>
                  <div className="bg-white rounded border border-gray-200 px-3 py-2"><span className="text-gray-400">Task:</span> <strong className="text-gray-700">{selectedFinding.task || "—"}</strong></div>
                </div>

                {selectedFinding.remarks && (
                  <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
                    <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">Remarks</h3>
                    <p className="text-sm text-amber-800">{selectedFinding.remarks}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center max-w-md">
                <div className="text-5xl mb-4">📋</div>
                <h3 className="text-base font-semibold text-gray-500 mb-2">Inspection Findings</h3>
                <p className="text-sm">Select a finding from the list to view details.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistant
        contextType="odm"
        data={filtered}
        quickQuestions={[
          "Summarize the findings",
          "What are the top issues?",
          "Which assets are recurring?",
          "Show inspector performance",
          "What should we focus on?",
        ]}
      />
    </div>
  );
}
