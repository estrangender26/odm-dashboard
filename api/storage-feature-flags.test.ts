import { describe, expect, it } from "vitest";
import { getStorageFeatureFlags, isStorageUploadEnabled } from "./storage-feature-flags";

function flags(values: Record<string, string> = {}) {
  return getStorageFeatureFlags(values as NodeJS.ProcessEnv);
}

const ALL_MODULES = ["om", "governance", "smp", "projects_without_ppp"] as const;

describe("Supabase Storage upload rollback flags", () => {
  it("defaults every module to the legacy path", () => {
    const value = flags();
    expect(value).toEqual({
      global: false,
      om: false,
      governance: false,
      smp: false,
      projects_without_ppp: false,
    });
    for (const module of ALL_MODULES) {
      expect(isStorageUploadEnabled(module, value)).toBe(false);
    }
  });

  it("keeps every module legacy when only the global flag is enabled", () => {
    const value = flags({ SUPABASE_STORAGE_UPLOADS_ENABLED: "true" });
    for (const module of ALL_MODULES) {
      expect(isStorageUploadEnabled(module, value)).toBe(false);
    }
  });

  it.each([
    ["om", "SUPABASE_STORAGE_OM_ENABLED"],
    ["governance", "SUPABASE_STORAGE_GOVERNANCE_ENABLED"],
    ["smp", "SUPABASE_STORAGE_SMP_ENABLED"],
    ["projects_without_ppp", "SUPABASE_STORAGE_PROJECTS_WITHOUT_PPP_ENABLED"],
  ] as const)("enables only %s when its module flag is enabled", (module, variable) => {
    const value = flags({ SUPABASE_STORAGE_UPLOADS_ENABLED: "on", [variable]: "yes" });
    expect(isStorageUploadEnabled(module, value)).toBe(true);
    for (const other of ALL_MODULES) {
      if (other !== module) expect(isStorageUploadEnabled(other, value)).toBe(false);
    }
  });

  it("immediately returns every module to legacy when the global flag is disabled", () => {
    const value = flags({
      SUPABASE_STORAGE_UPLOADS_ENABLED: "false",
      SUPABASE_STORAGE_OM_ENABLED: "true",
      SUPABASE_STORAGE_GOVERNANCE_ENABLED: "true",
      SUPABASE_STORAGE_SMP_ENABLED: "true",
      SUPABASE_STORAGE_PROJECTS_WITHOUT_PPP_ENABLED: "true",
    });
    for (const module of ALL_MODULES) {
      expect(isStorageUploadEnabled(module, value)).toBe(false);
    }
  });

  it.each([
    ["om", "SUPABASE_STORAGE_OM_ENABLED"],
    ["governance", "SUPABASE_STORAGE_GOVERNANCE_ENABLED"],
    ["smp", "SUPABASE_STORAGE_SMP_ENABLED"],
    ["projects_without_ppp", "SUPABASE_STORAGE_PROJECTS_WITHOUT_PPP_ENABLED"],
  ] as const)("returns %s uploads to legacy when its module flag is turned off", (module, variable) => {
    const enabled = flags({ SUPABASE_STORAGE_UPLOADS_ENABLED: "true", [variable]: "true" });
    expect(isStorageUploadEnabled(module, enabled)).toBe(true);
    const disabled = flags({ SUPABASE_STORAGE_UPLOADS_ENABLED: "true", [variable]: "false" });
    expect(isStorageUploadEnabled(module, disabled)).toBe(false);
  });

  it("has no database or Storage deletion side effects", () => {
    const enabled = flags({ SUPABASE_STORAGE_UPLOADS_ENABLED: "true", SUPABASE_STORAGE_OM_ENABLED: "true" });
    const disabled = flags({ SUPABASE_STORAGE_UPLOADS_ENABLED: "false", SUPABASE_STORAGE_OM_ENABLED: "true" });
    expect(enabled).toEqual({ global: true, om: true, governance: false, smp: false, projects_without_ppp: false });
    expect(disabled).toEqual({ global: false, om: true, governance: false, smp: false, projects_without_ppp: false });
  });
});
