import { useMemo } from "react";
import { storageFileUrl } from "@/lib/direct-storage-upload";
import { SmpPdfViewer } from "./SmpPdfViewer";
import {
  formatFileSize,
  formatSmpDate,
  legacyStatusBadge,
  revisionStatusBadge,
} from "./smpFormat";
import {
  SMP_TASK_CATEGORY_LABELS,
  type SmpDetail,
  type SmpRevision,
  type SmpTask,
  type SmpTaskCategory,
} from "./types";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[0.7rem] font-bold uppercase tracking-widest text-gray-400 mb-3">
      {children}
    </h3>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800 mt-0.5 break-words">{value || "—"}</div>
    </div>
  );
}

function EmptyProcedureData() {
  return (
    <div className="border border-dashed border-gray-300 rounded-lg px-4 py-6 text-center text-gray-400">
      <div className="text-2xl mb-2">🗂️</div>
      <p className="text-sm text-gray-500">
        No structured procedure data yet. This will be populated when the approved PDF is ingested.
      </p>
    </div>
  );
}

function TaskCard({ task }: { task: SmpTask }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800 flex-1">{task.taskText}</p>
        {task.failureMode && (
          <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 whitespace-nowrap">
            Failure mode
          </span>
        )}
      </div>
      {task.failureMode && (
        <p className="text-xs text-gray-600 mt-1">
          <strong>Failure mode:</strong> {task.failureMode}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {task.applicabilityTags.length > 0 && (
          <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
            Applies to: {task.applicabilityTags.join(", ")}
          </span>
        )}
        {task.frequency && (
          <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            {task.frequency}
          </span>
        )}
        {task.maintenanceClass && (
          <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
            {task.maintenanceClass}
          </span>
        )}
        {task.responsibilityType && (
          <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
            {task.responsibilityType}
          </span>
        )}
      </div>
      {task.toolsMaterials && (
        <p className="text-xs text-gray-600 mt-2"><strong>Tools &amp; materials:</strong> {task.toolsMaterials}</p>
      )}
      {task.safetyControls && (
        <p className="text-xs text-gray-600 mt-1"><strong>Safety controls:</strong> {task.safetyControls}</p>
      )}
      {task.fieldCaptureData != null && (
        <p className="text-xs text-gray-600 mt-1">
          <strong>Field capture data:</strong>{" "}
          <code className="text-[0.7rem]">{JSON.stringify(task.fieldCaptureData)}</code>
        </p>
      )}
      {task.escalationTrigger && (
        <p className="text-xs text-amber-700 mt-1"><strong>Escalation trigger:</strong> {task.escalationTrigger}</p>
      )}
    </div>
  );
}

const TASK_ORDER: SmpTaskCategory[] = ["operator_driven", "technician_pm", "technician_cbm", "corrective"];

export function SmpDetailPane({
  detail,
  isAuthenticated,
  onEditMetadata,
  onUploadRevision,
  onDelete,
  onDownloadFile,
}: {
  detail: SmpDetail;
  isAuthenticated: boolean;
  onEditMetadata: () => void;
  onUploadRevision: () => void;
  onDelete: () => void;
  onDownloadFile: () => void;
}) {
  const doc = detail.document;
  const revisions = detail.revisions;

  const currentRevision: SmpRevision | null = useMemo(
    () => revisions.find((r) => r.status === "current") ?? null,
    [revisions],
  );
  const latestRevision: SmpRevision | null = revisions[0] ?? null;
  const viewerRevision = currentRevision ?? latestRevision;

  // Legacy rows (no revision rows) keep their file on the series row.
  const viewer = viewerRevision?.hasFile
    ? { source: "smp_document_revisions" as const, fileId: viewerRevision.id }
    : doc.hasFile
      ? { source: "smp_documents" as const, fileId: doc.id }
      : null;

  const statusBadge = currentRevision
    ? revisionStatusBadge("current")
    : revisions.length > 0
      ? revisionStatusBadge("superseded")
      : legacyStatusBadge(doc.status);

  const tasksByCategory = useMemo(() => {
    const map = new Map<string, SmpTask[]>();
    for (const category of TASK_ORDER) map.set(category, []);
    for (const task of detail.tasks) {
      const key = TASK_ORDER.includes(task.category as SmpTaskCategory) ? task.category : "_other";
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [detail.tasks]);

  const escalationTasks = useMemo(
    () => detail.tasks.filter((t) => t.escalationTrigger && t.escalationTrigger.trim()),
    [detail.tasks],
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-5 p-5">
        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                {doc.code}
                {doc.revision ? ` · ${doc.revision}` : ""}
                {doc.smpId ? ` · ${doc.smpId}` : ""}
              </div>
              <h2 className="text-lg font-bold text-gray-800 mt-1 break-words">{doc.title}</h2>
              {doc.smpFamily && (
                <div className="mt-1">
                  <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                    {doc.smpFamily}
                  </span>
                </div>
              )}
            </div>
            <span
              className="text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap flex-shrink-0"
              style={{ background: statusBadge.bg, color: statusBadge.text }}
            >
              {statusBadge.label}
            </span>
          </div>
          {isAuthenticated && (
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={onEditMetadata}
                className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-semibold hover:bg-blue-100"
              >
                ✏️ Edit Metadata
              </button>
              <button
                onClick={onUploadRevision}
                className="px-3 py-1.5 bg-green-50 text-green-700 rounded text-xs font-semibold hover:bg-green-100"
              >
                📤 Upload New Revision
              </button>
              <button
                onClick={onDelete}
                className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100"
              >
                🗑️ Delete
              </button>
            </div>
          )}
        </div>

        {/* Document control */}
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <SectionHeading>Document Control</SectionHeading>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <InfoField label="Reference No." value={doc.code} />
            <InfoField label="SMP ID" value={doc.smpId} />
            <InfoField label="Title" value={doc.title} />
            <InfoField label="Revision" value={doc.revision} />
            <InfoField label="Effectivity Date" value={formatSmpDate(doc.effectivityDate)} />
            <InfoField label="Document Owner" value={doc.documentOwner} />
            <InfoField label="Prepared By" value={doc.preparedBy} />
            <InfoField label="Reviewed By" value={doc.reviewedBy} />
            <InfoField label="Approved By" value={doc.approvedBy} />
            <InfoField label="Last Updated" value={formatSmpDate(doc.updatedAt)} />
          </div>
        </section>

        {/* Applicability */}
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <SectionHeading>Applicability</SectionHeading>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <InfoField label="Asset Name" value={doc.assetName} />
            <InfoField label="Asset Type" value={doc.assetType} />
            <InfoField label="Equipment Type" value={doc.equipmentType} />
            <InfoField label="Facility Type" value={doc.facilityType} />
            <InfoField label="Criticality" value={doc.criticality ? `ABC — ${doc.criticality}` : null} />
            <InfoField label="System" value={doc.system} />
          </div>
          {doc.applicability.length > 0 && (
            <div className="mt-3">
              <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Applicability / Subtypes
              </div>
              <div className="flex flex-wrap gap-1.5">
                {doc.applicability.map((tag) => (
                  <span key={tag} className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Controlled document */}
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <SectionHeading>Controlled Document</SectionHeading>
          {viewer ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                <InfoField label="Original Filename" value={doc.fileName ?? viewerRevision?.originalFileName} />
                <InfoField label="MIME Type" value={doc.fileType ?? viewerRevision?.fileType} />
                <InfoField label="File Size" value={formatFileSize(viewerRevision?.fileSize)} />
                <InfoField label="Uploaded" value={formatSmpDate(doc.uploadedAt ?? viewerRevision?.uploadedAt)} />
              </div>
              <div className="flex gap-2 mb-3">
                <a
                  href={storageFileUrl(viewer.source, viewer.fileId, "view")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                >
                  📄 Open PDF
                </a>
                <button
                  onClick={onDownloadFile}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50"
                >
                  ⬇️ Download
                </button>
              </div>
              <SmpPdfViewer
                source={viewer.source}
                fileId={viewer.fileId}
                title={`${doc.code} — ${doc.title}`}
                onDownload={onDownloadFile}
              />
            </>
          ) : (
            <div className="border border-dashed border-gray-300 rounded-lg px-4 py-8 text-center text-gray-400">
              <div className="text-3xl mb-2">📄</div>
              <p className="text-sm text-gray-500">
                No approved PDF has been uploaded for this document yet.
              </p>
              {isAuthenticated && (
                <button
                  onClick={onUploadRevision}
                  className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
                >
                  📤 Upload Approved PDF
                </button>
              )}
            </div>
          )}
        </section>

        {/* Procedure data */}
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <SectionHeading>Procedure Data</SectionHeading>
          {detail.sections.length === 0 && detail.tasks.length === 0 ? (
            <EmptyProcedureData />
          ) : (
            <div className="space-y-4">
              {detail.sections.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Sections</h4>
                  <div className="space-y-2">
                    {detail.sections.map((section) => (
                      <div key={section.id} className="border border-gray-100 rounded-lg p-3">
                        <div className="text-sm font-semibold text-gray-800">
                          {section.position + 1}. {section.title}
                        </div>
                        {section.body && <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{section.body}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {TASK_ORDER.map((category) => {
                const tasks = tasksByCategory.get(category) ?? [];
                if (tasks.length === 0) return null;
                return (
                  <div key={category}>
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                      {SMP_TASK_CATEGORY_LABELS[category]}
                    </h4>
                    <div className="space-y-2">
                      {tasks.map((task) => (
                        <TaskCard key={task.id} task={task} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {(() => {
                const other = tasksByCategory.get("_other") ?? [];
                if (other.length === 0) return null;
                return (
                  <div>
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Other Tasks</h4>
                    <div className="space-y-2">
                      {other.map((task) => (
                        <TaskCard key={task.id} task={task} />
                      ))}
                    </div>
                  </div>
                );
              })()}
              {escalationTasks.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-2">Escalation Criteria</h4>
                  <div className="space-y-2">
                    {escalationTasks.map((task) => (
                      <div key={task.id} className="border border-amber-100 bg-amber-50/50 rounded-lg p-3">
                        <p className="text-xs text-gray-700">
                          <strong>{task.taskText}</strong>
                          {task.frequency ? ` · ${task.frequency}` : ""}
                        </p>
                        <p className="text-xs text-amber-800 mt-1">⚠️ {task.escalationTrigger}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Revision history */}
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <SectionHeading>Revision History</SectionHeading>
          {revisions.length === 0 ? (
            <p className="text-sm text-gray-400">
              No revision history. {doc.hasFile ? "This document carries a legacy file without revision rows." : "Uploading a revision will create the first revision record."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-400 uppercase text-[0.65rem] border-b border-gray-200">
                    <th className="py-2 pr-3 font-semibold">Revision</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">Effectivity</th>
                    <th className="py-2 pr-3 font-semibold">Uploaded By</th>
                    <th className="py-2 pr-3 font-semibold">Uploaded At</th>
                    <th className="py-2 font-semibold">File</th>
                  </tr>
                </thead>
                <tbody>
                  {revisions.map((revision) => {
                    const badge = revisionStatusBadge(revision.status);
                    return (
                      <tr key={revision.id} className="border-b border-gray-100">
                        <td className="py-2 pr-3 font-semibold text-gray-800">{revision.revision}</td>
                        <td className="py-2 pr-3">
                          <span
                            className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: badge.bg, color: badge.text }}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-gray-600">{formatSmpDate(revision.effectivityDate)}</td>
                        <td className="py-2 pr-3 text-gray-600">{revision.uploadedBy || "—"}</td>
                        <td className="py-2 pr-3 text-gray-600">{formatSmpDate(revision.uploadedAt)}</td>
                        <td className="py-2">
                          {revision.hasFile ? (
                            <a
                              href={storageFileUrl("smp_document_revisions", revision.id, "view")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline font-semibold"
                            >
                              View
                            </a>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[0.65rem] text-gray-400 mt-2">
            The original uploaded PDF is the authoritative controlled document. Revisions are never overwritten.
          </p>
        </section>
      </div>
    </div>
  );
}
