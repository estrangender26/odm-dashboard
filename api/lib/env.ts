import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  appId: z.string().min(1, "APP_ID is required"),
  appSecret: z.string().min(1, "APP_SECRET is required"),
  ownerUnionId: z.string().optional(),
  kimiAuthUrl: z.string().default("https://auth.kimi.com"),
  kimiOpenUrl: z.string().default("https://open.kimi.com"),
});

export function createEnv(source: NodeJS.ProcessEnv = process.env) {
  const raw = {
    DATABASE_URL: source.DATABASE_URL,
    appId: source.APP_ID,
    appSecret: source.APP_SECRET,
    ownerUnionId: source.OWNER_UNION_ID,
    kimiAuthUrl: source.KIMI_AUTH_URL,
    kimiOpenUrl: source.KIMI_OPEN_URL,
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
