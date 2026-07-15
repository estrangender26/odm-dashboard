import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ID: z.string().min(1, "APP_ID is required"),
  APP_SECRET: z.string().min(1, "APP_SECRET is required"),
  ownerUnionId: z.string().optional(),
  kimiAuthUrl: z.string().default("https://auth.kimi.com"),
  kimiOpenUrl: z.string().default("https://open.kimi.com"),
  supabaseUrl: z.string().url().optional(),
  supabaseServiceRoleKey: z.string().min(1).optional(),
  supabaseStorageUrl: z.string().url().optional(),
});

function createEnv() {
  const raw = {
    DATABASE_URL: process.env.DATABASE_URL,
    APP_ID: process.env.APP_ID,
    APP_SECRET: process.env.APP_SECRET,
    ownerUnionId: process.env.OWNER_UNION_ID,
    kimiAuthUrl: process.env.KIMI_AUTH_URL,
    kimiOpenUrl: process.env.KIMI_OPEN_URL,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseStorageUrl: process.env.SUPABASE_STORAGE_URL,
  };
  const parsed = schema.safeParse(raw);
  const result = parsed.success ? parsed.data : (parsed.data || raw as any);
  
  // Add isProduction flag
  (result as any).isProduction = process.env.NODE_ENV === "production";
  
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.warn(`[env] Missing or invalid env vars (app may not work correctly):\n${issues}`);
  }
  
  return result;
}

export const env = createEnv();
