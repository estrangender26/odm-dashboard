export const STORAGE_MODULES = ["om", "governance", "smp", "lihok-corporate"] as const;
export type StorageModule = (typeof STORAGE_MODULES)[number];

export const STORAGE_BUCKET_BY_MODULE: Record<StorageModule, string> = {
  om: "om-manuals",
  governance: "om-governance",
  smp: "smp-library",
  "lihok-corporate": "lihok-corporate-library",
};

export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;
export const STORAGE_SIGNED_URL_TTL_SECONDS = 120;
export const STORAGE_UPLOAD_INTENT_TTL_MS = 2 * 60 * 60 * 1000;

export type StorageFeatureFlags = {
  global: boolean;
  om: boolean;
  governance: boolean;
  smp: boolean;
  lihokCorporate: boolean;
};

export type StorageFileSource =
  | "doc_files"
  | "governance_uploads"
  | "governance_files"
  | "smp_documents"
  | "lihok_corporate_document_versions";
