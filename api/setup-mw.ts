import postgres from "postgres";

const DATABASE_URL = "postgresql://postgres.hpfcwqyoxbndfwzbhrbz:COGF6I3w1Ij6UitG@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";

async function setup() {
  console.log("Connecting to database...");
  const sql = postgres(DATABASE_URL, { ssl: "require", prepare: false, max_lifetime: 60 });
  console.log("Connected!");

  // Create MW tables
  await sql`CREATE TABLE IF NOT EXISTS "mw_inspections" (
    "id" serial PRIMARY KEY,
    "facility_id" varchar(50) NOT NULL,
    "inspector" varchar(255) NOT NULL,
    "category" varchar(100) NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "score" integer,
    "findings" text,
    "date" varchar(20),
    "updated_by" varchar(255),
    "updated_at" timestamp DEFAULT now()
  )`;
  console.log("mw_inspections table created");

  await sql`CREATE TABLE IF NOT EXISTS "mw_compliance" (
    "id" serial PRIMARY KEY,
    "facility_id" varchar(50) NOT NULL,
    "standard" varchar(255) NOT NULL,
    "compliant" varchar(10) NOT NULL DEFAULT 'no',
    "notes" text,
    "updated_by" varchar(255),
    "updated_at" timestamp DEFAULT now()
  )`;
  console.log("mw_compliance table created");

  await sql`CREATE TABLE IF NOT EXISTS "mw_escalations" (
    "id" serial PRIMARY KEY,
    "facility_id" varchar(50) NOT NULL,
    "issue" varchar(255) NOT NULL,
    "severity" varchar(20) NOT NULL DEFAULT 'low',
    "status" varchar(20) NOT NULL DEFAULT 'open',
    "assigned_to" varchar(255),
    "resolution" text,
    "updated_by" varchar(255),
    "updated_at" timestamp DEFAULT now()
  )`;
  console.log("mw_escalations table created");

  // Seed governance milestone state if empty
  const existing = await sql`SELECT COUNT(*) as count FROM governance_milestone_state`;
  if (existing[0].count === '0') {
    const facilities = ['aglipay', 'htt', 'eastbay', 'kaysakat'];
    const milestones = ['M1','M2','M3','M4','M5','M6','M7','M8','M9'];
    for (const f of facilities) {
      for (const m of milestones) {
        await sql`INSERT INTO governance_milestone_state (facility_slug, milestone_id) VALUES (${f}, ${m}) ON CONFLICT DO NOTHING`;
      }
    }
    console.log("Governance milestone state seeded");
  }

  await sql.end();
  console.log("All tables ready!");
}

setup().catch((e) => { console.error("Error:", e.message); process.exit(1); });
