import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_UPLOAD_ERROR_MESSAGE, MAX_UPLOAD_FILE_SIZE_BYTES } from "@contracts/upload-limits";
import { shouldUseDirectStorage, uploadFileDirect } from "@/lib/direct-storage-upload";
import {
  LS_PS_LABELS,
  MODULE_TITLE,
  STORAGE_MODULE,
  SUBMISSION_STATUS_LABELS,
  formatDateTime,
  formatFileSize,
} from "@/modules/projects-without-ppp/constants";
import { validateMasterdataFile } from "@/modules/projects-without-ppp/validation";
import type {
  ProjectWithoutPPPRow,
  ProjectWithoutPPPDetail,
} from "@/modules/projects-without-ppp/types";

function StatusBadge({ status }: { status: "submitted" | "not_submitted" }) {
  const submitted = status === "submitted";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap"
      style={{
        background: submitted ? "#D1FAE5" : "#FEF3C7",
        color: submitted ? "#047857" : "#B45309",
        border: `1px solid ${submitted ? "#A7F3D0" : "#FDE68A"}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: submitted ? "#059669" : "#D97706" }}
      />
      {SUBMISSION_STATUS_LABELS[status]}
    </span>
  );
}

function KpiCard({ label, value, sub, tone }: {
  label: string;
  value: string | number;
  sub?: string;
  tone: "navy" | "green" | "amber" | "blue";
}) {
  const tones: Record<string, { bg: string; text: string; bar: string }> = {
    navy: { bg: "rgba(11,29,68,0.06)", text: "#0B1D44", bar: "#16324F" },
    green: { bg: "rgba(5,150,105,0.08)", text: "#047857", bar: "#059669" },
    amber: { bg: "rgba(217,119,6,0.08)", text: "#B45309", bar: "#D97706" },
    blue: { bg: "rgba(0,91,172,0.08)", text: "#005BAC", bar: "#005BAC" },
  };
  const t = tones[tone];
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-1 min-w-0"
      style={{ background: "#FFFFFF", borderColor: "#D6DFE8", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B7D] truncate">{label}</span>
      <span className="text-2xl font-extrabold leading-none" style={{ color: t.text }}>{value}</span>
      {sub ? <span className="text-[11px] text-[#8BA3B8]">{sub}</span> : <span className="text-[11px] text-transparent select-none">·</span>}
      <div className="mt-1 h-1 rounded-full" style={{ background: t.bg }}>
        <div className="h-1 rounded-full" style={{ width: "100%", background: t.bar }} />
      </div>
    </div>
  );
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
      {onDismiss && <button type="button" onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">×</button>}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 min-w-[130px]">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8BA3B8]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs border rounded-lg px-2 py-1.5 bg-white text-[#0B1D44] focus:outline-none focus:ring-1 focus:ring-[#005BAC]"
        style={{ borderColor: "#D6DFE8" }}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

const TABLE_HEADERS: { key: string; label: string; minWidth: number }[] = [
  { key: "trackingId", label: "Tracking ID", minWidth: 140 },
  { key: "psCode", label: "PS Code", minWidth: 100 },
  { key: "projectName", label: "Project Name", minWidth: 220 },
  { key: "workPackage", label: "Work Package", minWidth: 200 },
  { key: "projectPhase", label: "Project Phase", minWidth: 110 },
  { key: "contractor", label: "Contractor", minWidth: 200 },
  { key: "majorProjectTag", label: "Major Project Tag", minWidth: 130 },
  { key: "constructionManager", label: "Construction Manager", minWidth: 140 },
  { key: "projectManager", label: "Project Manager", minWidth: 130 },
  { key: "amdGridHead", label: "AMD Grid Head", minWidth: 140 },
  { key: "withLSPs", label: "LS/PS", minWidth: 80 },
  { key: "status", label: "Masterdata Status", minWidth: 130 },
  { key: "fileCount", label: "Files", minWidth: 70 },
  { key: "latestSubmission", label: "Latest Submission", minWidth: 170 },
  { key: "submittedBy", label: "Submitted By", minWidth: 130 },
  { key: "action", label: "Action", minWidth: 130 },
];

export default function ProjectsWithoutPPPMonitoringPage() {
  const [banner, setBanner] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [contractorFilter, setContractorFilter] = useState("");
  const [cmFilter, setCmFilter] = useState("");
  const [pmFilter, setPmFilter] = useState("");
  const [amdFilter, setAmdFilter] = useState("");
  const [lsPsFilter, setLsPsFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: dashboardData, isLoading } = trpc.projectsWithoutPPP.dashboard.useQuery(undefined, {
    staleTime: 15_000,
  });
  const detailQuery = trpc.projectsWithoutPPP.detail.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId !== null && selectedId > 0, staleTime: 10_000 },
  );
  const detail: ProjectWithoutPPPDetail | null = detailQuery.data ?? null;

  const attachMut = trpc.projectsWithoutPPP.attachMasterdataFile.useMutation({
    onSuccess: () => {
      setBanner({ type: "success", message: "Masterdata file uploaded — project marked as Submitted." });
      setIsUploading(false);
      setUploadModalOpen(false);
      setSelectedFile(null);
      setModalError(null);
      setUploadProgress(0);
      setUploadLabel("");
      void utils.projectsWithoutPPP.dashboard.invalidate();
      if (selectedId !== null) void utils.projectsWithoutPPP.detail.invalidate({ id: selectedId });
    },
    onError: (e) => {
      // Keep the modal open and surface the error inside it.
      setIsUploading(false);
      setModalError(e.message || "Failed to record masterdata upload.");
    },
  });

  const allRows: ProjectWithoutPPPRow[] = useMemo(() => dashboardData?.items ?? [], [dashboardData]);
  const filterOptions = dashboardData?.filterOptions;
  const kpis = dashboardData?.kpis;

  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        [r.trackingId, r.psCode, r.projectName, r.workPackage, r.contractor, r.majorProjectTag]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (phaseFilter) rows = rows.filter((r) => r.projectPhase === phaseFilter);
    if (tagFilter) rows = rows.filter((r) => r.majorProjectTag === tagFilter);
    if (contractorFilter) rows = rows.filter((r) => r.contractor === contractorFilter);
    if (cmFilter) rows = rows.filter((r) => r.constructionManager === cmFilter);
    if (pmFilter) rows = rows.filter((r) => r.projectManager === pmFilter);
    if (amdFilter) rows = rows.filter((r) => r.amdGridHead === amdFilter);
    if (lsPsFilter) rows = rows.filter((r) => (r.withLSPs ? "yes" : "no") === lsPsFilter);
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    return rows;
  }, [allRows, search, phaseFilter, tagFilter, contractorFilter, cmFilter, pmFilter, amdFilter, lsPsFilter, statusFilter]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setPhaseFilter("");
    setTagFilter("");
    setContractorFilter("");
    setCmFilter("");
    setPmFilter("");
    setAmdFilter("");
    setLsPsFilter("");
    setStatusFilter("");
  }, []);

  // ── Upload modal handlers ────────────────────────────────────────────────
  const openUploadModal = useCallback(() => {
    // Reopening always starts from a clean form state.
    setSelectedFile(null);
    setModalError(null);
    setUploadProgress(0);
    setUploadLabel("");
    setUploadModalOpen(true);
  }, []);

  // Row-level Upload: select the project as the active project AND open the
  // Upload Masterdata modal immediately — no intermediate detail-panel step.
  const handleRowUpload = useCallback(
    (id: number) => {
      setSelectedId(id);
      setBanner(null);
      openUploadModal();
    },
    [openUploadModal],
  );

  const onUploadModalOpenChange = useCallback(
    (open: boolean) => {
      // While an upload is in progress, user-initiated closes (Escape, overlay
      // click, close button) are ignored so the upload cannot be interrupted.
      if (!open && isUploading) return;
      setUploadModalOpen(open);
      if (!open) {
        setSelectedFile(null);
        setModalError(null);
        setUploadProgress(0);
        setUploadLabel("");
      }
    },
    [isUploading],
  );

  const handleFileSelected = useCallback((file: File | undefined) => {
    if (!file) return;
    // Public upload: no sign-in required. Validation is the same for all users.
    const clientError = validateMasterdataFile(file);
    if (clientError) {
      setModalError(clientError.message);
      return;
    }
    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      setModalError(MAX_UPLOAD_ERROR_MESSAGE);
      return;
    }
    setSelectedFile(file);
    setModalError(null);
  }, []);

  const finishUploadSuccess = useCallback(() => {
    setBanner({ type: "success", message: "Masterdata file uploaded — project marked as Submitted." });
    setIsUploading(false);
    setUploadModalOpen(false);
    setSelectedFile(null);
    setModalError(null);
    setUploadProgress(0);
    setUploadLabel("");
  }, []);

  const startUpload = useCallback(async () => {
    const file = selectedFile;
    if (!file) return;
    if (selectedId === null) return;
    setIsUploading(true);
    setModalError(null);
    setUploadProgress(0);
    setUploadLabel(`Preparing "${file.name}"...`);
    try {
      const useStorage = await shouldUseDirectStorage(STORAGE_MODULE);
      if (useStorage) {
        await uploadFileDirect({
          module: STORAGE_MODULE,
          file,
          target: { projectId: selectedId },
          onProgress: (pct) => {
            setUploadProgress(Math.max(5, pct));
            setUploadLabel(`Uploading "${file.name}" to Storage... ${pct}%`);
          },
        });
        finishUploadSuccess();
        void utils.projectsWithoutPPP.dashboard.invalidate();
        void utils.projectsWithoutPPP.detail.invalidate({ id: selectedId });
        return;
      }

      const reader = new FileReader();
      reader.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setUploadProgress(Math.round((ev.loaded / ev.total) * 50));
          setUploadLabel(`Reading "${file.name}"... ${Math.round((ev.loaded / ev.total) * 100)}%`);
        }
      };
      reader.onload = () => {
        setUploadProgress(60);
        setUploadLabel(`Saving "${file.name}"...`);
        const dataUrl = reader.result as string;
        const commaIndex = dataUrl.indexOf(",");
        const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
        attachMut.mutate({
          projectId: selectedId,
          fileName: file.name,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
          fileData: base64,
        });
      };
      reader.onerror = () => {
        setIsUploading(false);
        setModalError("Failed to read the selected file.");
      };
      reader.readAsDataURL(file);
    } catch (error) {
      setIsUploading(false);
      setModalError(error instanceof Error ? error.message : "Upload failed.");
    }
  }, [selectedFile, selectedId, attachMut, utils, finishUploadSuccess]);

  const submitterLabel = (row: ProjectWithoutPPPRow) =>
    row.latestSubmission?.submittedBy || "—";

  const detailProject = detail?.project ?? null;

  return (
    <div className="min-h-screen" style={{ background: "#F4F6F9", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      {/* Header */}
      <header style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)", color: "#fff", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 12px rgba(22,50,79,0.10)" }}>
        <div style={{ maxWidth: 1500, margin: "0 auto", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, textDecoration: "none", color: "inherit" }}>
            <ProgramsEngineeringLogo size={56} borderRadius={8} />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-[15px] font-bold truncate" style={{ letterSpacing: "-0.2px", lineHeight: 1.2 }}>
                {MODULE_TITLE}
              </h1>
              <span className="text-[10px] block mt-0.5 opacity-55" style={{ textTransform: "uppercase", letterSpacing: "1.5px" }}>
                Monitoring
              </span>
            </div>
          </Link>
          <Link to="/" className="text-xs font-medium px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-white hover:bg-white/20 transition">
            ← Dashboard Suite
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 1500, margin: "0 auto", padding: "20px 16px 48px" }}>
        {banner && <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />}

        {/* KPI cards */}
        <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
          <KpiCard label="Total Projects" value={kpis?.totalProjects ?? 0} sub="authoritative population" tone="navy" />
          <KpiCard label="Submitted" value={kpis?.submitted ?? 0} sub="projects with current masterdata" tone="green" />
          <KpiCard label="Not Submitted" value={kpis?.notSubmitted ?? 0} sub="projects pending masterdata" tone="amber" />
          <KpiCard label="Submission Rate" value={`${kpis?.submissionRate ?? 0}%`} sub="submitted / total × 100" tone="blue" />
          <KpiCard label="Total Files Submitted" value={kpis?.totalFiles ?? 0} sub="current masterdata files" tone="blue" />
          <KpiCard label="Submitted Today" value={kpis?.submittedToday ?? 0} sub={`this week: ${kpis?.submittedThisWeek ?? 0}`} tone="green" />
        </section>

        {/* Filters */}
        <section className="rounded-xl border p-4 mb-4" style={{ background: "#FFFFFF", borderColor: "#D6DFE8" }}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="text-sm font-bold text-[#0B1D44]">Projects without PPP — Masterdata Submittal</h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#5A6B7D]">
                Showing {filteredRows.length} of {allRows.length} projects
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border hover:bg-gray-50 text-[#5A6B7D]"
                style={{ borderColor: "#D6DFE8" }}
              >
                Clear filters
              </button>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <label className="flex flex-col gap-0.5 flex-1 min-w-[220px] max-w-[340px]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8BA3B8]">Search</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tracking ID, PS Code, project name, contractor…"
                className="text-xs border rounded-lg px-2.5 py-1.5 bg-white text-[#0B1D44] focus:outline-none focus:ring-1 focus:ring-[#005BAC]"
                style={{ borderColor: "#D6DFE8" }}
              />
            </label>
            <FilterSelect label="Project Phase" value={phaseFilter} options={filterOptions?.projectPhases ?? []} onChange={setPhaseFilter} />
            <FilterSelect label="Major Project Tag" value={tagFilter} options={filterOptions?.majorProjectTags ?? []} onChange={setTagFilter} />
            <FilterSelect label="Contractor" value={contractorFilter} options={filterOptions?.contractors ?? []} onChange={setContractorFilter} />
            <FilterSelect label="Construction Manager" value={cmFilter} options={filterOptions?.constructionManagers ?? []} onChange={setCmFilter} />
            <FilterSelect label="Project Manager" value={pmFilter} options={filterOptions?.projectManagers ?? []} onChange={setPmFilter} />
            <FilterSelect label="AMD Grid Head" value={amdFilter} options={filterOptions?.amdGridHeads ?? []} onChange={setAmdFilter} />
            <FilterSelect label="LS/PS" value={lsPsFilter} options={["yes", "no"]} onChange={setLsPsFilter} />
            <FilterSelect label="Status" value={statusFilter} options={["submitted", "not_submitted"]} onChange={setStatusFilter} />
          </div>
        </section>

        {/* Monitoring table */}
        <section className="rounded-xl border overflow-hidden" style={{ background: "#FFFFFF", borderColor: "#D6DFE8" }}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  {TABLE_HEADERS.map((h) => (
                    <th
                      key={h.key}
                      className="px-3 py-2.5 font-bold text-[10px] uppercase tracking-wide text-[#5A6B7D] whitespace-nowrap border-b"
                      style={{ minWidth: h.minWidth, borderColor: "#E2E8F0" }}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && allRows.length === 0 ? (
                  <tr>
                    <td colSpan={TABLE_HEADERS.length} className="px-3 py-10 text-center text-sm text-gray-400">
                      Loading authoritative project population…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={TABLE_HEADERS.length} className="px-3 py-10 text-center text-sm text-gray-400">
                      No projects match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      style={{ borderTop: "1px solid #EFF3F7" }}
                    >
                      <td className="px-3 py-2.5 font-bold text-[#005BAC] whitespace-nowrap">{row.trackingId}</td>
                      <td className="px-3 py-2.5 text-[#334155] whitespace-nowrap">{row.psCode}</td>
                      <td className="px-3 py-2.5 text-[#0B1D44] font-semibold min-w-[220px]">{row.projectName || "—"}</td>
                      <td className="px-3 py-2.5 text-[#475569] min-w-[200px]">{row.workPackage || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{
                            background: row.projectPhase === "Construction" ? "#E0E7FF" : "#E6F5EF",
                            color: row.projectPhase === "Construction" ? "#4338CA" : "#047857",
                          }}
                        >
                          {row.projectPhase}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[#475569] min-w-[200px]">{row.contractor || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{row.majorProjectTag || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{row.constructionManager || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{row.projectManager || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{row.amdGridHead || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{row.withLSPs ? LS_PS_LABELS.yes : LS_PS_LABELS.no}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={row.status} /></td>
                      <td className="px-3 py-2.5 text-center font-bold text-[#0B1D44]">{row.fileCount}</td>
                      <td className="px-3 py-2.5 text-[#475569] whitespace-nowrap">
                        {row.latestSubmission ? (
                          <span className="flex flex-col gap-0.5">
                            <span className="font-semibold text-[#0B1D44] max-w-[180px] truncate" title={row.latestSubmission.fileName}>
                              {row.latestSubmission.fileName}
                            </span>
                            <span className="text-[10px] text-[#8BA3B8]">{formatDateTime(row.latestSubmission.submittedAt)}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{submitterLabel(row)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleRowUpload(row.id)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white hover:opacity-90"
                          style={{ background: row.status === "submitted" ? "#005BAC" : "#D97706" }}
                        >
                          Upload
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Upload Masterdata modal — centered dialog in front of the dashboard */}
      <Dialog open={uploadModalOpen} onOpenChange={onUploadModalOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Masterdata</DialogTitle>
            <DialogDescription>
              {detailProject
                ? `${detailProject.projectName ?? "Project"} — ${detailProject.trackingId}`
                : "Select an Excel or PDF masterdata file"}
            </DialogDescription>
          </DialogHeader>

          {/* Selected project context */}
          <div className="flex flex-col gap-1 text-xs text-[#0B1D44]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#5A6B7D]">Project</span>
              <span className="font-semibold text-right">{detailProject?.projectName ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#5A6B7D]">Tracking ID</span>
              <span className="font-semibold">{detailProject?.trackingId ?? "—"}</span>
            </div>
          </div>

          {/* Allowed formats / size */}
          <p className="text-xs text-[#5A6B7D]">
            Allowed formats: Excel (.xlsx, .xls) and PDF (.pdf). Maximum file size: 150 MB.
          </p>

          {/* File picker / drop area */}
          <label
            className="block rounded-xl border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors hover:bg-gray-50"
            style={{ borderColor: selectedFile ? "#059669" : "#CBD5E1", background: "#F8FAFC" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) handleFileSelected(dropped);
            }}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf"
              className="hidden"
              onChange={(e) => {
                handleFileSelected(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {selectedFile ? (
              <span className="flex flex-col items-center gap-1">
                <span className="text-sm font-bold text-[#0B1D44] break-all">{selectedFile.name}</span>
                <span className="text-xs text-[#5A6B7D]">{formatFileSize(selectedFile.size)}</span>
              </span>
            ) : (
              <span className="text-xs text-[#5A6B7D]">
                Click to choose a file or drag &amp; drop it here
              </span>
            )}
          </label>

          {/* Validation / upload error */}
          {modalError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              ⚠️ {modalError}
            </div>
          )}

          {/* Upload progress */}
          {isUploading && (
            <div className="flex flex-col gap-1">
              <div className="text-xs text-[#5A6B7D]">{uploadLabel}</div>
              <div className="h-2 rounded-full overflow-hidden bg-gray-200">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${Math.min(100, Math.max(5, uploadProgress))}%`,
                    background: "linear-gradient(90deg, #2563EB 0%, #3B82F6 50%, #2563EB 100%)",
                  }}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onUploadModalOpenChange(false)}
              disabled={isUploading}
              className="px-4 py-2 rounded-lg text-xs font-bold text-[#5A6B7D] border hover:bg-gray-50 disabled:opacity-50"
              style={{ borderColor: "#D6DFE8" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void startUpload()}
              disabled={!selectedFile || isUploading}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
              style={{ background: "#005BAC" }}
            >
              {isUploading ? "Uploading…" : "Upload"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AIAssistant
        contextType="help"
        metadata={{
          sourceModule: "ProjectsWithoutPPP",
          sourceRecordId: selectedId !== null ? `project-${selectedId}` : "dashboard",
          sourceRecordLabel: "Projects without PPP — Masterdata Submittal Monitoring",
        }}
        title="ODM Dashboard AI"
        quickQuestions={[
          "Which projects have not submitted masterdata yet?",
          "How do I upload masterdata for a project?",
        ]}
      />
    </div>
  );
}
