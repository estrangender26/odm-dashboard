import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.hpfcwqyoxbndfwzbhrbz:COGF6I3w1Ij6UitG@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";

async function setup() {
  console.log("Connecting...");
  const sql = postgres(DATABASE_URL, { ssl: "require", prepare: false, max_lifetime: 60 });
  console.log("Connected!");

  await sql`CREATE TABLE IF NOT EXISTS "governance_files" (
    "id" serial PRIMARY KEY,
    "facility_slug" varchar(50) NOT NULL,
    "milestone_id" varchar(10) NOT NULL,
    "toc_item" varchar(20),
    "file_name" varchar(255) NOT NULL,
    "file_type" varchar(50) NOT NULL,
    "file_size" integer,
    "file_data" text NOT NULL,
    "uploaded_by" varchar(255),
    "uploaded_at" timestamp DEFAULT now()
  )`;
  console.log("governance_files table created");

  await sql`CREATE INDEX IF NOT EXISTS "gov_files_facility_idx" ON "governance_files"("facility_slug", "milestone_id")`;
  console.log("Index created");

  await sql.end();
  console.log("Done!");
}

setup().catch((e) => { console.error("Error:", e.message); process.exit(1); });
