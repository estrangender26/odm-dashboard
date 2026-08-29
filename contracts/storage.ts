export const STORAGE_MODULES = ["om", "governance", "smp", "projects_without_ppp"] as const;
export type StorageModule = (typeof STORAGE_MODULES)[number];

export const STORAGE_BUCKET_BY_MODULE: Record<StorageModule, string> = {
  om: "om-manuals",
  governance: "om-governance",
  smp: "smp-library",
  projects_without_ppp: "projects-without-ppp",
};

export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;
export const STORAGE_SIGNED_URL_TTL_SECONDS = 120;
export const STORAGE_UPLOAD_INTENT_TTL_MS = 2 * 60 * 60 * 1000;

export type StorageFeatureFlags = {
  global: boolean;
  om: boolean;
  governance: boolean;
  smp: boolean;
  projects_without_ppp: boolean;
};

export type StorageFileSource =
  | "doc_files"
  | "governance_uploads"
  | "governance_files"
  | "smp_documents"
  | "smp_document_revisions"
  | "project_without_ppp_files";
