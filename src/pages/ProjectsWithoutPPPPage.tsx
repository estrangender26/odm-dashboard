import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";
import { MAX_UPLOAD_ERROR_MESSAGE, MAX_UPLOAD_FILE_SIZE_BYTES } from "@contracts/upload-limits";
import { shouldUseDirectStorage, storageFileUrl, uploadFileDirect } from "@/lib/direct-storage-upload";
import { PROJECT_PHASES, LATEST_MILESTONES, SUB_PHASES, type ProjectSubmissionForm, type ProjectWithoutPPP, type ProjectFileAttachment } from "@/modules/projects-without-ppp/types";
import { MODULE_TITLE } from "@/modules/projects-without-ppp/constants";

// ── Types ──
type ModalMode = "create" | "edit" | "delete" | "upload" | null;

// ── UI Helpers ──
function Banner({ type, message, onDismiss }: { type: "error" | "success" | "info"; message: string; onDismiss?: () => void }) {
  const s: Record<string, string> = { error: "bg-red-50 border-red-200 text-red-800", success: "bg-green-50 border-green-200 text-green-800", info: "bg-blue-50 border-blue-200 text-blue-800" };
  return (
    <div className={`mb-3 px-4 py-3 border rounded-lg text-sm flex items-center gap-2 ${s[type]}`}>
      <span>{type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️"}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && <button type="button" onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">×</button>}
    </div>
  );
}

function ProgressOverlay({ visible, label, progress }: { visible: boolean; label: string; progress?: number }) {
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
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: progress !== undefined ? `${Math.min(100, Math.max(5, progress))}%` : "60%", background: "linear-gradient(90deg, #2563EB 0%, #3B82F6 50%, #2563EB 100%)" }} />
        </div>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(13,33,55,0.55)", backdropFilter: "blur(2px)" }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-bold text-gray-800">{title}</h3>
          <button type="button" onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-600">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const EMPTY_FORM: ProjectSubmissionForm = {
  trackingId: "", psCode: "", codingMask: "", projectPhase: "Construction", latestMilestone: "Ongoing", subPhase: "North",
  pmHeadline: "", workPackage: "", contractPackage: "", contractor: "", majorProjectTag: "",
  constructionManager: "", projectManager: "", withLSPs: false, amdGridHead: "",
};

export default function ProjectsWithoutPPPPage() {
  const [banner, setBanner] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectWithoutPPP | null>(null);
  const [modalForm, setModalForm] = useState<ProjectSubmissionForm>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: listData, isLoading } = trpc.projectsWithoutPPP.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const allProjects = useMemo(() => (listData?.items || []) as ProjectWithoutPPP[], [listData]);

  const createMut = trpc.projectsWithoutPPP.create.useMutation({
    onSuccess: () => { setModalMode(null); setBanner({ type: "success", message: "Project submitted successfully" }); void utils.projectsWithoutPPP.list.invalidate(); },
    onError: (e) => setBanner({ type: "error", message: e.message || "Failed to submit project" }),
  });

  const updateMut = trpc.projectsWithoutPPP.update.useMutation({
    onSuccess: (data) => {
      setModalMode(null);
      setSelectedProject(prev => prev?.id === data.id ? ({ ...prev, ...data } as ProjectWithoutPPP) : prev);
      setBanner({ type: "success", message: "Project updated successfully" });
      void utils.projectsWithoutPPP.list.invalidate();
    },
    onError: (e) => setBanner({ type: "error", message: e.message || "Failed to update project" }),
  });

  const attachFileMut = trpc.projectsWithoutPPP.attachFileRecord.useMutation({
    onSuccess: (_data, variables) => {
      setUploadProgress(100);
      setTimeout(() => setIsUploading(false), 500);
      setBanner({ type: "success", message: "Attachment recorded" });
      void utils.projectsWithoutPPP.list.invalidate();
      void utils.projectsWithoutPPP.get.invalidate({ id: variables.projectId });
    },
    onError: () => { setIsUploading(false); setBanner({ type: "error", message: "Failed to record attachment" }); },
  });

  const deleteMut = trpc.projectsWithoutPPP.delete.useMutation({
    onSuccess: () => {
      setModalMode(null);
      setSelectedProject(null);
      setBanner({ type: "success", message: "Project deleted successfully" });
      void utils.projectsWithoutPPP.list.invalidate();
    },
    onError: (e) => setBanner({ type: "error", message: e.message || "Failed to delete project" }),
  });

  const openCreate = useCallback(() => { setModalForm(EMPTY_FORM); setModalMode("create"); }, []);
  const openEdit = useCallback(() => {
    if (!selectedProject) return;
    setModalForm({
      trackingId: selectedProject.trackingId, psCode: selectedProject.psCode, codingMask: selectedProject.codingMask || "",
      projectPhase: selectedProject.projectPhase, latestMilestone: selectedProject.latestMilestone || "Ongoing",
      subPhase: selectedProject.subPhase || "North", pmHeadline: selectedProject.pmHeadline || "",
      workPackage: selectedProject.workPackage || "", contractPackage: selectedProject.contractPackage || "",
      contractor: selectedProject.contractor || "", majorProjectTag: selectedProject.majorProjectTag || "",
      constructionManager: selectedProject.constructionManager || "", projectManager: selectedProject.projectManager || "",
      withLSPs: selectedProject.withLSPs, amdGridHead: selectedProject.amdGridHead || "",
    });
    setModalMode("edit");
  }, [selectedProject]);

  const submitForm = useCallback(() => {
    if (!modalForm.trackingId.trim() || !modalForm.psCode.trim()) {
      setBanner({ type: "error", message: "Tracking ID and PS Code are required" });
      return;
    }
    const payload = {
      trackingId: modalForm.trackingId.trim(), psCode: modalForm.psCode.trim(), codingMask: modalForm.codingMask.trim() || undefined,
      projectPhase: modalForm.projectPhase, latestMilestone: modalForm.latestMilestone || undefined,
      subPhase: modalForm.subPhase || undefined, pmHeadline: modalForm.pmHeadline.trim() || undefined,
      workPackage: modalForm.workPackage.trim() || undefined, contractPackage: modalForm.contractPackage.trim() || undefined,
      contractor: modalForm.contractor.trim() || undefined, majorProjectTag: modalForm.majorProjectTag.trim() || undefined,
      constructionManager: modalForm.constructionManager.trim() || undefined, projectManager: modalForm.projectManager.trim() || undefined,
      withLSPs: modalForm.withLSPs, amdGridHead: modalForm.amdGridHead.trim() || undefined,
    };
    if (modalMode === "create") createMut.mutate(payload);
    else if (modalMode === "edit" && selectedProject) updateMut.mutate({ id: selectedProject.id, ...payload });
  }, [modalForm, modalMode, selectedProject, createMut, updateMut]);

  const handleUpload = useCallback(async (file: File) => {
    if (!selectedProject) { setBanner({ type: "error", message: "Select a project first" }); return; }
    if (isUploading) { setBanner({ type: "error", message: "Please wait for the current upload to finish." }); return; }
    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) { setBanner({ type: "error", message: MAX_UPLOAD_ERROR_MESSAGE }); return; }
    setIsUploading(true); setUploadProgress(0); setUploadLabel(`Reading "${file.name}"...`);
    let useStorage: boolean;
    try {
      useStorage = await shouldUseDirectStorage("projects_without_ppp");
    } catch (error) {
      setIsUploading(false); setUploadProgress(0);
      setBanner({ type: "error", message: error instanceof Error ? error.message : "Unable to determine the upload route." });
      return;
    }
    if (useStorage) {
      try {
        const result = await uploadFileDirect({
          module: "projects_without_ppp",
          file,
          target: { projectId: selectedProject.id },
          onProgress: (pct) => { setUploadProgress(Math.max(5, pct)); setUploadLabel(`Uploading "${file.name}" directly to Storage... ${pct}%`); },
        });
        await utils.projectsWithoutPPP.list.invalidate();
        await utils.projectsWithoutPPP.get.invalidate({ id: selectedProject.id });
        setUploadProgress(100);
        setBanner({ type: "success", message: `Attachment "${file.name}" uploaded` });
        setTimeout(() => setIsUploading(false), 500);
        void result;
      } catch (error) {
        setIsUploading(false);
        setBanner({ type: "error", message: error instanceof Error ? error.message : "Storage upload failed." });
      }
      return;
    }
    // Fallback base64 upload
    const reader = new FileReader();
    reader.onprogress = (ev) => { if (ev.lengthComputable) { setUploadProgress(Math.round((ev.loaded / ev.total) * 50)); setUploadLabel(`Reading "${file.name}"... ${Math.round((ev.loaded / ev.total) * 100)}%`); } };
    reader.onloadstart = () => setUploadProgress(5);
    reader.onload = () => {
      setUploadProgress(60); setUploadLabel(`Saving "${file.name}"...`);
      const dataUrl = reader.result as string;
      const commaIndex = dataUrl.indexOf(",");
      const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "";
      if (!base64 || base64.length < 100) { setIsUploading(false); setBanner({ type: "error", message: "Invalid file" }); return; }
      attachFileMut.mutate({
        projectId: selectedProject.id,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        fileData: base64,
      });
    };
    reader.onerror = () => { setIsUploading(false); setBanner({ type: "error", message: `Failed to read "${file.name}"` }); };
    reader.readAsDataURL(file);
  }, [isUploading, selectedProject, utils.projectsWithoutPPP.list, utils.projectsWithoutPPP.get, attachFileMut]);

  const handleDownload = useCallback((fileId: number, fileName: string) => {
    window.open(storageFileUrl("project_without_ppp_files", fileId, "download"), "_blank", "noopener,noreferrer");
    setBanner({ type: "success", message: `Download started for ${fileName}` });
  }, []);

  const filteredProjects = useMemo(() => {
    const q = search.toLowerCase();
    return allProjects.filter((p) => {
      const matchesSearch = !q || [p.trackingId, p.psCode, p.codingMask, p.workPackage, p.contractor, p.majorProjectTag, p.projectManager]
        .some((v) => (v || "").toLowerCase().includes(q));
      const matchesPhase = !phaseFilter || p.projectPhase === phaseFilter;
      return matchesSearch && matchesPhase;
    });
  }, [allProjects, search, phaseFilter]);

  useEffect(() => {
    if (banner) {
      const t = setTimeout(() => setBanner(null), 5000);
      return () => clearTimeout(t);
    }
  }, [banner]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F8FAFC" }}>
      {/* Header */}
      <header style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)", color: "#fff", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 12px rgba(22,50,79,0.10)" }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, textDecoration: "none", color: "inherit" }}>
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-[15px] font-bold truncate" style={{ letterSpacing: "-0.2px", lineHeight: 1.2 }}>{MODULE_TITLE}</h1>
              <span className="text-[10px] block mt-0.5 opacity-55" style={{ textTransform: "uppercase", letterSpacing: "1.5px" }}>Masterdata Portal</span>
            </div>
          </Link>
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <Link to="/" className="text-xs font-medium px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-white hover:bg-white/20 transition">Home</Link>
            <Link to="/help" className="text-xs font-medium px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-white hover:bg-white/20 transition">Help</Link>
          </div>
        </div>
      </header>

      <main className="flex-1" style={{ maxWidth: 1440, margin: "0 auto", padding: "24px 16px 40px" }}>
        {banner && <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />}

        <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-140px)]">
          {/* LEFT PANEL */}
          <div className="w-full lg:w-[420px] flex flex-col border border-gray-200 rounded-xl bg-white shadow-sm">
            <div className="flex-shrink-0 p-3 border-b border-gray-200 space-y-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tracking ID, PS code, work package..."
                  className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
                {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>}
              </div>
              <div className="flex gap-2">
                <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                  <option value="">All Phases</option>
                  {PROJECT_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <button onClick={openCreate} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 flex items-center gap-1">
                  ➕ Submit Project
                </button>
              </div>
              <div className="flex gap-3 text-xs text-gray-500">
                <span><strong className="text-gray-800">{allProjects.length}</strong> total</span>
                <span className="ml-auto"><strong className="text-gray-800">{filteredProjects.length}</strong> shown</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="text-center py-16 text-gray-400">
                  <div className="relative w-8 h-8 mx-auto mb-3">
                    <div className="absolute inset-0 rounded-full border-2 border-gray-200" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-600 animate-spin" />
                  </div>
                  <div className="text-sm font-semibold">Loading projects...</div>
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <div className="text-3xl mb-2">📂</div>
                  <div className="text-sm font-semibold text-gray-600">{allProjects.length === 0 ? "No projects submitted" : "No projects found"}</div>
                  <div className="text-xs mt-1">{allProjects.length === 0 ? "Click 'Submit Project' to add masterdata" : "Try adjusting filters"}</div>
                </div>
              ) : (
                filteredProjects.map((p) => {
                  const isSelected = selectedProject?.id === p.id;
                  return (
                    <div key={p.id} onClick={() => setSelectedProject(p)}
                      className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition hover:bg-gray-50 ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[0.65rem] font-semibold text-gray-400 uppercase tracking-wide">{p.trackingId} · {p.psCode}</div>
                          <div className={`text-sm font-semibold mt-0.5 truncate ${isSelected ? "text-blue-800" : "text-gray-800"}`}>{p.workPackage || "No work package"}</div>
                        </div>
                        <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0" style={{ background: "#DBEAFE", color: "#005BAC" }}>{p.projectPhase}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                        <span>{p.contractor}</span>
                        <span>·</span>
                        <span>{p.majorProjectTag}</span>
                        {p.withLSPs && <span className="ml-auto text-[0.65rem] px-1.5 py-0.5 rounded bg-green-100 text-green-700">LS/PS</span>}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div className="hidden lg:flex flex-1 flex-col border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
            {selectedProject ? (
              <ProjectDetail
                project={selectedProject}
                onEdit={openEdit}
                onDelete={() => setModalMode("delete")}
                onUpload={() => fileInputRef.current?.click()}
                onDownload={handleDownload}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-md">
                  <div className="text-6xl mb-4 opacity-30">🏗️</div>
                  <h3 className="text-lg font-semibold text-gray-400 mb-2">Select a Project</h3>
                  <p className="text-sm text-gray-400">Click on any project to view details and attachments.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <input ref={fileInputRef} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />

      <ProgressOverlay visible={isUploading} label={uploadLabel} progress={uploadProgress} />

      {/* Create / Edit Modal */}
      {(modalMode === "create" || modalMode === "edit") && (
        <Modal title={modalMode === "create" ? "➕ Submit Project" : "✏️ Edit Project"} onClose={() => setModalMode(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Tracking ID *</label>
                <input value={modalForm.trackingId} onChange={(e) => setModalForm(p => ({ ...p, trackingId: e.target.value }))}
                  placeholder="e.g. RR18-0616-01-01" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">PS Code *</label>
                <input value={modalForm.psCode} onChange={(e) => setModalForm(p => ({ ...p, psCode: e.target.value }))}
                  placeholder="e.g. 2024-0348" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Coding Mask</label>
                <input value={modalForm.codingMask} onChange={(e) => setModalForm(p => ({ ...p, codingMask: e.target.value }))}
                  placeholder="A1-ES-20240348" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Project Phase *</label>
                <select value={modalForm.projectPhase} onChange={(e) => setModalForm(p => ({ ...p, projectPhase: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white">
                  {PROJECT_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Latest Milestone</label>
                <select value={modalForm.latestMilestone} onChange={(e) => setModalForm(p => ({ ...p, latestMilestone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white">
                  {LATEST_MILESTONES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sub Phase</label>
                <select value={modalForm.subPhase} onChange={(e) => setModalForm(p => ({ ...p, subPhase: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white">
                  {SUB_PHASES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">PM Headline</label>
              <input value={modalForm.pmHeadline} onChange={(e) => setModalForm(p => ({ ...p, pmHeadline: e.target.value }))}
                placeholder="e.g. North" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Work Package</label>
              <input value={modalForm.workPackage} onChange={(e) => setModalForm(p => ({ ...p, workPackage: e.target.value }))}
                placeholder="Work package description" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Contract Package</label>
              <input value={modalForm.contractPackage} onChange={(e) => setModalForm(p => ({ ...p, contractPackage: e.target.value }))}
                placeholder="Contract package details" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Contractor</label>
                <input value={modalForm.contractor} onChange={(e) => setModalForm(p => ({ ...p, contractor: e.target.value }))}
                  placeholder="Contractor name" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Major Project Tag</label>
                <input value={modalForm.majorProjectTag} onChange={(e) => setModalForm(p => ({ ...p, majorProjectTag: e.target.value }))}
                  placeholder="e.g. HINULUGANG TAKTAK" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Construction Manager</label>
                <input value={modalForm.constructionManager} onChange={(e) => setModalForm(p => ({ ...p, constructionManager: e.target.value }))}
                  placeholder="CM name" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Project Manager</label>
                <input value={modalForm.projectManager} onChange={(e) => setModalForm(p => ({ ...p, projectManager: e.target.value }))}
                  placeholder="PM name" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="withLSPs" checked={modalForm.withLSPs} onChange={(e) => setModalForm(p => ({ ...p, withLSPs: e.target.checked }))} />
                <label htmlFor="withLSPs" className="text-xs font-semibold text-gray-600">With LS/PS</label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">AMD Grid Head</label>
                <input value={modalForm.amdGridHead} onChange={(e) => setModalForm(p => ({ ...p, amdGridHead: e.target.value }))}
                  placeholder="AMD Grid Head" className="w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={submitForm}
                disabled={createMut.isPending || updateMut.isPending || !modalForm.trackingId.trim() || !modalForm.psCode.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {createMut.isPending || updateMut.isPending ? "Saving..." : modalMode === "create" ? "Submit Project" : "Update Project"}
              </button>
              <button onClick={() => setModalMode(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {modalMode === "delete" && selectedProject && (
        <Modal title="🗑️ Delete Project" onClose={() => setModalMode(null)}>
          <p className="text-sm text-gray-700 mb-4">
            Are you sure you want to delete <strong>{selectedProject.trackingId} — {selectedProject.workPackage || "this project"}</strong>?<br />
            This action cannot be undone.
          </p>
          <div className="flex gap-2">
            <button onClick={() => deleteMut.mutate({ id: selectedProject.id })}
              disabled={deleteMut.isPending}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
              {deleteMut.isPending ? "Deleting..." : "Delete"}
            </button>
            <button onClick={() => setModalMode(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">Cancel</button>
          </div>
        </Modal>
      )}

      <AIAssistant contextType="help"
        metadata={{ sourceModule: MODULE_TITLE, sourceRecordId: "projects-without-ppp", sourceRecordLabel: "Projects without PPP Portal" }}
        title="Projects AI" quickQuestions={[
          "What fields are required to submit a project?",
          "How do I upload attachments?",
          "Which projects have LS/PS?",
        ]} position="bottom-right" />
    </div>
  );
}

function ProjectDetail({ project, onEdit, onDelete, onUpload, onDownload }: {
  project: ProjectWithoutPPP;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: () => void;
  onDownload: (id: number, name: string) => void;
}) {
  const { data: detail } = trpc.projectsWithoutPPP.get.useQuery({ id: project.id }, { staleTime: 30_000 });
  const files: ProjectFileAttachment[] = (detail as { files?: ProjectFileAttachment[] } | null | undefined)?.files || [];

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{project.trackingId} · {project.psCode}</div>
            <h2 className="text-xl font-bold text-gray-800 mt-1">{project.workPackage || "No work package"}</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 flex-wrap">
              <span><strong>Phase:</strong> {project.projectPhase}</span>
              <span><strong>Milestone:</strong> {project.latestMilestone || "—"}</span>
              <span><strong>Sub Phase:</strong> {project.subPhase || "—"}</span>
              {project.withLSPs && <span className="text-[0.65rem] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">With LS/PS</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onEdit} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-semibold hover:bg-blue-100 flex items-center gap-1">✏️ Edit</button>
          <button onClick={onDelete} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100 flex items-center gap-1">🗑️ Delete</button>
          <button onClick={onUpload} className="px-3 py-1.5 bg-green-50 text-green-600 rounded text-xs font-semibold hover:bg-green-100 flex items-center gap-1">📎 Attach File</button>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6">
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">Project Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Detail label="Coding Mask" value={project.codingMask} />
            <Detail label="PM Headline" value={project.pmHeadline} />
            <Detail label="Contract Package" value={project.contractPackage} />
            <Detail label="Contractor" value={project.contractor} />
            <Detail label="Major Project Tag" value={project.majorProjectTag} />
            <Detail label="Construction Manager" value={project.constructionManager} />
            <Detail label="Project Manager" value={project.projectManager} />
            <Detail label="AMD Grid Head" value={project.amdGridHead} />
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-800">Attachments</h3>
            <button onClick={onUpload} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700">➕ Upload File</button>
          </div>
          {files.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
              <div className="text-2xl mb-2">📎</div>
              <p className="text-sm text-gray-500">No attachments yet. Upload files to Supabase storage.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <div key={file.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{file.fileName}</div>
                    <div className="text-xs text-gray-500">{formatFileSize(file.fileSize || file.storageSize)} · {file.storageBucket ? "Supabase Storage" : "Legacy"}</div>
                  </div>
                  <button onClick={() => onDownload(file.id, file.fileName)}
                    className="px-3 py-1.5 bg-green-50 text-green-600 rounded text-xs font-semibold hover:bg-green-100 flex-shrink-0"
                  >
                    ⬇️ Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="font-medium text-gray-800">{value || "—"}</div>
    </div>
  );
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}