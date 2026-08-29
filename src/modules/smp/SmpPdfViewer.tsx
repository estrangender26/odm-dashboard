import { useEffect, useState } from "react";
import { storageFileUrl } from "@/lib/direct-storage-upload";

/**
 * Renders the authoritative uploaded PDF in an iframe (the source PDF is
 * preserved; it is never converted into HTML or rewritten).
 */
export function SmpPdfViewer({
  source,
  fileId,
  title,
  onDownload,
}: {
  source: "smp_documents" | "smp_document_revisions";
  fileId: number;
  title: string;
  onDownload?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const src = storageFileUrl(source, fileId, "view");

  useEffect(() => {
    setLoadError(false);
    setZoom(1);
  }, [src]);

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-100 rounded-lg border border-gray-200 min-h-[420px]">
        <div className="text-center max-w-md text-gray-400 px-4">
          <div className="text-5xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-600 mb-2">Cannot Preview PDF</h3>
          <p className="text-sm mb-4">The file may be unavailable or the preview failed to load.</p>
          {onDownload && (
            <button
              onClick={onDownload}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
            >
              ⬇️ Download PDF
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
        <span className="text-xs font-semibold text-gray-700 truncate flex-1" title={title}>
          {title}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
            className="px-2 py-1 bg-white border border-gray-300 rounded text-xs hover:bg-gray-100 font-bold"
          >
            −
          </button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            className="px-2 py-1 bg-white border border-gray-300 rounded text-xs hover:bg-gray-100 font-bold"
          >
            +
          </button>
          <button
            onClick={() => setZoom(1)}
            className="px-2 py-1 bg-white border border-gray-300 rounded text-xs hover:bg-gray-100"
          >
            Fit
          </button>
        </div>
        {onDownload && (
          <button
            onClick={onDownload}
            className="px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded text-xs hover:bg-blue-100 font-semibold flex items-center gap-1 flex-shrink-0"
          >
            ⬇️ Download
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto bg-gray-200 flex items-start justify-center p-4 min-h-[420px] max-h-[70vh]">
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            transition: "transform 0.15s ease",
            width: "850px",
            height: "1100px",
            maxWidth: "100%",
          }}
        >
          <iframe
            src={src}
            title={title}
            className="bg-white shadow-lg"
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            onLoad={() => setLoadError(false)}
            onError={() => setLoadError(true)}
          />
        </div>
      </div>
    </div>
  );
}
