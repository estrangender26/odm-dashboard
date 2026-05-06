import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL not set");

// Create postgres client with SSL (required for Supabase)
const client = postgres(databaseUrl, {
  ssl: "require",
  prepare: false,
  max_lifetime: 60,
});

export const db = drizzle(client, { schema });
export type DrizzleDB = typeof db;
