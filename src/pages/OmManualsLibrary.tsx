import { memo, useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  MAX_UPLOAD_FILE_SIZE_BYTES,
} from "@contracts/upload-limits";
import { deleteFileWithVerification, shouldUseDirectStorage, uploadFileDirect } from "@/lib/direct-storage-upload";
import {
  buildDestinationFolderTree,
  createSubmissionGuard,
  createTrailingAsyncCoordinator,
  getDestinationFolderOptions,
} from "@/lib/om-manual-moves";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface TreeFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  childFolderCount: number;
  fileCount: number;
  hasChildren: boolean;
  children: TreeFolder[];
  files: TreeFile[];
  isChildrenLoaded?: boolean;
}

interface TreeFile {
  id: number;
  title: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  revision: string | null;
  uploadedAt: Date | null;
  hasFileData: boolean;
  storageBacked: boolean;
  fileUrl: string | null;
}

// ═══════════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════════

function Banner({ type, message, onDismiss }: { type: "error" | "success" | "info"; message: string; onDismiss?: () => void }) {
  const s: Record<string, string> = {
    error:   "bg-red-50   border-red-200   text-red-800",
    success: "bg-green-50 border-green-200 text-green-800",
    info:    "bg-blue-50  border-blue-200  text-blue-800",
  };
  return (
    <div className={`mb-3 px-4 py-3 border rounded-lg text-sm flex items-center gap-2 ${s[type]}`}>
      <span>{type === "error" ? "⚠️" : type === "success" ? "✅" : "ℹ️"}</span>
      <span className="flex-1">{message}</span>
      {onDismiss && <button type="button" onClick={onDismiss} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>}
    </div>
  );
}

/* ═── Progress Overlay ──═══════════════════════════════ */
function ProgressOverlay({ visible, label, sublabel, progress }: { visible: boolean; label: string; sublabel?: string; progress?: number }) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(13,33,55,0.55)", backdropFilter: "blur(2px)" }}>
      <div className="bg-white rounded-xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4 min-w-[260px]">
        {/* Spinner */}
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 animate-spin" style={{ animationDuration: "0.8s" }} />
        </div>
        {/* Label */}
        <div className="text-center">
          <p className="text-sm font-bold text-gray-800">{label}</p>
          {sublabel && <p className="text-xs text-gray-500 mt-1">{sublabel}</p>}
        </div>
        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: progress !== undefined ? `${Math.min(100, Math.max(5, progress))}%` : "60%",
              background: "linear-gradient(90deg, #2563EB 0%, #3B82F6 50%, #2563EB 100%)",
              backgroundSize: "200% 100%",
              animation: progress !== undefined ? "none" : "progressShimmer 1.5s ease-in-out infinite",
            }}
          />
        </div>
        {/* Cancel hint */}
        <p className="text-[0.65rem] text-gray-400">Please wait...</p>
      </div>
      <style>{`
        @keyframes progressShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

const isDev = import.meta.env.DEV;

function logTiming(message: string, ...args: unknown[]) {
  if (isDev) console.info(message, ...args);
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}>
      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Collect all folder IDs that match search (for auto-expand)
function getMatchingIds(folders: TreeFolder[], query: string): Set<number> {
  const ids = new Set<number>();
  const q = query.toLowerCase();
  function walk(fs: TreeFolder[]): boolean {
    let anyMatch = false;
    for (const f of fs) {
      const nameMatch = f.name.toLowerCase().includes(q);
      const fileMatch = f.files.some(file =>
        file.title.toLowerCase().includes(q) ||
        file.fileName.toLowerCase().includes(q)
      );
      const childMatch = walk(f.children);
      if (nameMatch || fileMatch || childMatch) {
        ids.add(f.id);
        anyMatch = true;
      }
    }
    return anyMatch;
  }
  walk(folders);
  return ids;
}

function collectIds(folders: TreeFolder[]): number[] {
  const ids: number[] = [];
  function walk(fs: TreeFolder[]) {
    for (const f of fs) {
      ids.push(f.id);
      walk(f.children);
    }
  }
  walk(folders);
  return ids;
}

function filterTree(folders: TreeFolder[], query: string): TreeFolder[] {
  const q = query.toLowerCase();
  return folders
    .map(f => {
      const matchingChildren = filterTree(f.children, q);
      const matchingFiles = f.files.filter(file =>
        file.title.toLowerCase().includes(q) ||
        file.fileName.toLowerCase().includes(q)
      );
      const nameMatch = f.name.toLowerCase().includes(q);
      if (nameMatch || matchingChildren.length > 0 || matchingFiles.length > 0) {
        return { ...f, children: matchingChildren, files: nameMatch ? f.files : matchingFiles };
      }
      return null;
    })
    .filter(Boolean) as TreeFolder[];
}

function getFolderPath(folders: TreeFolder[], targetId: number): TreeFolder[] {
  function walk(fs: TreeFolder[], path: TreeFolder[]): TreeFolder[] | null {
    for (const f of fs) {
      if (f.id === targetId) return [...path, f];
      const result = walk(f.children, [...path, f]);
      if (result) return result;
    }
    return null;
  }
  return walk(folders, []) || [];
}

function folderExists(folders: TreeFolder[], targetId: number): boolean {
  return getFolderPath(folders, targetId).length > 0;
}

function fileExists(folders: TreeFolder[], targetId: number): boolean {
  for (const folder of folders) {
    if (folder.files.some((f) => f.id === targetId)) return true;
    if (fileExists(folder.children, targetId)) return true;
  }
  return false;
}

function findFileById(folders: TreeFolder[], targetId: number): TreeFile | null {
  for (const folder of folders) {
    const found = folder.files.find((file) => file.id === targetId);
    if (found) return found;
    const nested = findFileById(folder.children, targetId);
    if (nested) return nested;
  }
  return null;
}

function mergeFolderSummaries(nextFolders: TreeFolder[], previousFolders: TreeFolder[]): TreeFolder[] {
  const previousById = new Map(previousFolders.map((folder) => [folder.id, folder] as const));
  return nextFolders.map((folder) => {
    const previous = previousById.get(folder.id);
    return previous?.isChildrenLoaded
      ? { ...folder, children: previous.children, files: previous.files, isChildrenLoaded: true }
      : folder;
  });
}

function markFullTreeLoaded(folders: TreeFolder[]): TreeFolder[] {
  return folders.map((folder) => ({
    ...folder,
    isChildrenLoaded: true,
    children: markFullTreeLoaded(folder.children),
  }));
}

function updateFolderContents(
  folders: TreeFolder[],
  parentId: number | null,
  nextChildren: TreeFolder[],
  nextFiles: TreeFile[],
): TreeFolder[] {
  if (parentId === null) return mergeFolderSummaries(nextChildren, folders);

  return folders.map((folder) => {
    if (folder.id === parentId) {
      return {
        ...folder,
        childFolderCount: nextChildren.length,
        fileCount: nextFiles.length,
        hasChildren: nextChildren.length > 0 || nextFiles.length > 0,
        children: mergeFolderSummaries(nextChildren, folder.children),
        files: nextFiles,
        isChildrenLoaded: true,
      };
    }

    if (folder.children.length === 0) return folder;
    return { ...folder, children: updateFolderContents(folder.children, parentId, nextChildren, nextFiles) };
  });
}

// ═══════════════════════════════════════════════════════════
// Context Menu Component
// ═══════════════════════════════════════════════════════════

function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number;
  items: { label: string; icon: string; onClick: () => void; danger?: boolean }[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function clickOutside(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    function esc() { onClose(); }
    document.addEventListener("mousedown", clickOutside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", clickOutside); document.removeEventListener("keydown", esc); };
  }, [onClose]);

  return (
    <div ref={ref} className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]" style={{ left: x, top: y }}>
      {items.map((item, i) => (
        <button key={i} type="button" onClick={() => { item.onClick(); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${item.danger ? "text-red-600" : "text-gray-700"}`}>
          <span>{item.icon}</span> {item.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Recursive Tree Folder Component
// ═══════════════════════════════════════════════════════════

const TreeFolderItem = memo(function TreeFolderItem({
  folder, level, expanded, onToggle,
  selectedFolderId, selectedFileId, onSelectFolder, onSelectFile,
  onContextMenuFolder, onContextMenuFile,
  onDownloadFile, onDeleteFile,
  searchQuery, matchedIds, expandedIds, loadingFolderIds,
}: {
  folder: TreeFolder;
  level: number;
  expanded: boolean;
  onToggle: (id: number) => void;
  selectedFolderId: number | null;
  selectedFileId: number | null;
  onSelectFolder: (id: number) => void;
  onSelectFile: (file: TreeFile) => void;
  onContextMenuFolder: (e: React.MouseEvent, folder: TreeFolder) => void;
  onContextMenuFile: (e: React.MouseEvent, file: TreeFile, folderId: number) => void;
  onDownloadFile: (file: TreeFile) => void;
  onDeleteFile: (file: TreeFile) => void;
  searchQuery: string;
  matchedIds: Set<number>;
  expandedIds: Set<number>;
  loadingFolderIds: Set<number>;
}) {
  const isLoadingChildren = loadingFolderIds.has(folder.id);
  const hasContent = folder.hasChildren || folder.children.length > 0 || folder.files.length > 0;
  const isDimmed = searchQuery.length > 0 && !matchedIds.has(folder.id) && !folder.files.some(f => f.title.toLowerCase().includes(searchQuery.toLowerCase()) || f.fileName.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div>
      {/* Folder row */}
      <div
        className={`flex items-center gap-1.5 cursor-pointer group transition select-none
          ${isDimmed ? "opacity-40" : "opacity-100"}
          ${selectedFolderId === folder.id ? "bg-blue-50" : "hover:bg-gray-50"}`}
        style={{ paddingLeft: `${level * 12 + 8}px`, paddingRight: "8px", paddingTop: "4px", paddingBottom: "4px" }}
        onClick={() => onSelectFolder(folder.id)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenuFolder(e, folder); }}
      >
        <button
          type="button"
          className="w-4 h-4 flex items-center justify-center text-gray-400 flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onToggle(folder.id); }}
        >
          {isLoadingChildren ? <span className="w-3 h-3 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin" /> : hasContent ? <Chevron expanded={expanded} /> : <span className="w-2" />}
        </button>
        <span className="text-sm flex-shrink-0">{expanded ? "📂" : "📁"}</span>
        <span className={`text-xs font-semibold truncate flex-1 ${selectedFolderId === folder.id ? "text-blue-800" : "text-gray-700"}`}>{folder.name}</span>
        {(folder.childFolderCount > 0 || folder.fileCount > 0) && (
          <span className="text-[0.6rem] text-gray-400 flex-shrink-0 mr-1">
            {folder.childFolderCount > 0 && `${folder.childFolderCount}f`}
            {folder.childFolderCount > 0 && folder.fileCount > 0 && " · "}
            {folder.fileCount > 0 && `${folder.fileCount}d`}
          </span>
        )}
        {/* Action menu button */}
        <button
          type="button"
          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition"
          onClick={(e) => { e.stopPropagation(); onContextMenuFolder(e, folder); }}
          title="Folder actions"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="3" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="6" cy="9" r="1"/></svg>
        </button>
      </div>

      {/* Children */}
      {expanded && (
        <div>
          {isLoadingChildren && folder.children.length === 0 && folder.files.length === 0 && (
            <div className="text-[0.65rem] text-gray-400 py-1" style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}>Loading contents...</div>
          )}
          {/* Sub-folders */}
          {folder.children.map(child => (
            <TreeFolderItem
              key={child.id}
              folder={child}
              level={level + 1}
              expanded={expandedIds.has(child.id)}
              onToggle={onToggle}
              selectedFolderId={selectedFolderId}
              selectedFileId={selectedFileId}
              onSelectFolder={onSelectFolder}
              onSelectFile={onSelectFile}
              onContextMenuFolder={onContextMenuFolder}
              onContextMenuFile={onContextMenuFile}
              onDownloadFile={onDownloadFile}
              onDeleteFile={onDeleteFile}
              searchQuery={searchQuery}
              matchedIds={matchedIds}
              expandedIds={expandedIds}
              loadingFolderIds={loadingFolderIds}
            />
          ))}
          {/* Files */}
          {folder.files.map(file => {
            const isSelected = selectedFileId === file.id;
            const fileMatch = searchQuery.length > 0 && (file.title.toLowerCase().includes(searchQuery.toLowerCase()) || file.fileName.toLowerCase().includes(searchQuery.toLowerCase()));
            return (
              <div
                key={file.id}
                className={`flex items-center gap-1 cursor-pointer group transition select-none
                  ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}
                  ${fileMatch ? "bg-yellow-50/60" : ""}`}
                style={{ paddingLeft: `${(level + 1) * 12 + 8}px`, paddingRight: "4px", paddingTop: "4px", paddingBottom: "4px" }}
                onClick={(e) => { e.stopPropagation(); onSelectFile(file); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenuFile(e, file, folder.id); }}
              >
                <span className="w-4 flex-shrink-0" />
                <span className="text-sm flex-shrink-0">{file.fileType?.includes("pdf") ? "📄" : "📃"}</span>
                <span className={`text-xs truncate flex-1 min-w-0 ${isSelected ? "text-blue-800 font-semibold" : "text-gray-600"}`}>{file.title || file.fileName}</span>
                {file.revision && <span className="text-[0.6rem] text-gray-400 bg-gray-100 px-1 rounded flex-shrink-0 mr-1">{file.revision}</span>}
                {/* Download button */}
                <button
                  type="button"
                  className="w-5 h-5 flex items-center justify-center text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded flex-shrink-0"
                  onClick={(e) => { e.stopPropagation(); onDownloadFile(file); }}
                  title="Download"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                {/* Delete button */}
                <button
                  type="button"
                  className="w-5 h-5 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-100 rounded flex-shrink-0"
                  onClick={(e) => { e.stopPropagation(); onDeleteFile(file); }}
                  title="Delete"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3h6M5 3V2h2v1M4 3v7M6 3v7M8 3v7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}, (prev, next) => (
  prev.folder === next.folder &&
  prev.level === next.level &&
  prev.expanded === next.expanded &&
  prev.selectedFolderId === next.selectedFolderId &&
  prev.selectedFileId === next.selectedFileId &&
  prev.searchQuery === next.searchQuery &&
  prev.matchedIds === next.matchedIds &&
  prev.expandedIds === next.expandedIds &&
  prev.loadingFolderIds === next.loadingFolderIds
));

// ═══════════════════════════════════════════════════════════
// PDF Viewer Component
// ═══════════════════════════════════════════════════════════

const PdfViewer = memo(function PdfViewer({ fileId, hasFileData, fileUrl, fileType, title, fileName, onDelete }: { fileId: number; hasFileData: boolean; fileUrl: string | null; fileType: string | null; title: string; fileName: string; onDelete?: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState(false);

  const [isFrameLoading, setIsFrameLoading] = useState(true);
  const previewUrl = useMemo(() => `/api/documents/files/${fileId}/view`, [fileId]);
  const downloadUrl = useMemo(() => `/api/documents/files/${fileId}/download`, [fileId]);
  const externalPreviewUrl = useMemo(() => {
    const candidate = fileUrl?.trim();
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate, window.location.origin);
      if (window.location.protocol === "https:" && parsed.protocol === "http:") return null;
      return parsed.href;
    } catch {
      return null;
    }
  }, [fileUrl]);

  /* Build src — prefer the same-origin streaming route so Chrome receives a real PDF response with inline headers. */
  const src = hasFileData ? previewUrl : externalPreviewUrl;
  const effectiveDownloadUrl = hasFileData ? downloadUrl : externalPreviewUrl;

  const hasData = hasFileData || !!externalPreviewUrl;

  const isHtmlFile = (fileType ?? "").startsWith("text/html") || (fileType ?? "") === "application/xhtml+xml";

  const openLink = useCallback((href: string, download = false) => {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (download) a.download = fileName || title || "document.pdf";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  }, [fileName, title]);

  const handleOpenInNewTab = useCallback(() => {
    if (src) openLink(src);
  }, [openLink, src]);

  const handleDownload = useCallback(() => {
    if (effectiveDownloadUrl) openLink(effectiveDownloadUrl, true);
  }, [effectiveDownloadUrl, openLink]);

  // Safe fallback for HTML/XHTML files — never render them inline in the dashboard shell.
  const HtmlFallbackCard = useCallback(() => {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md text-gray-500 bg-white rounded-lg shadow p-6">
          <div className="text-5xl mb-4">🌐</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-1">HTML Document</h3>
          <p className="text-sm mb-4 break-all" title={fileName}>{fileName}</p>
          <p className="text-xs text-gray-400 mb-4">Type: {fileType || "text/html"}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <button type="button" onClick={handleOpenInNewTab} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 flex items-center gap-2">
              Open
            </button>
            <button type="button" onClick={handleDownload} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold hover:bg-blue-100 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Download
            </button>
          </div>
          {onDelete && (
            <button type="button" onClick={onDelete} className="mt-4 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-100 flex items-center gap-2 mx-auto">
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M3 3h6M5 3V2h2v1M4 3v7M6 3v7M8 3v7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Delete File
            </button>
          )}
        </div>
      </div>
    );
  }, [fileName, fileType, handleOpenInNewTab, handleDownload, onDelete]);

  if (!hasData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md text-gray-400">
          <div className="text-6xl mb-4">📄</div>
          <h3 className="text-lg font-semibold text-gray-500 mb-2">No PDF Available</h3>
          <p className="text-sm">This document has no same-origin file data or secure preview URL attached.<br />Upload a PDF or check the file URL.</p>
          {onDelete && (
            <button type="button" onClick={onDelete} className="mt-4 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-100">
              🗑️ Delete File
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isHtmlFile) {
    return <HtmlFallbackCard />;
  }

  if (loadError || !src) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md text-gray-400">
          <div className="text-5xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-600 mb-2">Cannot Preview PDF</h3>
          <p className="text-sm mb-4">Your browser cannot render this PDF inline.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <button type="button" onClick={handleOpenInNewTab} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 flex items-center gap-2">
              Open PDF in new tab
            </button>
            <button type="button" onClick={handleDownload} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold hover:bg-blue-100 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Download PDF
            </button>
          </div>
          {onDelete && (
            <button type="button" onClick={onDelete} className="mt-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-100 flex items-center gap-2 mx-auto">
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M3 3h6M5 3V2h2v1M4 3v7M6 3v7M8 3v7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Delete File
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 flex-wrap">
        <span className="text-xs font-semibold text-gray-700 truncate flex-1" title={title}>{title}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="px-2 py-1 bg-gray-100 rounded text-xs hover:bg-gray-200 font-bold">−</button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="px-2 py-1 bg-gray-100 rounded text-xs hover:bg-gray-200 font-bold">+</button>
          <button type="button" onClick={() => setZoom(1)} className="px-2 py-1 bg-gray-100 rounded text-xs hover:bg-gray-200">Fit</button>
        </div>
        <button type="button" onClick={handleOpenInNewTab} className="px-2.5 py-1.5 bg-white border border-blue-200 text-blue-600 rounded text-xs hover:bg-blue-50 font-semibold flex items-center gap-1 flex-shrink-0">
          Open PDF in new tab
        </button>
        <button type="button" onClick={handleDownload} className="px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded text-xs hover:bg-blue-100 font-semibold flex items-center gap-1 flex-shrink-0">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Download
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} className="px-2.5 py-1.5 bg-red-50 text-red-600 rounded text-xs hover:bg-red-100 font-semibold flex items-center gap-1 flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3h6M5 3V2h2v1M4 3v7M6 3v7M8 3v7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Delete
          </button>
        )}
      </div>
      {/* PDF viewer using iframe with same-origin preview URL */}
      <div className="flex-1 overflow-auto bg-gray-200 flex items-start justify-center p-4">
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
          <div className="relative w-full h-full bg-white shadow-lg">
            {isFrameLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white">
                <div className="w-16 h-16 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin mb-4" />
                <div className="w-2/3 max-w-sm space-y-3">
                  <div className="h-3 rounded bg-gray-200 animate-pulse" />
                  <div className="h-3 rounded bg-gray-100 animate-pulse" />
                  <div className="h-3 w-3/4 rounded bg-gray-100 animate-pulse" />
                </div>
                <p className="mt-4 text-xs font-semibold text-gray-500">Loading PDF preview...</p>
              </div>
            )}
            <iframe
              src={src}
              title={title}
              loading="lazy"
              className="bg-white"
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
              onLoad={() => { setIsFrameLoading(false); setLoadError(false); }}
              onError={() => { setIsFrameLoading(false); setLoadError(true); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════
// Modal Component
// ═══════════════════════════════════════════════════════════

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <span className="text-sm font-bold text-gray-800">{title}</span>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function OmManualsLibrary() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tree, setTree] = useState<TreeFolder[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [loadedFolderIds, setLoadedFolderIds] = useState<Set<number>>(new Set());
  const [loadingFolderIds, setLoadingFolderIds] = useState<Set<number>>(new Set());
  const inFlightFolderLoads = useRef<Set<number | null>>(new Set());
  const moveFolderSubmissionGuard = useRef(createSubmissionGuard());
  const moveFileSubmissionGuard = useRef(createSubmissionGuard());
  const apiCallCount = useRef(0);
  const initialLoadStartedAt = useRef(performance.now());
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<TreeFile | null>(null);
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const [mobileView, setMobileView] = useState<"tree" | "detail">("tree");
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; items: {label: string; icon: string; onClick: () => void; danger?: boolean}[]} | null>(null);
  const [modal, setModal] = useState<{type: string; folderId?: number; fileId?: number} | null>(null);
  const [modalInput, setModalInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Progress states ──
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState("");

  const utils = trpc.useUtils();

  // ── Fetch only the root folder level on initial page load. Counts and AI context load independently. ──
  const { data: rootContents, isLoading, error: treeError } = trpc.documents.getFolderContents.useQuery({ parentId: null }, {
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
  const { data: stats } = trpc.documents.getStats.useQuery(undefined, {
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: fullTreeData, isFetching: isSearchTreeLoading } = trpc.documents.getTree.useQuery(undefined, {
    enabled: debouncedSearch.length > 2,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const isMoveDialogOpen = modal?.type === "moveFolder" || modal?.type === "moveFile";
  const { data: destinationFolderData, isFetching: isDestinationFoldersLoading } = trpc.documents.getFolderTree.useQuery(undefined, {
    enabled: isMoveDialogOpen,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: aiContext } = trpc.documents.getAiContext.useQuery({ includeSample: true }, {
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });


  useEffect(() => {
    if (!rootContents) return;
    setTree((prev) => mergeFolderSummaries(rootContents.folders, prev));
    setLoadedFolderIds((prev) => new Set(prev).add(-1));
    logTiming("[OM perf] Initial root folder load", {
      durationMs: Math.round(performance.now() - initialLoadStartedAt.current),
      rootFolders: rootContents.folders.length,
      apiCalls: apiCallCount.current + 1,
    });
  }, [rootContents]);

  const loadFolderContents = useCallback(async (parentId: number | null, force = false) => {
    const cacheKey = parentId ?? -1;
    if (!force && loadedFolderIds.has(cacheKey)) return null;
    if (inFlightFolderLoads.current.has(parentId)) return null;

    const startedAt = performance.now();
    inFlightFolderLoads.current.add(parentId);
    if (parentId !== null) {
      setLoadingFolderIds((prev) => new Set(prev).add(parentId));
    }

    try {
      apiCallCount.current += 1;
      const contents = await utils.documents.getFolderContents.fetch({ parentId });
      setTree((prev) => updateFolderContents(prev, parentId, contents.folders, contents.files));
      setLoadedFolderIds((prev) => new Set(prev).add(cacheKey));
      logTiming("[OM perf] Folder contents loaded", {
        parentId,
        durationMs: Math.round(performance.now() - startedAt),
        folders: contents.folders.length,
        files: contents.files.length,
        apiCalls: apiCallCount.current,
      });
      return contents;
    } finally {
      inFlightFolderLoads.current.delete(parentId);
      if (parentId !== null) {
        setLoadingFolderIds((prev) => {
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
      }
    }
  }, [loadedFolderIds, utils]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => window.clearTimeout(handle);
  }, [search]);

  // ── Download file helper ──
  const handleDownloadFile = useCallback((file: TreeFile) => {
    const downloadHref = file.hasFileData ? `/api/documents/files/${file.id}/download` : file.fileUrl?.trim();
    if (!downloadHref) {
      setBanner({ type: "error", message: "No file data available for download" });
      return;
    }

    setIsDownloading(true);
    setDownloadLabel(`Downloading "${file.fileName || file.title}"...`);
    const a = document.createElement("a");
    a.href = downloadHref;
    a.download = file.fileName || file.title || "document.pdf";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      document.body.removeChild(a);
      setIsDownloading(false);
      setBanner({ type: "success", message: `Download started for ${file.fileName || file.title}` });
    }, 250);
  }, []);


  // ── Delete file helper ──
  const handleDeleteFile = useCallback((file: TreeFile) => {
    setSelectedFileId(file.id);
    setModal({ type: "deleteFile", fileId: file.id });
  }, []);

  // ── Refresh helper ──
  const refreshTree = useCallback(async (
    action: string,
    { invalidateAiContext = true }: { invalidateAiContext?: boolean } = {},
  ) => {
    try {
      const invalidations = [
        utils.documents.getFolderContents.invalidate(),
        utils.documents.getFolderTree.invalidate(),
        utils.documents.getStats.invalidate(),
        utils.documents.getTree.invalidate(),
      ];
      if (invalidateAiContext) {
        invalidations.push(utils.documents.getAiContext.invalidate());
      }
      await Promise.all(invalidations);

      const loadedIds = [...loadedFolderIds].filter((id) => id !== -1);
      const [freshRoot] = await Promise.all([
        utils.documents.getFolderContents.fetch({ parentId: null }),
        utils.documents.getStats.fetch(),
      ]);
      setTree((prev) => mergeFolderSummaries(freshRoot.folders, prev));

      await Promise.all(loadedIds.map(async (id) => {
        const contents = await utils.documents.getFolderContents.fetch({ parentId: id });
        setTree((prev) => updateFolderContents(prev, id, contents.folders, contents.files));
      }));

      logTiming("[OM perf] Library refreshed", { action, refreshedFolders: loadedIds.length + 1 });
      return freshRoot;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setBanner({ type: "error", message: `Failed to refresh library tree. ${message}` });
      throw e;
    }
  }, [loadedFolderIds, utils]);

  const refreshTreeRef = useRef(refreshTree);
  refreshTreeRef.current = refreshTree;
  const moveRefreshCoordinator = useMemo(
    () => createTrailingAsyncCoordinator((action: string) => (
      refreshTreeRef.current(action, { invalidateAiContext: false })
    )),
    [],
  );
  const refreshAfterMove = useCallback(
    (action: string) => moveRefreshCoordinator.request(action),
    [moveRefreshCoordinator],
  );

  // ── Mutations ──
  const createFolder = trpc.documents.createFolder.useMutation({
    onMutate: (vars) => { logTiming("[OM perf] Creating folder", { name: vars.name, parentId: vars.parentId ?? null }); },
    onSuccess: async (data) => {
      await refreshTree("createFolder");
      setModal(null);
      setModalInput("");
      setExpandedIds(prev => { const n = new Set(prev); n.add(data.id); return n; });
      setBanner({ type: "success", message: `Folder "${data.name}" created` });
    },
    onError: (e) => { setBanner({ type: "error", message: `Unable to create folder. ${e.message}` }); },
  });
  const renameFolder = trpc.documents.renameFolder.useMutation({
    onSuccess: async () => { await refreshTree("renameFolder"); setModal(null); setModalInput(""); setBanner({ type: "success", message: "Folder renamed" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to rename folder. ${e.message}` }); },
  });
  const deleteFolder = trpc.documents.deleteFolder.useMutation({
    onSuccess: async () => { await refreshTree("deleteFolder"); setSelectedFolderId(null); setBanner({ type: "success", message: "Folder deleted" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to delete folder. ${e.message}` }); },
  });
  const moveFolder = trpc.documents.moveFolder.useMutation({
    onSuccess: async () => { await refreshAfterMove("moveFolder"); setModal(null); setBanner({ type: "success", message: "Folder moved" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to move folder. ${e.message}` }); },
    onSettled: () => { moveFolderSubmissionGuard.current.finish(); },
  });

  const deleteFile = trpc.documents.deleteFile.useMutation({
    onSuccess: async () => { await refreshTree("deleteFile"); setSelectedFileId(null); setSelectedFile(null); setBanner({ type: "success", message: "File deleted" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to delete file. ${e.message}` }); },
  });
  const renameFile = trpc.documents.renameFile.useMutation({
    onSuccess: async () => { await refreshTree("renameFile"); setModal(null); setModalInput(""); setBanner({ type: "success", message: "File renamed" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to rename file. ${e.message}` }); },
  });
  const moveFile = trpc.documents.moveFile.useMutation({
    onSuccess: async () => { await refreshAfterMove("moveFile"); setModal(null); setBanner({ type: "success", message: "File moved" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to move file. ${e.message}` }); },
    onSettled: () => { moveFileSubmissionGuard.current.finish(); },
  });

  const submitMoveFolder = useCallback((parentId: number | null) => {
    if (modal?.folderId === undefined || moveFolder.isPending || !moveFolderSubmissionGuard.current.tryStart()) return;
    moveFolder.mutate({ id: modal.folderId, parentId });
  }, [modal?.folderId, moveFolder]);

  const submitMoveFile = useCallback((folderId: number) => {
    if (modal?.fileId === undefined || moveFile.isPending || !moveFileSubmissionGuard.current.tryStart()) return;
    moveFile.mutate({ id: modal.fileId, folderId });
  }, [modal?.fileId, moveFile]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (selectedFolderId !== null && !folderExists(tree, selectedFolderId)) {
        setSelectedFolderId(null);
        setBanner((prev) => prev ?? { type: "info", message: "Selected folder no longer exists and was cleared." });
      }
      if (selectedFileId !== null && !fileExists(tree, selectedFileId)) {
        setSelectedFileId(null);
        setSelectedFile(null);
        setBanner((prev) => prev ?? { type: "info", message: "Selected file no longer exists and was cleared." });
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, [tree, selectedFolderId, selectedFileId]);

  // ── Search ──
  const searchTree = useMemo(() => fullTreeData?.tree ? markFullTreeLoaded(fullTreeData.tree) : tree, [fullTreeData?.tree, tree]);
  const destinationTree = useMemo(
    () => buildDestinationFolderTree(destinationFolderData?.folders ?? []),
    [destinationFolderData?.folders],
  );
  const destinationOptions = useMemo(
    () => getDestinationFolderOptions(
      destinationTree,
      modal?.type === "moveFolder" ? modal.folderId : undefined,
    ),
    [destinationTree, modal?.folderId, modal?.type],
  );
  const treeForDisplay = debouncedSearch.length > 2 ? searchTree : tree;
  const matchedIds = useMemo(() => debouncedSearch.length > 2 ? getMatchingIds(treeForDisplay, debouncedSearch) : new Set<number>(), [treeForDisplay, debouncedSearch]);
  const displayTree = useMemo(() => debouncedSearch.length > 2 ? filterTree(treeForDisplay, debouncedSearch) : treeForDisplay, [treeForDisplay, debouncedSearch]);
  const counts = useMemo(() => ({ folders: stats?.folders ?? 0, files: stats?.files ?? 0 }), [stats]);

  // ── Toggle expand ──
  const toggle = useCallback((id: number) => {
    const willExpand = !expandedIds.has(id);
    setExpandedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    if (willExpand) {
      void loadFolderContents(id);
    }
  }, [expandedIds, loadFolderContents]);

  const expandAll = useCallback(async () => {
    const startedAt = performance.now();
    const fullTree = await utils.documents.getTree.fetch();
    const loadedTree = markFullTreeLoaded(fullTree.tree);
    setTree(loadedTree);
    setLoadedFolderIds(new Set([-1, ...collectIds(loadedTree)]));
    setExpandedIds(new Set(collectIds(loadedTree)));
    logTiming("[OM perf] Expand all loaded full tree", { durationMs: Math.round(performance.now() - startedAt), folders: fullTree.stats?.folders ?? collectIds(loadedTree).length });
  }, [utils]);
  const collapseAll = useCallback(() => { setExpandedIds(new Set()); }, []);

  const onSelectFile = useCallback((file: TreeFile) => {
    setSelectedFile(file);
    setSelectedFileId(file.id);
    setMobileView("detail");
  }, []);

  // ── Context menus ──
  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folder: TreeFolder) => {
    setSelectedFolderId(folder.id);
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "New Subfolder", icon: "📁", onClick: () => { setModal({ type: "createSubfolder", folderId: folder.id }); setModalInput(""); } },
        { label: "Rename", icon: "✏️", onClick: () => { setModal({ type: "renameFolder", folderId: folder.id }); setModalInput(folder.name); } },
        { label: "Move", icon: "📋", onClick: () => { setModal({ type: "moveFolder", folderId: folder.id }); } },
        { label: "Delete", icon: "🗑️", onClick: () => { setModal({ type: "deleteFolder", folderId: folder.id }); }, danger: true },
      ],
    });
  }, []);

  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: TreeFile) => {
    setSelectedFileId(file.id);
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "View", icon: "👁️", onClick: () => { onSelectFile(file); } },
        { label: "Download", icon: "⬇️", onClick: () => { handleDownloadFile(file); } },
        { label: "Rename", icon: "✏️", onClick: () => { setModal({ type: "renameFile", fileId: file.id }); setModalInput(file.title); } },
        { label: "Move", icon: "📋", onClick: () => { setModal({ type: "moveFile", fileId: file.id }); } },
        { label: "Delete", icon: "🗑️", onClick: () => { setModal({ type: "deleteFile", fileId: file.id }); }, danger: true },
      ],
    });
  }, [handleDownloadFile, onSelectFile]);

  const onSelectFolder = useCallback((id: number) => {
    setSelectedFolderId(id);
    setSelectedFileId(null);
    setSelectedFile(null);
  }, []);

  // ── Handle file upload via multipart POST (avoids base64 JSON overhead and global tRPC body limit) ──
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const targetFolder = selectedFolderId;
    if (!targetFolder) { setBanner({ type: "error", message: "Select a folder first" }); return; }

    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      setBanner({
        type: "error",
        message: MAX_UPLOAD_ERROR_MESSAGE,
      });
      input.value = "";
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadLabel(`Uploading "${file.name}"...`);

    let useStorage: boolean;
    try {
      useStorage = await shouldUseDirectStorage("om");
    } catch (error) {
      setIsUploading(false);
      setUploadProgress(0);
      input.value = "";
      setBanner({ type: "error", message: error instanceof Error ? error.message : "Unable to determine the upload route." });
      return;
    }
    if (useStorage) {
      input.value = "";
      try {
        await uploadFileDirect({
          module: "om",
          file,
          target: { folderId: targetFolder },
          onProgress: (pct) => {
            setUploadProgress(Math.max(5, pct));
            setUploadLabel(`Uploading "${file.name}" directly to Storage... ${pct}%`);
          },
        });
        setUploadProgress(100);
        await refreshTree("storageUploadFile");
        setBanner({ type: "success", message: `File "${file.name}" uploaded` });
        window.setTimeout(() => { setIsUploading(false); setUploadProgress(0); }, 600);
      } catch (error) {
        setIsUploading(false);
        setUploadProgress(0);
        setBanner({ type: "error", message: error instanceof Error ? error.message : "Storage upload failed." });
      }
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("folderId", String(targetFolder));
    formData.append("uploadedBy", "User");

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        setUploadProgress(Math.max(5, pct));
        setUploadLabel(`Uploading "${file.name}"... ${pct}%`);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress(100);
        setTimeout(() => { setIsUploading(false); setUploadProgress(0); }, 600);
        refreshTree("uploadFile");
        setBanner({ type: "success", message: `File "${file.name}" uploaded` });
      } else {
        setIsUploading(false);
        setUploadProgress(0);
        let message = `Upload failed (${xhr.status})`;
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.error) message = data.error;
        } catch {
          // ignore parse failure
        }
        if (xhr.status === 413) message = MAX_UPLOAD_ERROR_MESSAGE;
        setBanner({ type: "error", message });
      }
    });

    xhr.addEventListener("error", () => {
      setIsUploading(false);
      setUploadProgress(0);
      setBanner({ type: "error", message: "Upload failed. Please check your connection and try again." });
    });

    xhr.addEventListener("abort", () => {
      setIsUploading(false);
      setUploadProgress(0);
      setBanner({ type: "info", message: "Upload cancelled." });
    });

    xhr.open("POST", "/api/documents/upload");
    xhr.send(formData);
    input.value = "";
  }, [selectedFolderId, refreshTree]);

  // ── Breadcrumbs ──
  const breadcrumbs = useMemo(() => selectedFolderId ? getFolderPath(tree, selectedFolderId) : [], [tree, selectedFolderId]);

  // ═════════════ RENDER ═════════════
  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {banner && <div className="flex-shrink-0 px-4 pt-3"><Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} /></div>}

      {/* Progress Overlays */}
      <ProgressOverlay visible={isUploading} label={uploadLabel || "Uploading..."} sublabel={uploadLabel.includes("%") ? undefined : "Transferring file to server"} progress={uploadProgress} />
      <ProgressOverlay visible={isDownloading} label={downloadLabel || "Downloading..."} sublabel="Fetching file from server" />

      {/* Header */}
      <header className="flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)" }}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <Link to="/" className="flex items-center gap-3 no-underline text-white">
            <ProgramsEngineeringLogo size={56} borderRadius={8} />
            <div>
              <h1 className="text-base font-bold leading-tight">O&amp;M Manuals Library</h1>
              <p className="text-[0.6rem] opacity-55 uppercase tracking-wider">Document Management System</p>
            </div>
          </Link>
          <div className="flex gap-2">
            <div className="bg-white/10 border border-white/20 rounded px-2.5 py-1.5 text-center">
              <div className="text-sm font-bold">{counts.folders}</div>
              <div className="text-[0.55rem] uppercase opacity-70">Folders</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded px-2.5 py-1.5 text-center">
              <div className="text-sm font-bold">{counts.files}</div>
              <div className="text-[0.55rem] uppercase opacity-70">Files</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL: Tree */}
        <div className={`w-full sm:w-[380px] lg:w-[420px] flex flex-col border-r border-gray-200 bg-white ${mobileView === "detail" ? "hidden sm:flex" : "flex"}`}>
          {/* Toolbar */}
          <div className="flex-shrink-0 p-2.5 border-b border-gray-200 space-y-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#128269;</span>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search folders and files..."
                className="w-full pl-8 pr-7 py-1.5 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
              {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">&#10005;</button>}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" onClick={() => { setModal({ type: "createRootFolder" }); setModalInput(""); }}
                className="px-2 py-1 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1">
                <span>📁</span> New Folder
              </button>
              <button type="button" onClick={() => { if (selectedFolderId) fileInputRef.current?.click(); else setBanner({ type: "info", message: "Select a folder first" }); }}
                className="px-2 py-1 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1">
                <span>📤</span> Upload
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.svg,.webp,.txt,.csv,.json,.zip,.html,.htm,.xhtml" className="hidden" onChange={handleFileUpload} />
              <button type="button" onClick={expandAll} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-semibold hover:bg-gray-200">Expand</button>
              <button type="button" onClick={collapseAll} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-semibold hover:bg-gray-200">Collapse</button>
              {search && <button type="button" onClick={() => setSearch("")} className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100">Clear</button>}
            </div>
            {/* Selected folder actions */}
            {selectedFolderId && !selectedFileId && (() => {
              const folder = getFolderPath(tree, selectedFolderId).pop();
              return folder ? (
                <div className="flex gap-1.5 flex-wrap">
                  <button type="button" onClick={() => { setModal({ type: "createSubfolder", folderId: selectedFolderId }); setModalInput(""); }}
                    className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded text-xs font-semibold hover:bg-blue-100 flex items-center gap-1">
                    <span>📁</span> New Subfolder
                  </button>
                  <button type="button" onClick={() => { setModal({ type: "renameFolder", folderId: selectedFolderId }); setModalInput(folder.name); }}
                    className="px-2 py-1 bg-white border border-gray-300 text-gray-700 rounded text-xs font-semibold hover:bg-gray-50 flex items-center gap-1">
                    <span>✏️</span> Rename
                  </button>
                  <button type="button" onClick={() => { setModal({ type: "deleteFolder", folderId: selectedFolderId }); }}
                    className="px-2 py-1 bg-white border border-gray-300 text-red-600 rounded text-xs font-semibold hover:bg-red-50 flex items-center gap-1">
                    <span>🗑️</span> Delete
                  </button>
                </div>
              ) : null;
            })()}
            {/* Selected file actions */}
            {selectedFile && selectedFileId && (
              <div className="flex gap-1.5 flex-wrap">
                <button type="button" onClick={() => handleDownloadFile(selectedFile)}
                  className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded text-xs font-semibold hover:bg-blue-100 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Download
                </button>
                <button type="button" onClick={() => setModal({ type: "deleteFile", fileId: selectedFile.id })}
                  className="px-2 py-1 bg-white border border-gray-300 text-red-600 rounded text-xs font-semibold hover:bg-red-50 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3h6M5 3V2h2v1M4 3v7M6 3v7M8 3v7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Delete
                </button>
              </div>
            )}
            {breadcrumbs.length > 0 && (
              <div className="flex items-center gap-1 text-[0.65rem] text-gray-500 flex-wrap">
                {breadcrumbs.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 && <span className="text-gray-300 mx-0.5">/</span>}
                    <span className="text-gray-600 font-medium">{b.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto py-1">
            {isSearchTreeLoading && debouncedSearch.length > 2 && (
              <div className="px-3 py-1 text-[0.65rem] text-blue-600 bg-blue-50 border-b border-blue-100">Searching full library...</div>
            )}
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading root folders...</div>
            ) : treeError ? (
              <div className="flex items-center justify-center py-16 text-red-600 text-sm">Failed to load library: {treeError.message}</div>
            ) : displayTree.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-3xl mb-2">📂</div>
                <div className="text-sm font-semibold text-gray-600">No folders yet</div>
                <button type="button" onClick={() => { setModal({ type: "createRootFolder" }); setModalInput(""); }}
                  className="mt-3 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700">Create First Folder</button>
              </div>
            ) : (
              displayTree.map(folder => (
                <TreeFolderItem
                  key={folder.id}
                  folder={folder}
                  level={0}
                  expanded={expandedIds.has(folder.id)}
                  onToggle={toggle}
                  selectedFolderId={selectedFolderId}
                  selectedFileId={selectedFileId}
                  onSelectFolder={onSelectFolder}
                  onSelectFile={onSelectFile}
                  onContextMenuFolder={handleFolderContextMenu}
                  onContextMenuFile={handleFileContextMenu}
                  onDownloadFile={handleDownloadFile}
                  onDeleteFile={handleDeleteFile}
                  searchQuery={search}
                  matchedIds={matchedIds}
                  expandedIds={expandedIds}
                  loadingFolderIds={loadingFolderIds}
                />
              ))
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Viewer */}
        <div className={`flex-1 flex-col bg-gray-100 overflow-hidden ${mobileView === "detail" ? "flex" : "hidden sm:flex"}`}>
          {/* Mobile back */}
          <button type="button" onClick={() => setMobileView("tree")} className="sm:hidden flex items-center gap-1 text-xs text-blue-600 font-semibold px-4 py-2 bg-white border-b border-gray-200">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M7.5 9.5L4 6L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back to tree
          </button>

          {selectedFile ? (
            <PdfViewer
              key={selectedFile.id}
              fileId={selectedFile.id}
              hasFileData={selectedFile.hasFileData}
              fileUrl={selectedFile.fileUrl}
              fileType={selectedFile.fileType}
              title={selectedFile.title}
              fileName={selectedFile.fileName || "document.pdf"}
              onDelete={() => setModal({ type: "deleteFile", fileId: selectedFile.id })}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md text-gray-400">
                <div className="text-6xl mb-4">📁</div>
                <h3 className="text-lg font-semibold text-gray-500 mb-2">Document Library</h3>
                <p className="text-sm">Select a file from the folder tree to view it here.<br />Right-click folders or files for more options.</p>
                {counts.folders === 0 && (
                  <button type="button" onClick={() => { setModal({ type: "createRootFolder" }); setModalInput(""); }}
                    className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">Create First Folder</button>
                )}
              </div>
              </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}

      {/* Modals */}
      {modal?.type === "createRootFolder" && (
        <Modal title="New Folder" onClose={() => setModal(null)}>
          <input type="text" value={modalInput} onChange={e => setModalInput(e.target.value)}
            placeholder="Folder name" autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none" />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
            <button type="button" disabled={createFolder.isPending || !modalInput.trim()} onClick={() => { createFolder.mutate({ name: modalInput.trim() }); }}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">{createFolder.isPending ? "Creating..." : "Create"}</button>
          </div>
        </Modal>
      )}

      {modal?.type === "createSubfolder" && (
        <Modal title="New Subfolder" onClose={() => setModal(null)}>
          <input type="text" value={modalInput} onChange={e => setModalInput(e.target.value)}
            placeholder="Subfolder name" autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none" />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
            <button type="button" disabled={createFolder.isPending || !modalInput.trim()} onClick={() => { createFolder.mutate({ name: modalInput.trim(), parentId: modal.folderId }); }}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">{createFolder.isPending ? "Creating..." : "Create"}</button>
          </div>
        </Modal>
      )}

      {modal?.type === "renameFolder" && (
        <Modal title="Rename Folder" onClose={() => setModal(null)}>
          <input type="text" value={modalInput} onChange={e => setModalInput(e.target.value)}
            placeholder="Folder name" autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none" />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
            <button type="button" disabled={renameFolder.isPending || !modalInput.trim()} onClick={() => renameFolder.mutate({ id: modal.folderId!, name: modalInput.trim() })}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">{renameFolder.isPending ? "Renaming..." : "Rename"}</button>
          </div>
        </Modal>
      )}

      {modal?.type === "renameFile" && (
        <Modal title="Rename File" onClose={() => setModal(null)}>
          <input type="text" value={modalInput} onChange={e => setModalInput(e.target.value)}
            placeholder="File title" autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 outline-none" />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
            <button type="button" disabled={renameFile.isPending || !modalInput.trim()} onClick={() => renameFile.mutate({ id: modal.fileId!, title: modalInput.trim() })}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">{renameFile.isPending ? "Renaming..." : "Rename"}</button>
          </div>
        </Modal>
      )}

      {modal?.type === "deleteFolder" && (
        <Modal title="Delete Folder?" onClose={() => setModal(null)}>
          <p className="text-sm text-gray-600">This will permanently delete the folder and all its contents (subfolders and files). This action cannot be undone.</p>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
            <button type="button" disabled={deleteFolder.isPending} onClick={() => { deleteFolder.mutate({ id: modal.folderId! }); setModal(null); }}
              className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">{deleteFolder.isPending ? "Deleting..." : "Delete"}</button>
          </div>
        </Modal>
      )}

      {modal?.type === "deleteFile" && (
        <Modal title="Delete File?" onClose={() => setModal(null)}>
          <p className="text-sm text-gray-600">This will permanently delete the file. This action cannot be undone.</p>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
            <button type="button" disabled={deleteFile.isPending} onClick={async () => {
              const file = findFileById(tree, modal.fileId!);
              setModal(null);
              if (file?.storageBacked) {
                try {
                  await deleteFileWithVerification("doc_files", file.id);
                  await refreshTree("deleteStorageFile");
                  setSelectedFileId(null); setSelectedFile(null);
                  setBanner({ type: "success", message: "File deleted" });
                } catch (error) {
                  setBanner({ type: "error", message: error instanceof Error ? error.message : "Unable to delete file." });
                }
              } else {
                deleteFile.mutate({ id: modal.fileId! });
              }
            }}
              className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">{deleteFile.isPending ? "Deleting..." : "Delete"}</button>
          </div>
        </Modal>
      )}

      {modal?.type === "moveFolder" && (
        <Modal title="Move Folder" onClose={() => { if (!moveFolder.isPending) setModal(null); }}>
          <p className="text-xs text-gray-500 mb-2">Select a destination folder:</p>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
            <button type="button" disabled={moveFolder.isPending} onClick={() => submitMoveFolder(null)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-700 font-semibold border-b border-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">📁 {moveFolder.isPending ? "Moving..." : "Root (top level)"}</button>
            {isDestinationFoldersLoading && destinationOptions.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-500">Loading destination folders...</p>
            )}
            {!isDestinationFoldersLoading && destinationOptions.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-500">No other destination folders available.</p>
            )}
            {destinationOptions.map(({ id, label }) => (
              <button type="button" key={id} disabled={moveFolder.isPending} onClick={() => submitMoveFolder(id)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-600 border-b border-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">{label}</button>
            ))}
          </div>
        </Modal>
      )}

      {modal?.type === "moveFile" && (
        <Modal title="Move File" onClose={() => { if (!moveFile.isPending) setModal(null); }}>
          <p className="text-xs text-gray-500 mb-2">Select a destination folder:</p>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
            {isDestinationFoldersLoading && destinationOptions.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-500">Loading destination folders...</p>
            )}
            {!isDestinationFoldersLoading && destinationOptions.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-500">No destination folders available.</p>
            )}
            {destinationOptions.map(({ id, label }) => (
              <button type="button" key={id} disabled={moveFile.isPending} onClick={() => submitMoveFile(id)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-600 border-b border-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">{label}</button>
            ))}
          </div>
        </Modal>
      )}

      {/* AI Assistant */}
      <AIAssistant
        contextType="manuals"
        data={{ folders: counts.folders, files: counts.files, tree }}
        metadata={{ aiContext, sourceModule: "O&M Manual Governance", sourceRecordId: "om-manuals-library", sourceRecordLabel: "O&M Manuals Library" }}
        title="O&M Governance AI"
        position="bottom-right"
        quickQuestions={[
          "Which facility types (WTP/WWTP/WPS/WWLS) have missing manuals?",
          "What is the approval status distribution of manuals?",
          "Which manuals appear obsolete or overdue?",
          "Which manuals have multiple revisions and what is likely the latest revision?",
          "Summarize document completeness by facility.",
          "Which facilities have the most documents?",
          "How many PDFs are available in the library?",
        ]}
      />
    </div>
  );
}
