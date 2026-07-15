import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./lib/env";

let client: SupabaseClient | null = null;

export function getSupabaseStorageConfig() {
  const url = env.supabaseUrl?.replace(/\/$/, "");
  const serviceRoleKey = env.supabaseServiceRoleKey;
  const directStorageUrl = env.supabaseStorageUrl?.replace(/\/$/, "");
  if (!url || !serviceRoleKey || !directStorageUrl) {
    throw new Error(
      "Supabase Storage is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_URL.",
    );
  }
  return { url, serviceRoleKey, directStorageUrl };
}

export function getSupabaseStorageAdmin(): SupabaseClient {
  if (client) return client;
  const config = getSupabaseStorageConfig();
  client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
