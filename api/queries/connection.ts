import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[DB] DATABASE_URL not set!");
    throw new Error("DATABASE_URL not set");
  }
  
  console.log("[DB] Connecting to database...");
  const client = postgres(databaseUrl, {
    ssl: "require",
    prepare: false,
    max_lifetime: 60,
  });
  
  _db = drizzle(client, { schema });
  console.log("[DB] Connected!");
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return getDb()[prop as keyof typeof _db];
  },
});

export type DrizzleDB = ReturnType<typeof getDb>;
