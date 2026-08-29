import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { storageFileUrl } from "@/lib/direct-storage-upload";
import { SmpLibraryList, type SmpFilters } from "@/modules/smp/SmpLibraryList";
import { SmpDetailPane } from "@/modules/smp/SmpDetailPane";
import { SmpUploadModal } from "@/modules/smp/SmpUploadModal";
import { formatSmpDate } from "@/modules/smp/smpFormat";
import type { SmpDocumentListItem } from "@/modules/smp/types";

function Banner({ type, message, onDismiss }: {
  type: "error" | "success" | "info";
  message: string;
  onDismiss?: () => void;
}) {
  const s: Record<string, string> = {
    error: "bg-red-50 border-red-200 text-red-800",
    success: "bg-green-50 border-green-200 text-green-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };
  return (
    <div className={`mb-3 px-4 py-3 border rounded-lg text-sm flex items-center gap-2 ${s[type]}`}>
      <span>{type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️"}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && <button onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>}
    </div>
  );
}

function ModalShell({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <span className="text-sm font-bold text-gray-800">{title}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const inputClass = "w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white";

export default function SmpDashboard() {
  const { isAuthenticated } = useAuth();

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<SmpFilters>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<"new" | "revision">("new");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteToken, setDeleteToken] = useState<{ recordId: number; deletionToken: string } | null>(null);
  const [banner, setBanner] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);

  const utils = trpc.useUtils();

  const listQuery = trpc.smp.list.useQuery({
    search: search || undefined,
    family: filters.family,
    equipmentType: filters.equipmentType,
    facilityType: filters.facilityType,
    criticality: filters.criticality,
    revision: filters.revision,
    status: filters.status,
  });
  const detailQuery = trpc.smp.get.useQuery(
    { id: selectedId as number, revisionId: selectedRevisionId ?? undefined },
    { enabled: selectedId != null },
  );
  const familiesQuery = trpc.smp.families.useQuery();

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const availableFilters = useMemo(
    () => listQuery.data?.filters ?? { families: [], equipmentTypes: [], facilityTypes: [], criticalities: [], revisions: [], statuses: [] },
    [listQuery.data],
  );

  const selectedDoc = useMemo(
    () => items.find((d) => d.id === selectedId) ?? null,
    [items, selectedId],
  );

  const updateMut = trpc.smp.update.useMutation({
    onSuccess: (data) => {
      utils.smp.list.invalidate();
      utils.smp.get.invalidate();
      setEditOpen(false);
      setBanner({ type: "success", message: `SMP "${data.title}" updated` });
    },
    onError: (e) => setBanner({ type: "error", message: e.message }),
  });

  // Staged deletion: prepare records the ledger + returns a token; confirm
  // performs the storage removal and DB delete. A failed confirm can be
  // retried with the same token (idempotent, recorded progress).
  const deletePrepareMut = trpc.smp.deletePrepare.useMutation({
    onSuccess: (data) => {
      setDeleteToken({ recordId: data.recordId, deletionToken: data.deletionToken });
      deleteConfirmMut.mutate({ recordId: data.recordId, deletionToken: data.deletionToken });
    },
    onError: (e) => setBanner({ type: "error", message: e.message }),
  });
  const deleteConfirmMut = trpc.smp.deleteConfirm.useMutation({
    onSuccess: () => {
      utils.smp.list.invalidate();
      setDeleteOpen(false);
      setDeleteToken(null);
      setSelectedId(null);
      setSelectedRevisionId(null);
      setBanner({ type: "success", message: "SMP deleted" });
    },
    onError: (e) => setBanner({ type: "error", message: e.message }),
  });

  const requestDelete = useCallback(() => {
    if (!selectedId) return;
    if (deleteToken) {
      // Retry the same recorded deletion (storage failures are resumable).
      deleteConfirmMut.mutate({ recordId: deleteToken.recordId, deletionToken: deleteToken.deletionToken });
      return;
    }
    deletePrepareMut.mutate({ id: selectedId });
  }, [selectedId, deleteToken, deletePrepareMut, deleteConfirmMut]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setFilters({});
  }, []);

  const openUpload = useCallback((mode: "new" | "revision") => {
    setUploadMode(mode);
    setUploadOpen(true);
  }, []);

  const handleUploadComplete = useCallback((documentId: number | null) => {
    setUploadOpen(false);
    setSelectedRevisionId(null);
    if (documentId != null) {
      setSelectedId(documentId);
      setBanner({ type: "success", message: "SMP PDF uploaded. The document series now has a current revision." });
    }
  }, []);

  const handleDownload = useCallback(() => {
    const detail = detailQuery.data;
    if (!detail) return;
    const current = detail.revisions.find((r) => r.status === "current") ?? detail.revisions[0];
    if (current?.hasFile) {
      window.open(storageFileUrl("smp_document_revisions", current.id, "download"), "_blank", "noopener,noreferrer");
      return;
    }
    if (detail.document.hasFile) {
      window.open(storageFileUrl("smp_documents", detail.document.id, "download"), "_blank", "noopener,noreferrer");
      return;
    }
    setBanner({ type: "error", message: `No PDF available for ${detail.document.code}.` });
  }, [detailQuery.data]);

  const handleExport = useCallback(() => {
    const rows = items.map((d) => ({
      "Reference No.": d.code,
      "SMP ID": d.smpId || "",
      "Title": d.title,
      "SMP Family": d.smpFamily || "",
      "Asset Name": d.assetName || "",
      "Asset Type": d.assetType || "",
      "Equipment Type": d.equipmentType || "",
      "Facility Type": d.facilityType || "",
      "Criticality": d.criticality || "",
      "Revision": d.revision || "",
      "Effectivity Date": d.effectivityDate ? formatSmpDate(d.effectivityDate) : "",
      "Status": d.hasCurrentRevision ? "current" : (d.status || ""),
      "Last Updated": d.updatedAt ? formatSmpDate(d.updatedAt) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SMP Documents");
    XLSX.writeFile(wb, "SMP_Documents_Export.xlsx");
    setBanner({ type: "success", message: `${rows.length} SMP documents exported.` });
  }, [items]);

  const editInitial = useMemo(() => {
    const d = detailQuery.data?.document;
    if (!d) return null;
    return d;
  }, [detailQuery.data]);

  const [editForm, setEditForm] = useState<{
    code: string; title: string; smpId: string; smpFamily: string; familyId: string; assetName: string;
    assetType: string; equipmentType: string; facilityType: string; criticality: string;
    documentOwner: string; preparedBy: string; reviewedBy: string; approvedBy: string; applicability: string;
  } | null>(null);

  const openEdit = useCallback(() => {
    const d = detailQuery.data?.document;
    if (!d) return;
    setEditForm({
      code: d.code,
      title: d.title,
      smpId: d.smpId || "",
      smpFamily: d.smpFamily || "",
      familyId: d.familyId != null ? String(d.familyId) : "",
      assetName: d.assetName || "",
      assetType: d.assetType || "",
      equipmentType: d.equipmentType || "",
      facilityType: d.facilityType || "",
      criticality: d.criticality || "",
      documentOwner: d.documentOwner || "",
      preparedBy: d.preparedBy || "",
      reviewedBy: d.reviewedBy || "",
      approvedBy: d.approvedBy || "",
      applicability: (d.applicability || []).join(", "),
    });
    setEditOpen(true);
  }, [detailQuery.data]);

  const submitEdit = useCallback(() => {
    if (!editForm || !selectedId) return;
    const familyId = editForm.familyId ? Number(editForm.familyId) : undefined;
    updateMut.mutate({
      id: selectedId,
      code: editForm.code.trim() || undefined,
      title: editForm.title.trim() || undefined,
      smpId: editForm.smpId.trim() || undefined,
      smpFamily: editForm.smpFamily.trim() || undefined,
      familyId,
      assetName: editForm.assetName.trim() || undefined,
      assetType: editForm.assetType.trim() || undefined,
      equipmentType: editForm.equipmentType.trim() || undefined,
      facilityType: editForm.facilityType.trim() || undefined,
      criticality: editForm.criticality.trim() || undefined,
      documentOwner: editForm.documentOwner.trim() || undefined,
      preparedBy: editForm.preparedBy.trim() || undefined,
      reviewedBy: editForm.reviewedBy.trim() || undefined,
      approvedBy: editForm.approvedBy.trim() || undefined,
      applicability: editForm.applicability.split(",").map((t) => t.trim()).filter(Boolean),
    });
  }, [editForm, selectedId, updateMut]);

  const smpAiData = useMemo(
    () => items.map((d) => ({
      ReferenceNumber: d.code,
      SMPId: d.smpId || "",
      Title: d.title,
      Family: d.smpFamily || "",
      EquipmentType: d.equipmentType || "",
      AssetType: d.assetType || "",
      FacilityType: d.facilityType || "",
      Criticality: d.criticality || "",
      Revision: d.revision || "",
      Status: d.hasCurrentRevision ? "current" : (d.status || ""),
      LastUpdated: d.updatedAt || "",
    })),
    [items],
  );

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {banner && (
        <div className="flex-shrink-0 px-4 pt-3">
          <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
        </div>
      )}

      {/* Header */}
      <header className="flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-3 no-underline text-white">
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div>
              <h1 className="text-lg font-bold leading-tight">Standard Maintenance Procedures</h1>
              <p className="text-xs opacity-55" style={{ letterSpacing: "1px", textTransform: "uppercase" }}>
                Controlled Engineering Document Library
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openUpload("new")}
              className="px-3 py-1.5 bg-white/10 border border-white/20 text-white rounded text-xs font-semibold hover:bg-white/20 flex items-center gap-1"
            >
              📤 Upload SMP PDF
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-1.5 bg-white/10 border border-white/20 text-white rounded text-xs font-semibold hover:bg-white/20 flex items-center gap-1"
            >
              📊 Export
            </button>
            <div className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold">{listQuery.data?.total ?? 0}</div>
              <div className="text-[0.6rem] uppercase opacity-70">Docs</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: library */}
        <div className="w-full sm:w-[400px] lg:w-[440px] flex flex-col border-r border-gray-200 bg-white">
          <SmpLibraryList
            items={items}
            availableFilters={availableFilters}
            search={search}
            filters={filters}
            isLoading={listQuery.isLoading}
            selectedId={selectedId}
            onSearch={setSearch}
            onFilter={setFilters}
            onClearFilters={clearFilters}
            onUploadClick={() => openUpload("new")}
            onSelect={(item: SmpDocumentListItem) => setSelectedId(item.id)}
          />
        </div>

        {/* RIGHT: detail */}
        <div className="hidden sm:flex flex-1 flex-col bg-gray-100 min-w-0">
          {detailQuery.data ? (
            <SmpDetailPane
              detail={detailQuery.data}
              isAuthenticated={isAuthenticated}
              onSelectRevision={setSelectedRevisionId}
              onEditMetadata={openEdit}
              onUploadRevision={() => openUpload("revision")}
              onDelete={() => { setDeleteToken(null); setDeleteOpen(true); }}
              onDownloadFile={handleDownload}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md px-6">
                <div className="text-6xl mb-4 opacity-30">📋</div>
                <h3 className="text-lg font-semibold text-gray-400 mb-2">Select a Document</h3>
                <p className="text-sm text-gray-400">
                  Choose an SMP from the library to view its document control, applicability, approved PDF, and procedure data.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Upload modal (new document or new revision) */}
      {uploadOpen && (
        <SmpUploadModal
          mode={uploadMode}
          document={uploadMode === "revision" ? selectedDoc : null}
          families={familiesQuery.data ?? []}
          onClose={() => setUploadOpen(false)}
          onComplete={handleUploadComplete}
        />
      )}

      {/* Edit metadata modal */}
      {editOpen && editForm && editInitial && (
        <ModalShell title={`Edit Metadata — ${editInitial.code}`} onClose={() => setEditOpen(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Reference Number *</label>
                <input value={editForm.code} onChange={(e) => setEditForm((p) => p && { ...p, code: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">SMP ID</label>
                <input value={editForm.smpId} onChange={(e) => setEditForm((p) => p && { ...p, smpId: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
              <input value={editForm.title} onChange={(e) => setEditForm((p) => p && { ...p, title: e.target.value })} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">SMP Family (as documented)</label>
                <input value={editForm.smpFamily} onChange={(e) => setEditForm((p) => p && { ...p, smpFamily: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Canonical Family</label>
                <select value={editForm.familyId} onChange={(e) => setEditForm((p) => p && { ...p, familyId: e.target.value })} className={inputClass}>
                  <option value="">No classification</option>
                  {(familiesQuery.data ?? []).map((f) => (
                    <option key={f.id} value={String(f.id)}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Equipment Type</label>
                <input value={editForm.equipmentType} onChange={(e) => setEditForm((p) => p && { ...p, equipmentType: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Asset Name</label>
                <input value={editForm.assetName} onChange={(e) => setEditForm((p) => p && { ...p, assetName: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Asset Type</label>
                <input value={editForm.assetType} onChange={(e) => setEditForm((p) => p && { ...p, assetType: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Facility Type</label>
                <input value={editForm.facilityType} onChange={(e) => setEditForm((p) => p && { ...p, facilityType: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Criticality</label>
                <select value={editForm.criticality} onChange={(e) => setEditForm((p) => p && { ...p, criticality: e.target.value })} className={inputClass}>
                  <option value="">Select...</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Document Owner</label>
                <input value={editForm.documentOwner} onChange={(e) => setEditForm((p) => p && { ...p, documentOwner: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Prepared By</label>
                <input value={editForm.preparedBy} onChange={(e) => setEditForm((p) => p && { ...p, preparedBy: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Reviewed By</label>
                <input value={editForm.reviewedBy} onChange={(e) => setEditForm((p) => p && { ...p, reviewedBy: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Approved By</label>
                <input value={editForm.approvedBy} onChange={(e) => setEditForm((p) => p && { ...p, approvedBy: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Applicability / Subtype Tags</label>
              <input
                value={editForm.applicability}
                onChange={(e) => setEditForm((p) => p && { ...p, applicability: e.target.value })}
                placeholder="Comma-separated, e.g. All, Belt, PLC"
                className={inputClass}
              />
            </div>
            <p className="text-[0.65rem] text-gray-400">
              Revision, effectivity and status are controlled through revision uploads and cannot be edited here.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={submitEdit}
                disabled={updateMut.isPending || !editForm.code.trim() || !editForm.title.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {updateMut.isPending ? "Saving..." : "Update Metadata"}
              </button>
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Delete confirmation — staged, recorded deletion */}
      {deleteOpen && selectedDoc && (
        <ModalShell title="🗑️ Delete SMP" onClose={() => setDeleteOpen(false)}>
          <p className="text-sm text-gray-700 mb-4">
            Are you sure you want to delete <strong>{selectedDoc.code} — {selectedDoc.title}</strong>?
            <br />
            All revisions ({selectedDoc.revisionCount}) and their stored PDF objects will be permanently removed.
            This action cannot be undone.
          </p>
          <p className="text-xs text-gray-400 mb-4">
            Deletion is staged: PDF objects are removed first and the document record after. If a step fails,
            nothing is silently dropped — you can retry with the same confirmation.
          </p>
          <div className="flex gap-2">
            <button
              onClick={requestDelete}
              disabled={deletePrepareMut.isPending || deleteConfirmMut.isPending}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {(deletePrepareMut.isPending || deleteConfirmMut.isPending)
                ? "Deleting..."
                : deleteToken
                  ? "Retry Deletion"
                  : "Delete SMP"}
            </button>
            <button onClick={() => setDeleteOpen(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">
              Cancel
            </button>
          </div>
        </ModalShell>
      )}

      {/* AI Assistant */}
      <AIAssistant
        contextType="smp"
        data={smpAiData}
        metadata={{
          sourceModule: "Standard Maintenance Procedures",
          sourceRecordId: "smp-library",
          sourceRecordLabel: "SMP Library",
        }}
        title="SMP AI"
        quickQuestions={[
          "Which SMP families are missing documents?",
          "Which SMPs are superseded or lack a current revision?",
          "Summarize SMP coverage by family and equipment type.",
          "Which documents are missing their approved PDF?",
          "List SMPs by criticality rating.",
        ]}
        position="bottom-right"
      />
    </div>
  );
}
