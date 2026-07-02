import type { PresentationCategory } from "./types";

export type PresentationFileCategory = "uploaded_deck" | "generated_deck";

export type PresentationFileMetadata = {
  id: number;
  fileName: string;
  displayName: string;
  title?: string | null;
  version?: string | null;
  fileType: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Hash: string;
  fileCategory: PresentationFileCategory;
  generatorId?: string | null;
  generatorName?: string | null;
  template?: string | null;
  scopeJson?: string | null;
  originalFileUrl?: string | null;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type PresentationFileListResponse = {
  files: PresentationFileMetadata[];
};

const API_BASE = "/api/presentation-files";

export async function listPresentationFiles(
  filters: {
    fileCategory?: PresentationFileCategory;
    generatorId?: string;
    includeDeleted?: boolean;
  } = {}
): Promise<PresentationFileMetadata[]> {
  const params = new URLSearchParams();
  if (filters.fileCategory) params.set("file_category", filters.fileCategory);
  if (filters.generatorId) params.set("generator_id", filters.generatorId);
  if (filters.includeDeleted) params.set("include_deleted", "true");

  const query = params.toString();
  const url = query ? `${API_BASE}?${query}` : API_BASE;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("Failed to load presentation files.");
  }
  const data = (await response.json()) as PresentationFileListResponse;
  return data.files ?? [];
}

export async function uploadPresentationFile(
  file: File,
  options: {
    fileCategory?: PresentationFileCategory;
    uploadedBy?: string;
    title?: string;
    version?: string;
  } = {}
): Promise<PresentationFileMetadata> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("file_category", options.fileCategory ?? "uploaded_deck");
  if (options.uploadedBy) formData.append("uploaded_by", options.uploadedBy);
  if (options.title) formData.append("title", options.title);
  if (options.version) formData.append("version", options.version);

  const response = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      data.error ?? `Upload failed (${response.status}). Please try again.`
    );
  }
  const data = (await response.json()) as { file: PresentationFileMetadata };
  return data.file;
}

export async function renamePresentationFile(
  id: number,
  displayName: string
): Promise<PresentationFileMetadata> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Rename failed.");
  }
  const data = (await response.json()) as { file: PresentationFileMetadata };
  return data.file;
}

export async function replacePresentationFile(
  id: number,
  file: File,
  keepDisplayName = false
): Promise<PresentationFileMetadata> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("keep_display_name", keepDisplayName ? "true" : "false");

  const response = await fetch(`${API_BASE}/${id}/replace`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Replace failed.");
  }
  const data = (await response.json()) as { file: PresentationFileMetadata };
  return data.file;
}

export async function deletePresentationFile(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Delete failed.");
  }
}

export async function getPresentationFileDeletePreview(id: number): Promise<{
  id: number;
  fileName: string;
  displayName: string;
  fileType: string;
  fileSizeBytes: number;
  fileCategory: PresentationFileCategory;
  uploadedBy: string;
  createdAt: string;
  linkedRecords: number;
  whatWillBeRemoved: string;
  whatWillNotBeRemoved: string;
}> {
  const response = await fetch(`${API_BASE}/${id}/delete-preview`);
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Delete preview failed.");
  }
  return (await response.json()) as {
    id: number;
    fileName: string;
    displayName: string;
    fileType: string;
    fileSizeBytes: number;
    fileCategory: PresentationFileCategory;
    uploadedBy: string;
    createdAt: string;
    linkedRecords: number;
    whatWillBeRemoved: string;
    whatWillNotBeRemoved: string;
  };
}

export function getPresentationFileDownloadUrl(id: number): string {
  return `${API_BASE}/${id}/download`;
}

export async function saveGeneratedPresentationFile(
  payload: {
    file_name: string;
    display_name?: string;
    file_size_bytes: number;
    file_blob: string;
    sha256_hash: string;
    generator_id?: string;
    generator_name?: string;
    template?: string;
    scope_json?: Record<string, unknown>;
    uploaded_by?: string;
  }
): Promise<PresentationFileMetadata> {
  const response = await fetch(`${API_BASE}/generated`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to save generated deck.");
  }
  const data = (await response.json()) as { file: PresentationFileMetadata };
  return data.file;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function presentationCategoryLabel(category: string): PresentationCategory {
  switch (category) {
    case "generated_deck":
      return "Monthly KPI Scorecard"; // fallback; caller should provide exact mapping
    case "uploaded_deck":
    default:
      return "Uploaded Deck";
  }
}
