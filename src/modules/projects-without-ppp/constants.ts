export const MODULE_TITLE = "Projects without PPP — Masterdata Submittal Monitoring";
export const MODULE_SHORT_TITLE = "Projects without PPP";
export const MODULE_ROUTE = "/projects-without-ppp";

export const STORAGE_MODULE = "projects_without_ppp" as const;
export const STORAGE_SOURCE = "project_without_ppp_files" as const;
export const STORAGE_BUCKET = "projects-without-ppp" as const;
export const STORAGE_FLAG_ENV =
  "SUPABASE_STORAGE_PROJECTS_WITHOUT_PPP_ENABLED" as const;

export const MASTERDATA_ALLOWED_EXTENSIONS = ["xlsx", "xls", "pdf"] as const;

export const MASTERDATA_MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  xls: ["application/vnd.ms-excel"],
  pdf: ["application/pdf"],
};

export const SUBMISSION_STATUS_LABELS = {
  submitted: "Submitted",
  not_submitted: "Not Submitted",
} as const;

export const LS_PS_LABELS = {
  yes: "With LS/PS",
  no: "No LS/PS",
} as const;

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
