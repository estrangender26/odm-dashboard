import type { StorageFeatureFlags, StorageModule } from "@contracts/storage";

export function parseBooleanFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function getStorageFeatureFlags(
  source: NodeJS.ProcessEnv = process.env,
): StorageFeatureFlags {
  return {
    global: parseBooleanFlag(source.SUPABASE_STORAGE_UPLOADS_ENABLED),
    om: parseBooleanFlag(source.SUPABASE_STORAGE_OM_ENABLED),
    governance: parseBooleanFlag(source.SUPABASE_STORAGE_GOVERNANCE_ENABLED),
    smp: parseBooleanFlag(source.SUPABASE_STORAGE_SMP_ENABLED),
  };
}

const MODULE_FLAG_KEY: Record<StorageModule, keyof StorageFeatureFlags> = {
  om: "om",
  governance: "governance",
  smp: "smp",
};

export function isStorageUploadEnabled(
  module: StorageModule,
  flags: StorageFeatureFlags = getStorageFeatureFlags(),
): boolean {
  return flags.global && flags[MODULE_FLAG_KEY[module]];
}
