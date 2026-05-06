import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ID: z.string().min(1, "APP_ID is required"),
  APP_SECRET: z.string().min(1, "APP_SECRET is required"),
  ownerUnionId: z.string().optional(),
  kimiAuthUrl: z.string().default("https://auth.kimi.com"),
  kimiOpenUrl: z.string().default("https://open.kimi.com"),
});

function createEnv() {
  const raw = {
    DATABASE_URL: process.env.DATABASE_URL,
    APP_ID: process.env.APP_ID,
    APP_SECRET: process.env.APP_SECRET,
    ownerUnionId: process.env.OWNER_UNION_ID,
    kimiAuthUrl: process.env.KIMI_AUTH_URL,
    kimiOpenUrl: process.env.KIMI_OPEN_URL,
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`[env] Missing or invalid env vars:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = createEnv();
