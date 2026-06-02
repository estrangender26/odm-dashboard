import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.hpfcwqyoxbndfwzbhrbz:COGF6I3w1Ij6UitG@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";

async function setup() {
  console.log("Connecting...");
  const sql = postgres(DATABASE_URL, { ssl: "require", prepare: false, max_lifetime: 60 });
  console.log("Connected!");

  // Create tables
  await sql`CREATE TABLE IF NOT EXISTS "users" (
    "id" serial PRIMARY KEY,
    "name" varchar(255) NOT NULL,
    "email" varchar(255) NOT NULL UNIQUE,
    "avatar" varchar(500),
    "role" varchar(50) NOT NULL DEFAULT 'user',
    "union_id" varchar(255),
    "created_at" timestamp DEFAULT now(),
    "last_sign_in_at" timestamp DEFAULT now()
  )`;
  console.log("users table created");

  await sql`CREATE TABLE IF NOT EXISTS "equipment" (
    "id" serial PRIMARY KEY,
    "name" varchar(255) NOT NULL,
    "initials" varchar(10) NOT NULL
  )`;
  console.log("equipment table created");

  await sql`CREATE TABLE IF NOT EXISTS "tasks" (
    "id" serial PRIMARY KEY,
    "equipment_id" bigint NOT NULL,
    "task_list" text NOT NULL,
    "frequency" varchar(100) NOT NULL,
    "responsible_personnel" varchar(100),
    "operations" varchar(100),
    "amd" varchar(100),
    "ard" varchar(100),
    "procedure_familiarity" varchar(50),
    "dataset" varchar(20) NOT NULL
  )`;
  await sql`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "procedure_familiarity" varchar(50)`;
  console.log("tasks table created");

  await sql`CREATE TABLE IF NOT EXISTS "governance_facilities" (
    "id" serial PRIMARY KEY,
    "slug" varchar(50) NOT NULL UNIQUE,
    "name" varchar(255) NOT NULL,
    "short_name" varchar(100)
  )`;
  console.log("governance_facilities table created");

  await sql`CREATE TABLE IF NOT EXISTS "governance_milestone_state" (
    "id" serial PRIMARY KEY,
    "facility_slug" varchar(50) NOT NULL,
    "milestone_id" varchar(10) NOT NULL,
    "ppp_date" varchar(20),
    "comp_date" varchar(20),
    "custom_pct" integer,
    "ready_status" varchar(20),
    "remarks" text,
    "updated_at" timestamp DEFAULT now(),
    "updated_by" varchar(255),
    UNIQUE("facility_slug", "milestone_id")
  )`;
  console.log("governance_milestone_state table created");

  await sql`CREATE TABLE IF NOT EXISTS "governance_uploads" (
    "id" serial PRIMARY KEY,
    "facility_slug" varchar(50) NOT NULL,
    "milestone_id" varchar(10) NOT NULL,
    "category" varchar(50) NOT NULL,
    "toc_item" varchar(20),
    "file_name" varchar(255) NOT NULL,
    "file_url" text NOT NULL,
    "uploaded_by" varchar(255),
    "uploaded_at" timestamp DEFAULT now()
  )`;
  console.log("governance_uploads table created");

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS "equipment_name_idx" ON "equipment"("name")`;
  await sql`CREATE INDEX IF NOT EXISTS "tasks_equipment_idx" ON "tasks"("equipment_id")`;
  await sql`CREATE INDEX IF NOT EXISTS "tasks_dataset_idx" ON "tasks"("dataset")`;
  await sql`CREATE INDEX IF NOT EXISTS "tasks_familiarity_idx" ON "tasks"("procedure_familiarity")`;
  console.log("Indexes created");

  await sql.end();
  console.log("All tables ready!");
}

setup().catch((e) => { console.error("Error:", e.message); process.exit(1); });
