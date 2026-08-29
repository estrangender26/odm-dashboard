import { useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { MAX_UPLOAD_ERROR_MESSAGE, MAX_UPLOAD_FILE_SIZE_BYTES } from "@contracts/upload-limits";
import { uploadFileDirect } from "@/lib/direct-storage-upload";
import { toDateInputValue } from "./smpFormat";
import type { SmpDocumentListItem, SmpFamily } from "./types";

type UploadMode = "new" | "revision";

const CRITICALITY_OPTIONS = ["A", "B", "C"];
const DEFAULT_APPLICABILITY_TAGS = [
  "All", "Belt", "Filter", "Screw", "Volute", "Decanter", "PLC", "SCADA", "UPS",
  "Pneumatic", "Turbo", "Screw Blower", "MV", "LV", "VFD-driven", "Grease", "Oil",
];

function nextRevisionLabel(current: string | null | undefined): string {
  const match = /(\d+)\s*$/.exec((current || "").trim());
  const next = match ? Number(match[1]) + 1 : 0;
  return `Rev. ${next}`;
}

function ModalShell({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
          <span className="text-sm font-bold text-gray-800">{title}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full px-3 py-2 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white";

export function SmpUploadModal({
  mode,
  document,
  families,
  onClose,
  onComplete,
}: {
  mode: UploadMode;
  document: SmpDocumentListItem | null;
  families: SmpFamily[];
  onClose: () => void;
  onComplete: (documentId: number | null) => void;
}) {
  const utils = trpc.useUtils();
  const createMut = trpc.smp.create.useMutation();

  const [form, setForm] = useState({
    code: "",
    title: "",
    smpId: "",
    smpFamily: document?.smpFamily ?? "",
    assetName: "",
    assetType: "",
    equipmentType: document?.equipmentType ?? "",
    facilityType: "",
    criticality: "",
    documentOwner: "",
    preparedBy: "",
    reviewedBy: "",
    approvedBy: "",
    revision: mode === "revision" ? nextRevisionLabel(document?.revision) : "Rev. 0",
    effectivityDate: mode === "revision" ? toDateInputValue(document?.effectivityDate) : "",
  });
  const [tags, setTags] = useState<string[]>(document?.applicability ?? []);
  const [customTag, setCustomTag] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const family = families.find((f) => f.name === form.smpFamily) ?? null;
  const suggestedTags = useMemo(() => {
    const fromFamily = family?.suggestedTags ?? [];
    const merged = [...new Set([...fromFamily, ...DEFAULT_APPLICABILITY_TAGS])];
    return merged;
  }, [family]);

  const set = (key: keyof typeof form) => (value: string) => setForm((p) => ({ ...p, [key]: value }));

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const addCustomTag = () => {
    const tag = customTag.trim();
    if (tag && !tags.includes(tag)) setTags((prev) => [...prev, tag]);
    setCustomTag("");
  };

  const selectFile = (next: File | null) => {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (next.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      setError(MAX_UPLOAD_ERROR_MESSAGE);
      setFile(null);
      return;
    }
    if (next.type && next.type !== "application/pdf" && next.type !== "application/octet-stream") {
      setError("Only PDF files are accepted for SMP documents.");
      setFile(null);
      return;
    }
    setFile(next);
  };

  const submit = async () => {
    setError(null);
    if (mode === "new" && (!form.code.trim() || !form.title.trim())) {
      setError("Reference number and title are required.");
      return;
    }
    if (!file) {
      setError("Select the approved PDF to upload.");
      return;
    }
    if (!form.revision.trim()) {
      setError("Revision label is required.");
      return;
    }
    setUploading(true);
    try {
      let documentId: number;
      if (mode === "new") {
        setLabel("Saving document metadata...");
        const created = await createMut.mutateAsync({
          code: form.code.trim(),
          title: form.title.trim(),
          smpId: form.smpId.trim() || undefined,
          smpFamily: form.smpFamily.trim() || undefined,
          assetName: form.assetName.trim() || undefined,
          assetType: form.assetType.trim() || undefined,
          equipmentType: form.equipmentType.trim() || undefined,
          facilityType: form.facilityType.trim() || undefined,
          applicability: tags.length ? tags : undefined,
          criticality: form.criticality || undefined,
          documentOwner: form.documentOwner.trim() || undefined,
          preparedBy: form.preparedBy.trim() || undefined,
          reviewedBy: form.reviewedBy.trim() || undefined,
          approvedBy: form.approvedBy.trim() || undefined,
        });
        documentId = created.id;
      } else {
        if (!document) throw new Error("Missing document context.");
        documentId = document.id;
      }

      setLabel(`Uploading "${file.name}"...`);
      await uploadFileDirect({
        module: "smp",
        file,
        target: {
          documentId,
          revision: form.revision.trim(),
          effectivityDate: form.effectivityDate || undefined,
        },
        onProgress: (pct) => {
          setProgress(Math.max(5, pct));
          setLabel(`Uploading "${file.name}"... ${pct}%`);
        },
      });
      setProgress(100);
      await utils.smp.list.invalidate();
      onComplete(documentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setUploading(false);
    }
  };

  return (
    <ModalShell
      title={mode === "new" ? "Upload SMP — New Controlled Document" : `Upload New Revision — ${document?.code ?? ""}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        {error && (
          <div className="px-4 py-3 border border-red-200 bg-red-50 text-red-800 rounded-lg text-sm">⚠️ {error}</div>
        )}

        {mode === "new" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reference Number" required>
                <input
                  value={form.code}
                  onChange={(e) => set("code")(e.target.value)}
                  placeholder="e.g. MW-ENGG-SP-1.0"
                  className={inputClass}
                />
              </Field>
              <Field label="SMP ID">
                <input value={form.smpId} onChange={(e) => set("smpId")(e.target.value)} placeholder="Optional internal ID" className={inputClass} />
              </Field>
            </div>
            <Field label="SMP Title" required>
              <input value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="e.g. Centrifugal Pump System" className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SMP Family">
                <select value={form.smpFamily} onChange={(e) => set("smpFamily")(e.target.value)} className={inputClass}>
                  <option value="">Select family...</option>
                  {families.map((f) => (
                    <option key={f.id} value={f.name}>{f.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Equipment Type">
                <input
                  value={form.equipmentType}
                  onChange={(e) => set("equipmentType")(e.target.value)}
                  list="smp-equipment-types"
                  placeholder="Typical equipment for the family"
                  className={inputClass}
                />
                <datalist id="smp-equipment-types">
                  {(family?.typicalEquipment ?? []).map((eq) => (
                    <option key={eq} value={eq} />
                  ))}
                </datalist>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Asset Name">
                <input value={form.assetName} onChange={(e) => set("assetName")(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Asset Type">
                <input value={form.assetType} onChange={(e) => set("assetType")(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Facility Type">
                <input value={form.facilityType} onChange={(e) => set("facilityType")(e.target.value)} className={inputClass} />
              </Field>
              <Field label="ABC Criticality">
                <select value={form.criticality} onChange={(e) => set("criticality")(e.target.value)} className={inputClass}>
                  <option value="">Select...</option>
                  {CRITICALITY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Document Owner">
                <input value={form.documentOwner} onChange={(e) => set("documentOwner")(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Prepared By">
                <input value={form.preparedBy} onChange={(e) => set("preparedBy")(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reviewed By">
                <input value={form.reviewedBy} onChange={(e) => set("reviewedBy")(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Approved By">
                <input value={form.approvedBy} onChange={(e) => set("approvedBy")(e.target.value)} className={inputClass} />
              </Field>
            </div>
          </>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700">
            Uploading a new revision to <strong>{document?.code} — {document?.title}</strong>. The previous
            revision is retained as superseded history; it is never overwritten.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Revision" required>
            <input value={form.revision} onChange={(e) => set("revision")(e.target.value)} placeholder="Rev. 0" className={inputClass} />
          </Field>
          <Field label="Effectivity Date">
            <input type="date" value={form.effectivityDate} onChange={(e) => set("effectivityDate")(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Approved PDF <span className="text-red-500">*</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex items-center justify-between border border-green-200 bg-green-50 rounded-lg px-3 py-2">
              <span className="text-sm text-green-800 truncate">📄 {file.name}</span>
              <button
                onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                className="text-xs text-green-700 hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-lg px-4 py-6 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600"
            >
              📤 Click to select the approved PDF ({MAX_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024} MB max)
            </button>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Applicability / Subtype Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {suggestedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full border ${
                  tags.includes(tag)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
              placeholder="Add custom tag and press Enter"
              className={inputClass}
            />
            <button type="button" onClick={addCustomTag} className="px-3 py-2 bg-gray-100 text-gray-700 rounded text-xs font-semibold hover:bg-gray-200">
              Add
            </button>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={submit}
            disabled={uploading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? `${label} ${progress}%` : mode === "new" ? "Create & Upload SMP" : "Upload Revision"}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
