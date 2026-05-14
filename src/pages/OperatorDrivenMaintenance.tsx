import { useState, useMemo, useCallback, useEffect } from "react";
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

// ── Map snake_case API response to camelCase InspectionRecord ──
function mapRecord(raw: any): InspectionRecord {
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

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════

// ── Mock data fallback for when API is unavailable ──
const MOCK_RECORDS: InspectionRecord[] = [
  { id: 1, facilityId: "HTT-STP", inspector: "J. Cruz", inspectionDate: "2025-08-12", assetTag: "PU-HTT-001", assetName: "Raw Water Pump A", equipmentType: "Pumps", category: "Mechanical", task: "Check bearing temperature", status: "Fail", score: 45, findings: "Excessive vibration detected on bearing housing. Temperature reading 85°C, above normal 65°C. Oil seal showing minor leak.", action: "Schedule pump overhaul within 14 days. Monitor daily.", recommendation: "Replace bearings and oil seal. Check alignment.", remarks: "Vendor: PumpTech Services", date: "2025-08-12", month: "August 2025", plantArea: "Raw Water Intake" },
  { id: 2, facilityId: "HTT-STP", inspector: "M. Santos", inspectionDate: "2025-08-13", assetTag: "BL-HTT-003", assetName: "Aeration Blower 2", equipmentType: "Blowers", category: "Mechanical", task: "Inspect belt tension", status: "Warning", score: 72, findings: "Belt tension below spec (12mm deflection vs 8mm standard). Slight noise from motor coupling.", action: "Adjust belt tension. Inspect coupling.", recommendation: "Replace belts if adjustment insufficient. Check coupling alignment.", remarks: "", date: "2025-08-13", month: "August 2025", plantArea: "Aeration" },
  { id: 3, facilityId: "AGL-STP", inspector: "R. Reyes", inspectionDate: "2025-08-14", assetTag: "MC-AGL-007", assetName: "MCC Panel A", equipmentType: "Motors", category: "Electrical", task: "Thermal scan of terminals", status: "Pass", score: 92, findings: "All terminal temperatures within normal range. No hotspots detected.", action: "Continue normal operation.", recommendation: "Next inspection in 6 months.", remarks: "", date: "2025-08-14", month: "August 2025", plantArea: "Electrical Room" },
  { id: 4, facilityId: "AGL-STP", inspector: "J. Cruz", inspectionDate: "2025-08-15", assetTag: "SC-AGL-012", assetName: "SCADA Workstation", equipmentType: "SCADA", category: "Automation", task: "Check HMI response time", status: "Fail", score: 38, findings: "HMI response time 8 seconds (spec: <2s). Communication timeout alarms frequent. PLC program version outdated.", action: "Update PLC firmware. Check network cables.", recommendation: "Upgrade SCADA software. Replace aged network infrastructure.", remarks: "Vendor: AutoControl Systems needed", date: "2025-08-15", month: "August 2025", plantArea: "Control Room" },
  { id: 5, facilityId: "EBY-STP", inspector: "L. Garcia", inspectionDate: "2025-08-16", assetTag: "FM-EBY-004", assetName: "Effluent Flow Meter", equipmentType: "Flow Meters", category: "Instrumentation", task: "Calibrate flow reading", status: "Warning", score: 68, findings: "Flow reading 8% deviation from standard. Sensor fouling observed.", action: "Clean sensor. Recalibrate.", recommendation: "Schedule calibration service. Consider ultrasonic replacement.", remarks: "", date: "2025-08-16", month: "August 2025", plantArea: "Effluent" },
  { id: 6, facilityId: "HTT-STP", inspector: "M. Santos", inspectionDate: "2025-08-17", assetTag: "TR-HTT-009", assetName: "Transformer T1", equipmentType: "Transformers", category: "Electrical", task: "Oil sampling and DGA", status: "Fail", score: 30, findings: "DGA shows elevated acetylene (45 ppm) indicating arcing. Oil moisture content 28 ppm (limit: 20 ppm).", action: "Immediate de-energize for inspection. Contact transformer specialist.", recommendation: "Internal inspection required. Possible winding damage.", remarks: "Vendor: PowerTech Diagnostics required", date: "2025-08-17", month: "August 2025", plantArea: "HV Yard" },
  { id: 7, facilityId: "KAY-STP", inspector: "R. Reyes", inspectionDate: "2025-08-18", assetTag: "VS-KAY-003", assetName: "Sluice Valve 12in", equipmentType: "Valves", category: "Mechanical", task: "Check valve operation", status: "Pass", score: 88, findings: "Valve operates smoothly. No leaks. Position indicator accurate.", action: "Continue normal operation.", recommendation: "Next inspection in 12 months.", remarks: "", date: "2025-08-18", month: "August 2025", plantArea: "Distribution" },
  { id: 8, facilityId: "AGL-STP", inspector: "J. Cruz", inspectionDate: "2025-08-19", assetTag: "UV-AGL-015", assetName: "UV Disinfection Bank 2", equipmentType: "UV / Disinfection", category: "Treatment", task: "Check UV intensity", status: "Warning", score: 65, findings: "UV intensity 72% of design (spec: >80%). 3 of 24 lamps showing reduced output.", action: "Replace underperforming lamps. Clean quartz sleeves.", recommendation: "Replace all lamps if batch >2 years old.", remarks: "", date: "2025-08-19", month: "August 2025", plantArea: "Disinfection" },
  { id: 9, facilityId: "EBY-STP", inspector: "L. Garcia", inspectionDate: "2025-08-20", assetTag: "GN-EBY-008", assetName: "Emergency Generator", equipmentType: "Generators", category: "Electrical", task: "Test auto-start sequence", status: "Fail", score: 25, findings: "Auto-start failed during test. Battery voltage low (11.2V vs 12.6V). Starter motor cranking slow.", action: "Replace battery. Inspect starter motor.", recommendation: "Replace battery immediately. Check charging system.", remarks: "", date: "2025-08-20", month: "August 2025", plantArea: "Backup Power" },
  { id: 10, facilityId: "HTT-STP", inspector: "M. Santos", inspectionDate: "2025-08-21", assetTag: "OD-HTT-020", assetName: "Odor Control Scrubber", equipmentType: "Odor Control", category: "Environmental", task: "Check chemical levels", status: "Pass", score: 95, findings: "All chemical levels optimal. Scrubber efficiency 98%. No bypass odors detected.", action: "Continue normal operation.", recommendation: "Maintain current chemical dosing schedule.", remarks: "", date: "2025-08-21", month: "August 2025", plantArea: "Environmental" },
  { id: 11, facilityId: "KAY-STP", inspector: "R. Reyes", inspectionDate: "2025-08-22", assetTag: "CL-KAY-011", assetName: "Clarifier Drive Unit", equipmentType: "Clarifiers", category: "Mechanical", task: "Check drive torque", status: "Warning", score: 70, findings: "Drive torque 15% above baseline. Gearbox oil darkened. Chain wear visible.", action: "Change gearbox oil. Inspect chain drive.", recommendation: "Replace chain if wear exceeds 10%.", remarks: "", date: "2025-08-22", month: "August 2025", plantArea: "Secondary Treatment" },
  { id: 12, facilityId: "AGL-STP", inspector: "J. Cruz", inspectionDate: "2025-08-23", assetTag: "CD-AGL-019", assetName: "Chemical Dosing Pump B", equipmentType: "Chemical Dosing", category: "Treatment", task: "Verify dosing rate", status: "Pass", score: 90, findings: "Dosing rate accurate within 2% of setpoint. Diaphragm condition good.", action: "Continue normal operation.", recommendation: "Replace diaphragm at next PM.", remarks: "", date: "2025-08-23", month: "August 2025", plantArea: "Chemical Feed" },
];

export default function OperatorDrivenMaintenance() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [equipFilter, setEquipFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [selectedFinding, setSelectedFinding] = useState<InspectionRecord | null>(null);
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const [detailView, setDetailView] = useState<"table" | "ai">("table");
  const [dashboardView, setDashboardView] = useState<"findings" | "all">("findings");
  const [usingMock, setUsingMock] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const utils = trpc.useUtils();

  // Fetch data — MUST be before any hook that references isLoading
  const { data: apiResponse, isLoading, isError, error: queryError } = trpc.mw.listInspections.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Timeout fallback — depends on isLoading which is now declared above
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => {
      console.log("[ODM] API load timed out after 8s, enabling demo mode");
      setLoadTimedOut(true);
      setUsingMock(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const rawRecords: InspectionRecord[] = useMemo(() => {
    if (isError) {
      console.error("[ODM] API error:", queryError?.message);
      setUsingMock(true);
      return MOCK_RECORDS;
    }
    if (loadTimedOut && (!apiResponse || !Array.isArray((apiResponse as any)?.rows || apiResponse))) {
      console.log("[ODM] Load timed out, using demo data");
      return MOCK_RECORDS;
    }
    if (!apiResponse) {
      return []; // Still loading normally
    }
    const rows = (apiResponse as any)?.rows || apiResponse;
    if (!Array.isArray(rows)) {
      console.error("[ODM] API response is not an array:", typeof rows);
      setUsingMock(true);
      return MOCK_RECORDS;
    }
    if (rows.length === 0) {
      // API succeeded but DB is empty — this is a real empty state, NOT an error
      console.log("[ODM] API returned 0 records (database empty)");
      return [];
    }
    console.log("[ODM] API returned", rows.length, "real records");
    setUsingMock(false);
    return rows.map(mapRecord);
  }, [apiResponse, isError, queryError, loadTimedOut]);

  const handleRetry = useCallback(() => {
    setUsingMock(false);
    utils.mw.listInspections.invalidate();
  }, [utils]);

  // Findings-only dataset (excludes blank/null/"No finding recorded")
  const findingsOnly = useMemo(() => {
    return rawRecords.filter(r => {
      const f = String(r.findings || "").trim();
      return f && f !== "No finding recorded" && f !== "-" && f !== "N/A" && f !== "n/a" && f !== "None" && f !== "none" && f !== "Nil" && f !== "nil" && f !== "Null" && f !== "null" && f !== "undefined" && f !== "—";
    });
  }, [rawRecords]);

  // Active dataset based on dashboard view
  const activeDataset = useMemo(() => {
    return dashboardView === "findings" ? findingsOnly : rawRecords;
  }, [dashboardView, findingsOnly, rawRecords]);

  // Filters applied to active dataset
  const filtered = useMemo(() => {
    let d = activeDataset;
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
  }, [activeDataset, search, statusFilter, equipFilter, areaFilter]);

  // Unique filter values
  const statuses = useMemo(() => [...new Set(rawRecords.map(r => r.status).filter(Boolean))].sort(), [rawRecords]);
  const equipTypes = useMemo(() => [...new Set(rawRecords.map(r => r.equipmentType).filter(Boolean))].sort(), [rawRecords]);
  const areas = useMemo(() => [...new Set(rawRecords.map(r => r.plantArea).filter(Boolean))].sort(), [rawRecords]);

  // Stats — findings-only for header counters (old dashboard behavior)
  const stats = useMemo(() => {
    const base = dashboardView === "findings" ? findingsOnly : rawRecords;
    const critical = base.filter(r => classifySeverity(r) === "critical").length;
    const warning = base.filter(r => classifySeverity(r) === "warning").length;
    const info = base.filter(r => classifySeverity(r) === "info").length;
    const pass = base.filter(r => r.status === "Pass").length;
    const fail = base.filter(r => r.status === "Fail").length;
    return { total: base.length, critical, warning, info, pass, fail, findingsCount: findingsOnly.length, allCount: rawRecords.length };
  }, [findingsOnly, rawRecords, dashboardView]);

  // AI data context — always uses findings-only (never all records)
  const aiData = useMemo(() => {
    if (!selectedFinding) return findingsOnly;
    return [selectedFinding];
  }, [findingsOnly, selectedFinding]);

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {banner && <div className="flex-shrink-0 px-4 pt-3"><Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} /></div>}
      {usingMock && (
        <div className="flex-shrink-0 px-4 pt-2">
          <Banner type="info" message="📡 Showing offline sample data. API connection unavailable — retry or continue working with sample records." onDismiss={() => setUsingMock(false)} />
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
              <span className="ml-auto">
                <strong>{filtered.length}</strong> shown
                {dashboardView === "findings" && stats.allCount > 0 && (
                  <span className="text-gray-400 ml-1">of {stats.findingsCount} findings ({stats.allCount} total)</span>
                )}
              </span>
            </div>
            {/* View switcher */}
            <div className="flex gap-0 bg-gray-100 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setDashboardView("findings")}
                className={`flex-1 px-2 py-1 rounded-md text-xs font-semibold transition ${dashboardView === "findings" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                🔍 Findings Dashboard
              </button>
              <button
                type="button"
                onClick={() => setDashboardView("all")}
                className={`flex-1 px-2 py-1 rounded-md text-xs font-semibold transition ${dashboardView === "all" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                📋 Inspection Records ({stats.allCount})
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && rawRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-sm">
                <div className="text-2xl mb-2">⏳</div>
                <div>Loading inspection records...</div>
                {isError && (
                  <button type="button" onClick={handleRetry} className="mt-3 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700">
                    🔄 Retry
                  </button>
                )}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">{dashboardView === "findings" ? "🔍" : "📋"}</div>
                <div className="text-sm font-semibold text-gray-600">
                  {dashboardView === "findings" ? "No findings match" : "No records match"}
                </div>
                {dashboardView === "findings" && stats.findingsCount > 0 && (
                  <div className="text-xs mt-1">{stats.findingsCount} findings total — try adjusting filters</div>
                )}
                {dashboardView === "findings" && stats.findingsCount === 0 && stats.allCount > 0 && (
                  <div className="text-xs mt-1 text-gray-500">No findings in {stats.allCount} inspection records</div>
                )}
                {usingMock && <div className="text-xs text-amber-500 mt-1">📡 Using offline data (API unavailable)</div>}
              </div>
            ) : (
              filtered.map(r => {
                const sev = classifySeverity(r);
                const isSelected = selectedFinding?.id === r.id;
                return (
                  <div key={r.id}
                    onClick={() => { setSelectedFinding(r); setDetailView("ai"); }}
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
            <button type="button" onClick={() => setDetailView("ai")} className={`px-3 py-1.5 rounded text-xs font-semibold ${detailView === "ai" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              🤖 AI Analysis
            </button>
            <button type="button" onClick={() => setDetailView("table")} className={`px-3 py-1.5 rounded text-xs font-semibold ${detailView === "table" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              📋 Raw Data
            </button>
            {selectedFinding && (
              <span className="ml-auto text-xs text-gray-400">{selectedFinding.assetTag}</span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {detailView === "ai" ? (
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
        contextType="finding"
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
