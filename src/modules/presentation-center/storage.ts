import type { GeneratedPresentation, UploadedPresentation } from "./types";

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

const UPLOADED_KEY = "odm.presentationCenter.uploadedDecks";
const GENERATED_KEY = "odm.presentationCenter.generatedDecks";

function readCollection<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch (error) {
    console.error(`[PresentationCenter] Failed to read ${key}`, error);
    return [];
  }
}

function writeCollection<T>(key: string, items: T[]) {
  window.localStorage.setItem(key, JSON.stringify(items));
}

export function getUploadedPresentations() {
  return readCollection<UploadedPresentation>(UPLOADED_KEY);
}

export function saveUploadedPresentations(items: UploadedPresentation[]) {
  writeCollection(UPLOADED_KEY, items);
}

export function getGeneratedPresentations() {
  return readCollection<GeneratedPresentation>(GENERATED_KEY);
}

export function cleanupGeneratedPresentationsHistory() {
  const items = readCollection<GeneratedPresentation>(GENERATED_KEY);
  const deduped = deduplicateGeneratedPresentations(items);
  if (deduped.length !== items.length) {
    writeCollection(GENERATED_KEY, deduped);
  }
  return deduped;
}

export function saveGeneratedPresentations(items: GeneratedPresentation[]) {
  const deduped = deduplicateGeneratedPresentations(items);
  writeCollection(GENERATED_KEY, deduped.slice(0, 25));
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
