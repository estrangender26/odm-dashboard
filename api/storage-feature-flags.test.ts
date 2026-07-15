import { describe, expect, it } from "vitest";
import { getStorageFeatureFlags, isStorageUploadEnabled } from "./storage-feature-flags";

function flags(values: Record<string, string> = {}) {
  return getStorageFeatureFlags(values as NodeJS.ProcessEnv);
}

describe("Supabase Storage upload rollback flags", () => {
  it("defaults every module to the legacy path", () => {
    const value = flags();
    expect(value).toEqual({ global: false, om: false, governance: false, smp: false });
    expect(isStorageUploadEnabled("om", value)).toBe(false);
    expect(isStorageUploadEnabled("governance", value)).toBe(false);
    expect(isStorageUploadEnabled("smp", value)).toBe(false);
  });

  it("keeps every module legacy when only the global flag is enabled", () => {
    const value = flags({ SUPABASE_STORAGE_UPLOADS_ENABLED: "true" });
    expect(isStorageUploadEnabled("om", value)).toBe(false);
    expect(isStorageUploadEnabled("governance", value)).toBe(false);
    expect(isStorageUploadEnabled("smp", value)).toBe(false);
  });

  it.each([
    ["om", "SUPABASE_STORAGE_OM_ENABLED"],
    ["governance", "SUPABASE_STORAGE_GOVERNANCE_ENABLED"],
    ["smp", "SUPABASE_STORAGE_SMP_ENABLED"],
  ] as const)("enables only %s when its module flag is enabled", (module, variable) => {
    const value = flags({ SUPABASE_STORAGE_UPLOADS_ENABLED: "on", [variable]: "yes" });
    expect(isStorageUploadEnabled(module, value)).toBe(true);
    for (const other of ["om", "governance", "smp"] as const) {
      if (other !== module) expect(isStorageUploadEnabled(other, value)).toBe(false);
    }
  });

  it("immediately returns every module to legacy when the global flag is disabled", () => {
    const value = flags({
      SUPABASE_STORAGE_UPLOADS_ENABLED: "false",
      SUPABASE_STORAGE_OM_ENABLED: "true",
      SUPABASE_STORAGE_GOVERNANCE_ENABLED: "true",
      SUPABASE_STORAGE_SMP_ENABLED: "true",
    });
    expect(isStorageUploadEnabled("om", value)).toBe(false);
    expect(isStorageUploadEnabled("governance", value)).toBe(false);
    expect(isStorageUploadEnabled("smp", value)).toBe(false);
  });
});
