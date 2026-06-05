import type { GeneratedPresentation, UploadedPresentation } from "./types";

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

export function saveGeneratedPresentations(items: GeneratedPresentation[]) {
  writeCollection(GENERATED_KEY, items.slice(0, 25));
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
