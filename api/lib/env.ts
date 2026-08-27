import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  appSecret: z.string().min(1, "APP_SECRET is required"),
  googleOAuthClientId: z.string().optional(),
  googleOAuthClientSecret: z.string().optional(),
  ownerGoogleSub: z.string().optional(),
  supabaseUrl: z.string().url().optional(),
  supabaseServiceRoleKey: z.string().min(1).optional(),
  supabaseStorageUrl: z.string().url().optional(),
});

export function createEnv(source: NodeJS.ProcessEnv = process.env) {
  const raw = {
    DATABASE_URL: source.DATABASE_URL,
    appSecret: source.APP_SECRET,
    googleOAuthClientId: source.GOOGLE_OAUTH_CLIENT_ID,
    googleOAuthClientSecret: source.GOOGLE_OAUTH_CLIENT_SECRET,
    ownerGoogleSub: source.OWNER_GOOGLE_SUB,
    supabaseUrl: source.SUPABASE_URL,
    supabaseServiceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY,
    supabaseStorageUrl: source.SUPABASE_STORAGE_URL,
  };
  const parsed = schema.safeParse(raw);
  const result = parsed.success ? parsed.data : (parsed.data || raw as any);
  
  // Add isProduction flag
  (result as any).isProduction = source.NODE_ENV === "production";
  
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.warn(`[env] Missing or invalid env vars (app may not work correctly):\n${issues}`);
  }
  
  return result;
}

export const env = createEnv();
