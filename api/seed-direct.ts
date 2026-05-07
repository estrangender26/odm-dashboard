import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use Transaction Pooler for IPv4 compatibility
const DATABASE_URL = "postgresql://postgres.hpfcwqyoxbndfwzbhrbz:COGF6I3w1Ij6UitG@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";

async function seed() {
  console.log("Connecting to database...");
  const client = postgres(DATABASE_URL, { ssl: "require", prepare: false, max_lifetime: 60 });
  const db = drizzle(client, { schema });
  console.log("Connected!");

  // Check if already seeded
  const existing = await db.select().from(schema.tasks);
  if (existing.length > 0) {
    console.log(`Database already has ${existing.length} tasks. Skipping seed.`);
    await client.end();
    return;
  }

  console.log("Creating tables if needed...");
  
  // Read seed data
  const pmData = JSON.parse(fs.readFileSync(join(__dirname, "../db/seed-pm.json"), "utf-8"));
  const maintData = JSON.parse(fs.readFileSync(join(__dirname, "../db/seed-maint.json"), "utf-8"));
  console.log(`PM: ${pmData.length}, Maint: ${maintData.length}`);

  function getInitials(name: string): string {
    return name.split(/[\s\-\(\[\/]+/).filter((w: string) => w).map((w: string) => w[0]).join("").substring(0, 3).toUpperCase();
  }

  // Seed governance facilities first
  await db.insert(schema.governanceFacilities).values([
    { slug: "aglipay", name: "AGLIPAY Sewage Treatment Plant", shortName: "AGLIPAY STP" },
    { slug: "htt", name: "HTT Sewage Treatment Plant", shortName: "HTT STP" },
    { slug: "eastbay", name: "EASTBAY Phase 2 Treatment Plant", shortName: "EASTBAY PH-2 TP" },
    { slug: "kaysakat", name: "KAYSAKAT Treatment Plant", shortName: "KAYSAKAT TP" },
  ]).onConflictDoNothing();
  console.log("Governance facilities seeded");

  // Insert PM (HTT STP) equipment
  const pmEquipMap = new Map<string, number>();
  for (const row of pmData) {
    const eqName = row["Equipment Type"] || "Unspecified";
    if (!pmEquipMap.has(eqName)) {
      const result = await db.insert(schema.equipment).values({
        name: eqName,
        initials: getInitials(eqName),
      }).returning({ id: schema.equipment.id });
      pmEquipMap.set(eqName, result[0].id);
    }
    const equipId = pmEquipMap.get(eqName)!;
    await db.insert(schema.tasks).values({
      equipmentId: equipId,
      taskList: row["Task List"] || "",
      frequency: row["Frequency"] || "",
      responsiblePersonnel: row["Responsible Personnel"] || null,
      operations: row["Operations"] || null,
      amd: row["AMD"] || null,
      ard: row["ARD"] || null,
      dataset: "htt",
    });
  }

  // Insert Maintenance (Aglipay STP) equipment
  const maintEquipMap = new Map<string, number>();
  for (const row of maintData) {
    const eqName = row["Equipment Type"] || "Unspecified";
    if (!maintEquipMap.has(eqName)) {
      const result = await db.insert(schema.equipment).values({
        name: eqName,
        initials: getInitials(eqName),
      }).returning({ id: schema.equipment.id });
      maintEquipMap.set(eqName, result[0].id);
    }
    const equipId = maintEquipMap.get(eqName)!;
    await db.insert(schema.tasks).values({
      equipmentId: equipId,
      taskList: row["Task List"] || "",
      frequency: row["Frequency"] || "",
      responsiblePersonnel: row["Responsible Personnel"] || null,
      operations: row["Operations"] || null,
      amd: row["AMD"] || null,
      ard: row["ARD"] || null,
      dataset: "aglipay",
    });
  }

  console.log(`Seed complete! PM: ${pmData.length}, Maint: ${maintData.length}, Total: ${pmData.length + maintData.length}`);
  await client.end();
}

seed().catch((e) => { console.error("Error:", e.message); process.exit(1); });
