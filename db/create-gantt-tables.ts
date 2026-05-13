import postgres from "postgres";

const dbUrl = "postgresql://postgres.hpfcwqyoxbndfwzbhrbz:COGF6I3w1Ij6UitG@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";

const client = postgres(dbUrl, { ssl: "require", prepare: false, max: 1 });

async function main() {
  console.log("Creating gantt_tasks table...");
  await client`
    CREATE TABLE IF NOT EXISTS gantt_tasks (
      id SERIAL PRIMARY KEY,
      text VARCHAR(500) NOT NULL,
      start_date VARCHAR(20),
      end_date VARCHAR(20),
      duration INTEGER,
      progress INTEGER DEFAULT 0,
      parent INTEGER DEFAULT 0,
      type VARCHAR(20) DEFAULT 'task',
      sortorder INTEGER DEFAULT 0,
      owner VARCHAR(255),
      open INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  console.log("✅ gantt_tasks table created");

  console.log("Creating gantt_links table...");
  await client`
    CREATE TABLE IF NOT EXISTS gantt_links (
      id SERIAL PRIMARY KEY,
      source INTEGER NOT NULL,
      target INTEGER NOT NULL,
      type VARCHAR(20) NOT NULL DEFAULT '0',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  console.log("✅ gantt_links table created");

  await client.end();
  console.log("Done!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
