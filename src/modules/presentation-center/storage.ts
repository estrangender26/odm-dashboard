import type { GeneratedPresentation, UploadedPresentation } from "./types";
import {
  deletePresentationFile,
  getPresentationFileDownloadUrl,
  listPresentationFiles,
  renamePresentationFile,
  replacePresentationFile,
  saveGeneratedPresentationFile,
  uploadPresentationFile,
} from "./presentationFilesApi";

const ALL_DATES_SCOPE = "all-dates";

function getDateScopeLabel(deck: GeneratedPresentation): string {
  if (deck.dateFrom || deck.dateTo) {
    return `${deck.dateFrom ?? ""}|${deck.dateTo ?? ""}`;
  }
  if (deck.reportingYear && deck.reportingMonth) {
    return `${deck.reportingYear}-${String(deck.reportingMonth).padStart(2, "0")}`;
  }
  return ALL_DATES_SCOPE;
}

export function getGeneratedPresentationDedupeKey(
  deck: GeneratedPresentation
): string {
  return [
    deck.generatorId ?? "unknown",
    deck.generatorName ?? deck.type ?? "unknown",
    deck.filename ?? deck.name,
    getDateScopeLabel(deck),
    deck.businessUnit ?? deck.facility ?? "all",
    deck.template ?? "default",
  ].join("::");
}

export function deduplicateGeneratedPresentations(
  items: GeneratedPresentation[]
): GeneratedPresentation[] {
  const newestFirst = [...items].sort((a, b) => {
    const aTime = new Date(a.generatedAt ?? a.generatedDate).getTime();
    const bTime = new Date(b.generatedAt ?? b.generatedDate).getTime();
    return bTime - aTime;
  });
  const unique = new Map<string, GeneratedPresentation>();
  for (const deck of newestFirst) {
    const key = getGeneratedPresentationDedupeKey(deck);
    if (!unique.has(key)) {
      unique.set(key, deck);
    }
  }
  return Array.from(unique.values());
}

export function mergeGeneratedPresentation(
  existing: GeneratedPresentation[],
  deck: GeneratedPresentation
): GeneratedPresentation[] {
  const key = getGeneratedPresentationDedupeKey(deck);
  const filtered = existing.filter(
    item => getGeneratedPresentationDedupeKey(item) !== key
  );
  return [deck, ...filtered];
}

function apiFileToUploaded(row: {
  id: number;
  fileName: string;
  displayName: string;
  fileSizeBytes: number;
  fileCategory: string;
  uploadedBy: string;
  createdAt: string;
}): UploadedPresentation {
  return {
    id: String(row.id),
    name: row.displayName || row.fileName,
    uploadDate: row.createdAt,
    uploadedBy: row.uploadedBy,
    size: row.fileSizeBytes,
    category: mapApiCategoryToPresentationCategory(row.fileCategory),
    dataUrl: getPresentationFileDownloadUrl(row.id),
  };
}

function mapApiCategoryToPresentationCategory(
  category: string
): UploadedPresentation["category"] {
  switch (category) {
    case "generated_deck":
      return "Monthly KPI Scorecard";
    case "uploaded_deck":
    default:
      return "Uploaded Deck";
  }
}

function generatedDeckToApiPayload(deck: GeneratedPresentation) {
  const scope: Record<string, unknown> = {};
  if (deck.reportingYear) scope.reportingYear = deck.reportingYear;
  if (deck.reportingMonth) scope.reportingMonth = deck.reportingMonth;
  if (deck.businessUnit) scope.businessUnit = deck.businessUnit;
  if (deck.facility) scope.facility = deck.facility;
  if (deck.dateFrom) scope.dateFrom = deck.dateFrom;
  if (deck.dateTo) scope.dateTo = deck.dateTo;
  if (deck.equipmentType) scope.equipmentType = deck.equipmentType;
  if (deck.category) scope.category = deck.category;
  if (deck.inspector) scope.inspector = deck.inspector;

  return {
    file_name: deck.filename ?? deck.name,
    display_name: deck.name,
    file_size_bytes: deck.size,
    file_blob: deck.dataUrl,
    sha256_hash: "",
    generator_id: deck.generatorId,
    generator_name: deck.generatorName,
    template: deck.template,
    scope_json: scope,
    uploaded_by: deck.generatedBy,
  };
}

function apiFileToGenerated(row: {
  id: number;
  fileName: string;
  displayName: string;
  fileSizeBytes: number;
  fileCategory: string;
  generatorId?: string | null;
  generatorName?: string | null;
  template?: string | null;
  scopeJson?: string | null;
  uploadedBy: string;
  createdAt: string;
}): GeneratedPresentation {
  const scope: Partial<GeneratedPresentation> = {};
  if (row.scopeJson) {
    try {
      const parsed = JSON.parse(row.scopeJson) as Record<string, unknown>;
      if (parsed.reportingYear) scope.reportingYear = Number(parsed.reportingYear);
      if (parsed.reportingMonth) scope.reportingMonth = Number(parsed.reportingMonth);
      if (parsed.businessUnit) scope.businessUnit = String(parsed.businessUnit);
      if (parsed.facility) scope.facility = String(parsed.facility);
      if (parsed.dateFrom) scope.dateFrom = String(parsed.dateFrom);
      if (parsed.dateTo) scope.dateTo = String(parsed.dateTo);
      if (parsed.equipmentType) scope.equipmentType = String(parsed.equipmentType);
      if (parsed.category) scope.category = String(parsed.category);
      if (parsed.inspector) scope.inspector = String(parsed.inspector);
    } catch {
      // ignore parse errors
    }
  }

  return {
    id: String(row.id),
    name: row.displayName || row.fileName,
    type: row.generatorName || "Generated Deck",
    generatedDate: row.createdAt,
    generatedBy: row.uploadedBy,
    size: row.fileSizeBytes,
    dataUrl: getPresentationFileDownloadUrl(row.id),
    generatorId: row.generatorId ?? undefined,
    generatorName: row.generatorName ?? undefined,
    template: row.template ?? undefined,
    filename: row.fileName,
    generatedAt: row.createdAt,
    ...scope,
  };
}

export async function createUploadedPresentation(
  file: File,
  context: {
    category: UploadedPresentation["category"];
    uploadedBy?: string;
  }
): Promise<{ deck?: UploadedPresentation; error?: string }> {
  try {
    const apiFile = await uploadPresentationFile(file, {
      fileCategory: mapPresentationCategoryToApiCategory(context.category),
      uploadedBy: context.uploadedBy,
    });
    return {
      deck: apiFileToUploaded({
        ...apiFile,
        fileCategory: mapPresentationCategoryToApiCategory(context.category),
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return { error: message };
  }
}

export async function getUploadedPresentations(): Promise<UploadedPresentation[]> {
  try {
    const files = await listPresentationFiles({ fileCategory: "uploaded_deck" });
    return files.map(apiFileToUploaded);
  } catch (error) {
    console.error("[PresentationCenter] Failed to load uploaded files", error);
    return [];
  }
}

export async function uploadFileToLibrary(
  file: File,
  category: UploadedPresentation["category"]
): Promise<UploadedPresentation> {
  const apiFile = await uploadPresentationFile(file, {
    fileCategory: "uploaded_deck",
  });
  return apiFileToUploaded({
    ...apiFile,
    fileCategory: mapPresentationCategoryToApiCategory(category),
  });
}

function mapPresentationCategoryToApiCategory(
  category: UploadedPresentation["category"]
): "uploaded_deck" | "generated_deck" {
  switch (category) {
    case "Monthly KPI Scorecard":
      return "generated_deck";
    case "Uploaded Deck":
    default:
      return "uploaded_deck";
  }
}

export async function saveUploadedPresentations(
  items: UploadedPresentation[]
): Promise<void> {
  // Upload any items that are not already API-backed (IDs that look like UUIDs are new local items)
  const newItems = items.filter(
    item => !/^[0-9]+$/.test(item.id) && item.dataUrl.startsWith("data:")
  );
  for (const item of newItems) {
    try {
      const blob = dataUrlToBlob(item.dataUrl);
      const file = new File([blob], item.name, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
      await uploadPresentationFile(file, {
        fileCategory: mapPresentationCategoryToApiCategory(item.category),
        uploadedBy: item.uploadedBy,
      });
    } catch (error) {
      console.error("[PresentationCenter] Failed to sync uploaded file to API", error);
    }
  }
}

export async function getGeneratedPresentations(): Promise<GeneratedPresentation[]> {
  try {
    const files = await listPresentationFiles({ fileCategory: "generated_deck" });
    return files.map(apiFileToGenerated);
  } catch (error) {
    console.error("[PresentationCenter] Failed to load generated presentations", error);
    return [];
  }
}

export async function saveGeneratedPresentations(
  items: GeneratedPresentation[]
): Promise<void> {
  const deduped = deduplicateGeneratedPresentations(items).slice(0, 25);
  for (const deck of deduped) {
    try {
      await saveGeneratedPresentationFile(generatedDeckToApiPayload(deck));
    } catch (error) {
      console.error("[PresentationCenter] Failed to sync generated deck to API", error);
    }
  }
}

export async function cleanupGeneratedPresentationsHistory(): Promise<GeneratedPresentation[]> {
  return getGeneratedPresentations();
}

export async function cleanupUploadedPresentationsHistory(): Promise<UploadedPresentation[]> {
  return getUploadedPresentations();
}

export function validateUploadedFileName(value: string): {
  valid: boolean;
  error?: string;
  sanitized?: string;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: "File name cannot be blank." };
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return { valid: false, error: "File name cannot contain paths." };
  }
  if (!trimmed.toLowerCase().endsWith(".pptx")) {
    return { valid: false, error: "File name must keep the .pptx extension." };
  }
  return { valid: true, sanitized: trimmed };
}

export async function renameUploadedPresentation(
  items: UploadedPresentation[],
  id: string,
  nextName: string
): Promise<{ items: UploadedPresentation[]; error?: string }> {
  const validation = validateUploadedFileName(nextName);
  if (!validation.valid) {
    return { items, error: validation.error };
  }
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return { items, error: "Invalid file id." };
  }
  try {
    const updated = await renamePresentationFile(numericId, nextName);
    const next = items.map(item =>
      item.id === id ? apiFileToUploaded({ ...updated, fileCategory: mapPresentationCategoryToApiCategory(item.category) }) : item
    );
    return { items: next };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rename failed.";
    return { items, error: message };
  }
}

export async function replaceUploadedPresentation(
  items: UploadedPresentation[],
  id: string,
  file: File,
  keepName = false
): Promise<{ items: UploadedPresentation[]; error?: string }> {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return { items, error: "Invalid file id." };
  }
  try {
    const updated = await replacePresentationFile(numericId, file, keepName);
    const next = items.map(item =>
      item.id === id ? apiFileToUploaded({ ...updated, fileCategory: mapPresentationCategoryToApiCategory(item.category) }) : item
    );
    return { items: next };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replace failed.";
    return { items, error: message };
  }
}

export async function deleteUploadedPresentation(
  items: UploadedPresentation[],
  id: string
): Promise<UploadedPresentation[]> {
  const numericId = Number(id);
  if (Number.isInteger(numericId)) {
    try {
      await deletePresentationFile(numericId);
    } catch (error) {
      console.error("[PresentationCenter] Failed to delete uploaded file", error);
    }
  }
  return items.filter(item => item.id !== id);
}

export async function clearGeneratedPresentationsHistory(): Promise<GeneratedPresentation[]> {
  // Soft delete generated deck rows is not implemented here to avoid mass-deletes;
  // this helper just returns an empty list for the UI state.
  return [];
}

export async function deleteGeneratedPresentation(
  items: GeneratedPresentation[],
  id: string
): Promise<GeneratedPresentation[]> {
  const numericId = Number(id);
  if (Number.isInteger(numericId)) {
    try {
      await deletePresentationFile(numericId);
    } catch (error) {
      console.error("[PresentationCenter] Failed to delete generated presentation", error);
    }
  }
  return items.filter(item => item.id !== id);
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, payload] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] || "application/octet-stream";
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  // If dataUrl is an API download URL, navigate to it; otherwise use the inline blob fallback.
  if (dataUrl.startsWith("/api/")) {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }
  const blob = dataUrlToBlob(dataUrl);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
