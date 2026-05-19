import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface TreeFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  children: TreeFolder[];
  files: TreeFile[];
}

interface TreeFile {
  id: number;
  title: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  revision: string | null;
  uploadedAt: Date | null;
}

interface DocFileFull {
  id: number;
  folderId: number;
  title: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  fileData: string | null;
  fileUrl: string | null;
  description: string | null;
  revision: string | null;
  tags: string | null;
  uploadedBy: string | null;
  uploadedAt: Date | null;
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

function countItems(folders: TreeFolder[]): { folders: number; files: number } {
  let fc = 0, fl = 0;
  function walk(fs: TreeFolder[]) {
    for (const f of fs) {
      fc++;
      fl += f.files.length;
      walk(f.children);
    }
  }
  walk(folders);
  return { folders: fc, files: fl };
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

// Download a file to browser
function triggerDownload(data: string, mime: string, filename: string) {
  const a = document.createElement("a");
  a.href = `data:${mime};base64,${data}`;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 100);
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

function TreeFolderItem({
  folder, level, expanded, onToggle,
  selectedFolderId, selectedFileId, onSelectFolder, onSelectFile,
  onContextMenuFolder, onContextMenuFile,
  onDownloadFile, onDeleteFile,
  searchQuery, matchedIds,
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
}) {
  const hasContent = folder.children.length > 0 || folder.files.length > 0;
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
          {hasContent ? <Chevron expanded={expanded} /> : <span className="w-2" />}
        </button>
        <span className="text-sm flex-shrink-0">{expanded ? "📂" : "📁"}</span>
        <span className={`text-xs font-semibold truncate flex-1 ${selectedFolderId === folder.id ? "text-blue-800" : "text-gray-700"}`}>{folder.name}</span>
        {(folder.children.length > 0 || folder.files.length > 0) && (
          <span className="text-[0.6rem] text-gray-400 flex-shrink-0 mr-1">
            {folder.children.length > 0 && `${folder.children.length}f`}
            {folder.children.length > 0 && folder.files.length > 0 && " · "}
            {folder.files.length > 0 && `${folder.files.length}d`}
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
          {/* Sub-folders */}
          {folder.children.map(child => (
            <TreeFolderItem
              key={child.id}
              folder={child}
              level={level + 1}
              expanded={true}
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
}

// ═══════════════════════════════════════════════════════════
// PDF Viewer Component
// ═══════════════════════════════════════════════════════════

function PdfViewer({ fileData, fileUrl, title, fileName, onDelete }: { fileData: string | null; fileUrl: string | null; title: string; fileName: string; onDelete?: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const embedRef = useRef<HTMLEmbedElement>(null);

  const src = useMemo(() => {
    if (fileData) return `data:application/pdf;base64,${fileData}`;
    if (fileUrl) return fileUrl;
    return null;
  }, [fileData, fileUrl]);

  const handleDownload = useCallback(() => {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = fileName || title || "document.pdf";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  }, [src, fileName, title]);

  useEffect(() => {
    setLoadError(false);
  }, [src]);

  if (!src) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md text-gray-400">
          <div className="text-6xl mb-4">📄</div>
          <h3 className="text-lg font-semibold text-gray-500 mb-2">No PDF Available</h3>
          <p className="text-sm">This document has no file data attached.</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md text-gray-400">
          <div className="text-5xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-600 mb-2">Cannot Preview PDF</h3>
          <p className="text-sm mb-4">Your browser cannot render this PDF inline.</p>
          <button
            type="button"
            onClick={handleDownload}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 flex items-center gap-2 mx-auto"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Download PDF
          </button>
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
      {/* PDF embed with zoom via CSS transform */}
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
          <embed
            ref={embedRef}
            src={src}
            type="application/pdf"
            title={title}
            className="bg-white shadow-lg"
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            onError={() => setLoadError(true)}
          />
        </div>
      </div>
    </div>
  );
}

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
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [selectedFileData, setSelectedFileData] = useState<DocFileFull | null>(null);
  const [banner, setBanner] = useState<{type: "error" | "success" | "info"; message: string} | null>(null);
  const [mobileView, setMobileView] = useState<"tree" | "detail">("tree");
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; items: {label: string; icon: string; onClick: () => void; danger?: boolean}[]} | null>(null);
  const [modal, setModal] = useState<{type: string; folderId?: number; fileId?: number} | null>(null);
  const [modalInput, setModalInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch tree ──
  const { data: treeData, isLoading } = trpc.documents.getTree.useQuery();
  const tree = treeData?.tree || [];
  const utils = trpc.useUtils();

  // ── Fetch single file for viewer ──
  const { data: fileDetail } = trpc.documents.getFile.useQuery(
    { id: selectedFileId! },
    { enabled: !!selectedFileId }
  );

  useEffect(() => {
    if (fileDetail) setSelectedFileData(fileDetail);
  }, [fileDetail]);

  // ── Download file helper ──
  const handleDownloadFile = useCallback((file: TreeFile) => {
    if (selectedFileData && selectedFileData.id === file.id && selectedFileData.fileData) {
      triggerDownload(selectedFileData.fileData, file.fileType || "application/pdf", file.fileName || file.title || "document.pdf");
      setBanner({ type: "info", message: `Downloading ${file.fileName}...` });
    } else {
      setSelectedFileId(file.id);
      setBanner({ type: "info", message: `Loading ${file.fileName} for download...` });
      utils.documents.getFile.fetch({ id: file.id }).then((data) => {
        if (data?.fileData) {
          triggerDownload(data.fileData, file.fileType || "application/pdf", file.fileName || file.title || "document.pdf");
          setBanner({ type: "success", message: `Downloaded ${file.fileName}` });
        } else if (data?.fileUrl) {
          const a = document.createElement("a");
          a.href = data.fileUrl;
          a.download = file.fileName || file.title || "document.pdf";
          a.target = "_blank";
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 100);
          setBanner({ type: "success", message: `Downloaded ${file.fileName}` });
        } else {
          setBanner({ type: "error", message: "No file data available for download" });
        }
      }).catch((e: any) => {
        setBanner({ type: "error", message: `Download failed: ${e.message}` });
      });
    }
  }, [selectedFileData, utils]);

  // ── Delete file helper ──
  const handleDeleteFile = useCallback((file: TreeFile) => {
    setSelectedFileId(file.id);
    setModal({ type: "deleteFile", fileId: file.id });
  }, []);

  // ── Refresh helper ──
  const refreshTree = useCallback(async (action: string) => {
    console.log(`[OM] Refreshing tree after: ${action}`);
    await utils.documents.getTree.invalidate();
    const fresh = await utils.documents.getTree.fetch();
    console.log(`[OM] Tree refreshed. Folders: ${fresh?.tree?.length ?? 0}, total items: ${fresh?.count ?? 0}`);
  }, [utils]);

  // ── Mutations ──
  const createFolder = trpc.documents.createFolder.useMutation({
    onMutate: (vars) => { console.log(`[OM] Creating folder: name="${vars.name}", parentId=${vars.parentId ?? "null (root)"}`); },
    onSuccess: (data) => {
      console.log(`[OM] Folder created: id=${data.id}, name="${data.name}", parentId=${data.parentId ?? "null"}`);
      refreshTree("createFolder");
      setModal(null);
      setModalInput("");
      setExpandedIds(prev => { const n = new Set(prev); n.add(data.id); return n; });
      setBanner({ type: "success", message: `Folder "${data.name}" created` });
    },
    onError: (e) => { console.error("[OM] Create folder failed:", e.message); setBanner({ type: "error", message: `Unable to create folder. ${e.message}` }); },
  });
  const renameFolder = trpc.documents.renameFolder.useMutation({
    onSuccess: () => { refreshTree("renameFolder"); setModal(null); setModalInput(""); setBanner({ type: "success", message: "Folder renamed" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to rename folder. ${e.message}` }); },
  });
  const deleteFolder = trpc.documents.deleteFolder.useMutation({
    onSuccess: () => { refreshTree("deleteFolder"); setSelectedFolderId(null); setBanner({ type: "success", message: "Folder deleted" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to delete folder. ${e.message}` }); },
  });
  const moveFolder = trpc.documents.moveFolder.useMutation({
    onSuccess: () => { refreshTree("moveFolder"); setBanner({ type: "success", message: "Folder moved" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to move folder. ${e.message}` }); },
  });
  const uploadFile = trpc.documents.uploadFile.useMutation({
    onSuccess: (data) => { refreshTree("uploadFile"); setBanner({ type: "success", message: `File "${data.title}" uploaded` }); },
    onError: (e) => { setBanner({ type: "error", message: `Upload failed. ${e.message}` }); },
  });
  const deleteFile = trpc.documents.deleteFile.useMutation({
    onSuccess: () => { refreshTree("deleteFile"); setSelectedFileId(null); setSelectedFileData(null); setBanner({ type: "success", message: "File deleted" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to delete file. ${e.message}` }); },
  });
  const renameFile = trpc.documents.renameFile.useMutation({
    onSuccess: () => { refreshTree("renameFile"); setModal(null); setModalInput(""); setBanner({ type: "success", message: "File renamed" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to rename file. ${e.message}` }); },
  });
  const moveFile = trpc.documents.moveFile.useMutation({
    onSuccess: () => { refreshTree("moveFile"); setBanner({ type: "success", message: "File moved" }); },
    onError: (e) => { setBanner({ type: "error", message: `Unable to move file. ${e.message}` }); },
  });

  // ── Search ──
  const matchedIds = useMemo(() => search.length > 2 ? getMatchingIds(tree, search) : new Set<number>(), [tree, search]);
  const displayTree = useMemo(() => search.length > 2 ? filterTree(tree, search) : tree, [tree, search]);
  const counts = useMemo(() => countItems(tree), [tree]);

  // ── Toggle expand ──
  const toggle = useCallback((id: number) => {
    setExpandedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const expandAll = useCallback(() => { setExpandedIds(new Set(collectIds(tree))); }, [tree]);
  const collapseAll = useCallback(() => { setExpandedIds(new Set()); }, []);

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

  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: TreeFile, _folderId: number) => {
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
  }, [handleDownloadFile]);

  const onSelectFile = useCallback((file: TreeFile) => {
    setSelectedFileId(file.id);
    setSelectedFileData(null);
    setMobileView("detail");
  }, []);

  const onSelectFolder = useCallback((id: number) => {
    setSelectedFolderId(id);
    setSelectedFileId(null);
    setSelectedFileData(null);
  }, []);

  // ── Handle file upload ──
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const targetFolder = selectedFolderId;
    if (!targetFolder) { setBanner({ type: "error", message: "Select a folder first" }); return; }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadFile.mutate({
        folderId: targetFolder,
        title: file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        fileType: file.type || "application/pdf",
        fileSize: file.size,
        fileData: base64,
        uploadedBy: "User",
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [selectedFolderId, uploadFile]);

  // ── Breadcrumbs ──
  const breadcrumbs = useMemo(() => selectedFolderId ? getFolderPath(tree, selectedFolderId) : [], [tree, selectedFolderId]);

  // ═════════════ RENDER ═════════════
  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {banner && <div className="flex-shrink-0 px-4 pt-3"><Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} /></div>}

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
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xlsx" className="hidden" onChange={handleFileUpload} />
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
            {selectedFileData && selectedFileId && (
              <div className="flex gap-1.5 flex-wrap">
                <button type="button" onClick={() => handleDownloadFile({ id: selectedFileData.id, title: selectedFileData.title, fileName: selectedFileData.fileName, fileType: selectedFileData.fileType, fileSize: selectedFileData.fileSize, revision: selectedFileData.revision, uploadedAt: selectedFileData.uploadedAt })}
                  className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded text-xs font-semibold hover:bg-blue-100 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v5M4 6l2 2 2-2M3 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Download
                </button>
                <button type="button" onClick={() => setModal({ type: "deleteFile", fileId: selectedFileData.id })}
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
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading document library...</div>
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

          {selectedFileData ? (
            <PdfViewer
              fileData={selectedFileData.fileData}
              fileUrl={selectedFileData.fileUrl}
              title={selectedFileData.title}
              fileName={selectedFileData.fileName || "document.pdf"}
              onDelete={() => { if (selectedFileData) setModal({ type: "deleteFile", fileId: selectedFileData.id }); }}
            />
          ) : selectedFileId && !selectedFileData ? (
            <div className="flex-1 flex items-center justify-center"><div className="text-gray-400 text-sm">Loading document...</div></div>
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
            <button type="button" disabled={createFolder.isPending || !modalInput.trim()} onClick={() => { console.log(`[OM] Create button: name="${modalInput.trim()}"`); createFolder.mutate({ name: modalInput.trim() }); }}
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
            <button type="button" disabled={createFolder.isPending || !modalInput.trim()} onClick={() => { console.log(`[OM] Create subfolder: name="${modalInput.trim()}", parentId=${modal.folderId}`); createFolder.mutate({ name: modalInput.trim(), parentId: modal.folderId }); }}
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
            <button type="button" disabled={deleteFile.isPending} onClick={() => { deleteFile.mutate({ id: modal.fileId! }); setModal(null); }}
              className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">{deleteFile.isPending ? "Deleting..." : "Delete"}</button>
          </div>
        </Modal>
      )}

      {modal?.type === "moveFolder" && (
        <Modal title="Move Folder" onClose={() => setModal(null)}>
          <p className="text-xs text-gray-500 mb-2">Select a destination folder:</p>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
            <button type="button" onClick={() => { moveFolder.mutate({ id: modal.folderId!, parentId: null }); setModal(null); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-700 font-semibold border-b border-gray-100">📁 Root (top level)</button>
            {collectIds(tree).filter(id => id !== modal.folderId).map(id => {
              const path = getFolderPath(tree, id);
              const name = path.map(p => p.name).join(" / ");
              return (
                <button type="button" key={id} onClick={() => { moveFolder.mutate({ id: modal.folderId!, parentId: id }); setModal(null); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-600 border-b border-gray-50">{name}</button>
              );
            })}
          </div>
        </Modal>
      )}

      {modal?.type === "moveFile" && (
        <Modal title="Move File" onClose={() => setModal(null)}>
          <p className="text-xs text-gray-500 mb-2">Select a destination folder:</p>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
            {collectIds(tree).map(id => {
              const path = getFolderPath(tree, id);
              const name = path.map(p => p.name).join(" / ");
              return (
                <button type="button" key={id} onClick={() => { moveFile.mutate({ id: modal.fileId!, folderId: id }); setModal(null); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-600 border-b border-gray-50">{name}</button>
              );
            })}
          </div>
        </Modal>
      )}

      {/* AI Assistant */}
      <AIAssistant
        contextType="maintenance"
        data={{ folders: counts.folders, files: counts.files, tree }}
        quickQuestions={[
          "Which facilities have the most documents?",
          "Which folders have no files?",
          "What is the overall document coverage?",
          "Which facilities lack manuals?",
          "Summarize the document library.",
          "Which folders need more documents?",
        ]}
      />
    </div>
  );
}
