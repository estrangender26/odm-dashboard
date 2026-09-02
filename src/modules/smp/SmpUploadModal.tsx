import { useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { MAX_UPLOAD_ERROR_MESSAGE, MAX_UPLOAD_FILE_SIZE_BYTES } from "@contracts/upload-limits";
import { uploadFileDirect } from "@/lib/direct-storage-upload";
import { extractSmpPdf, toDateInputValue, type SmpExtractionResult } from "./smpFormat";
import type { SmpDocumentListItem, SmpFamily } from "./types";

type UploadMode = "new" | "revision";
type Step = "select" | "extracting" | "review" | "uploading" | "error";

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

function inferCanonicalFamily(extractedFamily: string | null, families: SmpFamily[]): number | null {
  if (!extractedFamily) return null;
  const normalized = extractedFamily.toLowerCase().trim();
  // Exact name or code match
  for (const f of families) {
    if (f.name.toLowerCase() === normalized) return f.id;
    if (f.code && f.code.toLowerCase() === normalized) return f.id;
  }
  // Keyword containment: family name appears inside extracted text or vice versa
  for (const f of families) {
    const nameNorm = f.name.toLowerCase();
    if (normalized.includes(nameNorm) || nameNorm.includes(normalized)) return f.id;
  }
  return null;
}

function isPdfFile(f: File) {
  return f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
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

function Field({ label, required, children, hint, status }: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
  status?: "extracted" | "missing" | "conflict";
}) {
  return (
    <div className="min-w-0">
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
        {status === "extracted" && <span className="ml-1.5 text-[10px] font-normal text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Extracted</span>}
        {status === "missing" && <span className="ml-1.5 text-[10px] font-normal text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Not found in PDF</span>}
        {status === "conflict" && <span className="ml-1.5 text-[10px] font-normal text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Needs review</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-gray-500">{hint}</p>}
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

  const [step, setStep] = useState<Step>("select");
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<SmpExtractionResult | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: "",
    title: "",
    smpId: "",
    smpFamily: document?.smpFamily ?? "",
    familyId: document?.familyId != null ? String(document.familyId) : "",
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

  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const family = families.find((f) => f.id === Number(form.familyId)) ?? null;
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

  const applyExtraction = (ext: SmpExtractionResult) => {
    const inferredFamilyId = inferCanonicalFamily(ext.smpFamily, families);
    setForm((prev) => ({
      ...prev,
      code: ext.code ?? prev.code,
      title: ext.title ?? prev.title,
      smpId: ext.smpId ?? prev.smpId,
      smpFamily: ext.smpFamily ?? prev.smpFamily,
      familyId: inferredFamilyId != null ? String(inferredFamilyId) : prev.familyId,
      assetName: ext.assetName ?? prev.assetName,
      assetType: ext.assetType ?? prev.assetType,
      equipmentType: ext.equipmentType ?? prev.equipmentType,
      facilityType: ext.facilityType ?? prev.facilityType,
      criticality: ext.criticality ?? prev.criticality,
      documentOwner: ext.documentOwner ?? prev.documentOwner,
      preparedBy: ext.preparedBy ?? prev.preparedBy,
      reviewedBy: ext.reviewedBy ?? prev.reviewedBy,
      approvedBy: ext.approvedBy ?? prev.approvedBy,
      revision: ext.revision ?? prev.revision,
      effectivityDate: ext.effectivityDate ?? prev.effectivityDate,
    }));
    setTags((prev) => (prev.length > 0 ? prev : ext.applicability));
  };

  const runExtraction = async (targetFile: File) => {
    setExtractionError(null);
    setExtraction(null);
    setStep("extracting");
    try {
      const { extraction: ext } = await extractSmpPdf(targetFile);
      setExtraction(ext);
      if (ext.isEmpty) {
        setExtractionError("No readable text was found in this PDF. It may be scanned/image-only. Please choose another PDF or enter details manually.");
        setStep("error");
      } else {
        applyExtraction(ext);
        setStep("review");
      }
    } catch (err) {
      setExtractionError(err instanceof Error ? err.message : "PDF extraction failed.");
      setStep("error");
    }
  };

  const selectFile = async (next: File | null) => {
    setError(null);
    setExtractionError(null);
    setExtraction(null);
    if (!next) {
      setFile(null);
      setStep("select");
      return;
    }
    if (next.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      setError(MAX_UPLOAD_ERROR_MESSAGE);
      setFile(null);
      setStep("select");
      return;
    }
    if (!isPdfFile(next)) {
      setError("Only PDF files are accepted for SMP documents.");
      setFile(null);
      setStep("select");
      return;
    }
    setFile(next);
    await runExtraction(next);
  };

  const resetToSelect = () => {
    setFile(null);
    setExtraction(null);
    setExtractionError(null);
    setError(null);
    setStep("select");
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    if (mode === "revision" && extraction?.code && extraction.code !== document?.code) {
      setError(`PDF reference number (${extraction.code}) does not match this document series (${document?.code ?? ""}).`);
      return;
    }
    if (!form.revision.trim()) {
      setError("Revision label is required.");
      return;
    }
    setUploading(true);
    setStep("uploading");
    try {
      setLabel(`Uploading "${file.name}"...`);
      const familyIdValue = form.familyId ? Number(form.familyId) : undefined;
      const result = await uploadFileDirect({
        module: "smp",
        file,
        target: mode === "new"
          ? {
              code: form.code.trim(),
              title: form.title.trim(),
              smpId: form.smpId.trim() || undefined,
              smpFamily: form.smpFamily.trim() || undefined,
              familyId: familyIdValue,
              assetName: form.assetName.trim() || undefined,
              assetType: form.assetType.trim() || undefined,
              equipmentType: form.equipmentType.trim() || undefined,
              facilityType: form.facilityType.trim() || undefined,
              applicability: tags.length ? tags.join(",") : undefined,
              criticality: form.criticality || undefined,
              documentOwner: form.documentOwner.trim() || undefined,
              preparedBy: form.preparedBy.trim() || undefined,
              reviewedBy: form.reviewedBy.trim() || undefined,
              approvedBy: form.approvedBy.trim() || undefined,
              revision: form.revision.trim(),
              effectivityDate: form.effectivityDate || undefined,
              sections: extraction?.sections,
              tasks: extraction?.tasks,
            }
          : {
              documentId: document?.id,
              revision: form.revision.trim(),
              effectivityDate: form.effectivityDate || undefined,
              sections: extraction?.sections,
              tasks: extraction?.tasks,
            },
        onProgress: (pct) => {
          setProgress(Math.max(5, pct));
          setLabel(`Uploading "${file.name}"... ${pct}%`);
        },
      });
      setProgress(100);
      await utils.smp.list.invalidate();
      const resultDocumentId = mode === "new"
        ? ((result as { documentId?: number }).documentId ?? null)
        : (document?.id ?? null);
      onComplete(resultDocumentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setUploading(false);
      setStep("review");
    }
  };

  const modalTitle =
    step === "review" || step === "uploading"
      ? `Review SMP — ${file?.name ?? ""}`
      : mode === "new"
        ? "Upload SMP — New Controlled Document"
        : `Upload New Revision — ${document?.code ?? ""}`;

  const fieldStatus = (value: string | null | undefined): "extracted" | "missing" | undefined => {
    if (value && String(value).trim()) return "extracted";
    return "missing";
  };

  const renderSelectStep = () => (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Select an approved SMP PDF. Document information will be extracted automatically for your review.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full border-2 border-dashed border-gray-300 rounded-lg px-4 py-8 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 flex flex-col items-center gap-2"
      >
        <span className="text-2xl">📄</span>
        <span>Click to select the approved PDF ({MAX_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024} MB max)</span>
        <span className="text-xs text-gray-400">or drag and drop a PDF here</span>
      </button>
      {mode === "revision" && document && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700">
          Uploading a new revision to <strong>{document.code} — {document.title}</strong>. The previous
          revision is retained as superseded history; it is never overwritten.
        </div>
      )}
    </div>
  );

  const renderExtractingStep = () => (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <span className="inline-block w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
      <p className="text-sm font-medium text-gray-700">Reading SMP document…</p>
      <p className="text-xs text-gray-500">{file?.name}</p>
    </div>
  );

  const renderErrorStep = () => (
    <div className="space-y-4">
      <div className="px-4 py-3 border border-red-200 bg-red-50 text-red-800 rounded-lg text-sm">
        ⚠️ {extractionError}
      </div>
      <div className="flex gap-2">
        {file && (
          <button
            onClick={() => runExtraction(file)}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
          >
            Retry
          </button>
        )}
        <button
          onClick={resetToSelect}
          className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200"
        >
          Choose another PDF
        </button>
      </div>
    </div>
  );

  const renderReviewStep = () => {
    const seriesMismatch = mode === "revision" && extraction?.code && extraction.code !== document?.code;
    return (
      <div className="space-y-5">
        {error && (
          <div className="px-4 py-3 border border-red-200 bg-red-50 text-red-800 rounded-lg text-sm">⚠️ {error}</div>
        )}

        {seriesMismatch && (
          <div className="px-4 py-3 border border-red-200 bg-red-50 text-red-800 rounded-lg text-sm">
            ⚠️ PDF reference number ({extraction?.code}) does not match this document series ({document?.code ?? ""}).
          </div>
        )}

        {extraction && !extraction.isEmpty && (
          <div className="px-4 py-2 border border-green-200 bg-green-50 text-green-800 rounded-lg text-xs">
            📄 Extracted {extraction.sections.length} section{extraction.sections.length === 1 ? "" : "s"} and {extraction.tasks.length} task{extraction.tasks.length === 1 ? "" : "s"}. Review and correct the pre-filled fields before uploading.
          </div>
        )}

        <section>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Document Control</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reference Number" required status={fieldStatus(form.code)}>
              <input value={form.code} onChange={(e) => set("code")(e.target.value)} placeholder="e.g. MW-ENGG-SP-1.0" className={inputClass} />
            </Field>
            <Field label="SMP ID" status={fieldStatus(form.smpId)}>
              <input value={form.smpId} onChange={(e) => set("smpId")(e.target.value)} placeholder="Optional internal ID" className={inputClass} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="SMP Title" required status={fieldStatus(form.title)}>
              <input value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="e.g. Centrifugal Pump System" className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="SMP Family (as documented)" status={fieldStatus(form.smpFamily)}>
              <input value={form.smpFamily} onChange={(e) => set("smpFamily")(e.target.value)} placeholder="Literal family text from the PDF" className={inputClass} />
            </Field>
            <Field label="Canonical Family" hint="Auto-mapped when the extracted family clearly matches a catalog entry">
              <select data-testid="canonical-family-select" value={form.familyId} onChange={(e) => set("familyId")(e.target.value)} className={inputClass}>
                <option value="">No classification</option>
                {families.map((f) => (
                  <option key={f.id} value={String(f.id)}>{f.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Revision" required status={fieldStatus(form.revision)}>
              <input value={form.revision} onChange={(e) => set("revision")(e.target.value)} placeholder="Rev. 0" className={inputClass} />
            </Field>
            <Field label="Effectivity Date" status={fieldStatus(form.effectivityDate)}>
              <input type="date" value={form.effectivityDate} onChange={(e) => set("effectivityDate")(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </section>

        <section>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Applicability</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Asset Name" status={fieldStatus(form.assetName)}>
              <input value={form.assetName} onChange={(e) => set("assetName")(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Asset Type" status={fieldStatus(form.assetType)}>
              <input value={form.assetType} onChange={(e) => set("assetType")(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Equipment Type" status={fieldStatus(form.equipmentType)}>
              <input value={form.equipmentType} onChange={(e) => set("equipmentType")(e.target.value)} list="smp-equipment-types" placeholder="Typical equipment for the family" className={inputClass} />
              <datalist id="smp-equipment-types">
                {(family?.typicalEquipment ?? []).map((eq) => (
                  <option key={eq} value={eq} />
                ))}
              </datalist>
            </Field>
            <Field label="Facility Type" status={fieldStatus(form.facilityType)}>
              <input value={form.facilityType} onChange={(e) => set("facilityType")(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="ABC Criticality" status={fieldStatus(form.criticality)}>
              <select value={form.criticality} onChange={(e) => set("criticality")(e.target.value)} className={inputClass}>
                <option value="">Select...</option>
                {CRITICALITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-3">
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
        </section>

        <section>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Approval / Ownership</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prepared By" status={fieldStatus(form.preparedBy)}>
              <input value={form.preparedBy} onChange={(e) => set("preparedBy")(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Reviewed By" status={fieldStatus(form.reviewedBy)}>
              <input value={form.reviewedBy} onChange={(e) => set("reviewedBy")(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Approved By" status={fieldStatus(form.approvedBy)}>
              <input value={form.approvedBy} onChange={(e) => set("approvedBy")(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Document Owner" status={fieldStatus(form.documentOwner)}>
              <input value={form.documentOwner} onChange={(e) => set("documentOwner")(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </section>

        <div className="flex gap-2 pt-2">
          <button
            onClick={submit}
            disabled={uploading || !!seriesMismatch}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mode === "new" ? "Upload Controlled Document" : "Upload Revision"}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const renderUploadingStep = () => (
    <div className="flex flex-col items-center justify-center py-10 gap-4">
      <div className="w-full max-w-xs bg-gray-200 rounded-full h-2 overflow-hidden">
        <div className="bg-blue-600 h-full transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-sm font-medium text-gray-700">{label}</p>
    </div>
  );

  return (
    <ModalShell title={modalTitle} onClose={onClose}>
      <div className="space-y-4">
        {error && step !== "error" && (
          <div className="px-4 py-3 border border-red-200 bg-red-50 text-red-800 rounded-lg text-sm">⚠️ {error}</div>
        )}
        {step === "select" && renderSelectStep()}
        {step === "extracting" && renderExtractingStep()}
        {step === "error" && renderErrorStep()}
        {step === "review" && renderReviewStep()}
        {step === "uploading" && renderUploadingStep()}
      </div>
    </ModalShell>
  );
}
