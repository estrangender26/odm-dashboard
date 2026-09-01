import type { SmpStatus } from "./types";

/** Formats a byte count for display ("1.2 MB"). */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

/** Formats a date-ish value (ISO string, Date, or "YYYY-MM-DD") for display. */
export function formatSmpDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export function revisionStatusBadge(status: SmpStatus | string | null) {
  if (status === "current") return { bg: "#D1FAE5", text: "#047857", label: "Current" };
  if (status === "superseded") return { bg: "#E2E8F0", text: "#475569", label: "Superseded" };
  return { bg: "#E2E8F0", text: "#475569", label: status || "—" };
}

/** Legacy document-level status colors (kept for backward-compatible rows). */
export function legacyStatusBadge(status: string | null | undefined) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    "Active": { bg: "#D1FAE5", text: "#059669", label: "Active" },
    "Under Review": { bg: "#FEF3C7", text: "#D97706", label: "Under Review" },
    "Expired": { bg: "#FEE2E2", text: "#DC2626", label: "Expired" },
    "Draft": { bg: "#E2E8F0", text: "#475569", label: "Draft" },
  };
  const fallback = { bg: "#F1F5F9", text: "#64748B", label: status || "—" };
  return map[status || ""] || fallback;
}

/** Normalizes an HTML date input value to a stored date string. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}


export type SmpExtractedSection = {
  sectionKey: string;
  title: string;
  body: string;
  position: number;
};

export type SmpExtractedTask = {
  category: string;
  responsibilityType?: string;
  maintenanceClass?: string;
  taskText: string;
  frequency?: string;
  toolsMaterials?: string;
  safetyControls?: string;
  fieldCaptureData?: string[];
  escalationTrigger?: string;
  failureMode?: string;
  applicabilityTags?: string[];
  displayOrder: number;
};

export type SmpExtractionResult = {
  code: string | null;
  smpId: string | null;
  title: string | null;
  smpFamily: string | null;
  revision: string | null;
  effectivityDate: string | null;
  assetName: string | null;
  assetType: string | null;
  equipmentType: string | null;
  facilityType: string | null;
  criticality: string | null;
  documentOwner: string | null;
  preparedBy: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;
  applicability: string[];
  sections: SmpExtractedSection[];
  tasks: SmpExtractedTask[];
  warnings: string[];
  isEmpty: boolean;
};

/** Uploads a PDF to the server for metadata/section/task extraction. */
export async function extractSmpPdf(file: File): Promise<{ extraction: SmpExtractionResult }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/smp/extract", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Extraction failed (${response.status}).`);
  }
  return data;
}
