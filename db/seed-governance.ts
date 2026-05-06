import { db } from "../api/queries/connection";
import { governanceFacilities, equipment, tasks } from "./schema";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function seed() {

  // Seed governance facilities
  await db.insert(governanceFacilities).values([
    { slug: "aglipay", name: "AGLIPAY Sewage Treatment Plant", shortName: "AGLIPAY STP" },
    { slug: "htt", name: "HTT Sewage Treatment Plant", shortName: "HTT STP" },
    { slug: "eastbay", name: "EASTBAY Phase 2 Treatment Plant", shortName: "EASTBAY PH-2 TP" },
    { slug: "kaysakat", name: "KAYSAKAT Treatment Plant", shortName: "KAYSAKAT TP" },
  ]).onConflictDoNothing();
  console.log("Governance facilities seeded");

  // Seed equipment and tasks from JSON (batch insert)
  const pmData = JSON.parse(fs.readFileSync(join(__dirname, "seed-pm.json"), "utf-8"));
  const maintData = JSON.parse(fs.readFileSync(join(__dirname, "seed-maint.json"), "utf-8"));

  function getInitials(name: string): string {
    return name.split(/[\s\-\(\[\/]+/).filter(w => w).map(w => w[0]).join("").substring(0, 3).toUpperCase();
  }

  // Insert equipment (batch)
  const allEquipNames = new Set<string>();
  pmData.forEach((r: Record<string, string>) => { if (r["Equipment Type"]) allEquipNames.add(r["Equipment Type"]); });
  maintData.forEach((r: Record<string, string>) => { if (r["Equipment Type"]) allEquipNames.add(r["Equipment Type"]); });

  const equipValues = Array.from(allEquipNames).map(name => ({
    name,
    initials: getInitials(name),
  }));

  if (equipValues.length > 0) {
    await db.insert(equipment).values(equipValues);
    console.log(`Inserted ${equipValues.length} equipment`);
  }

  // Get equipment IDs
  const equipRows = await db.select().from(equipment);
  const equipMap = new Map<string, number>();
  for (const row of equipRows) {
    equipMap.set(row.name, row.id);
  }

  // Batch insert tasks
  const allTasks = [
    ...pmData.map((r: Record<string, string>) => ({
      equipmentId: equipMap.get(r["Equipment Type"]) || 0,
      taskList: r["Task List"] || "",
      frequency: r["Frequency"] || "",
      responsiblePersonnel: r["Responsible Personnel"] || null,
      operations: r["Operations"] || null,
      amd: r["AMD"] || null,
      ard: r["ARD"] || null,
      dataset: "htt" as const,
    })),
    ...maintData.map((r: Record<string, string>) => ({
      equipmentId: equipMap.get(r["Equipment Type"]) || 0,
      taskList: r["Task List"] || "",
      frequency: r["Frequency"] || "",
      responsiblePersonnel: r["Responsible Personnel"] || null,
      operations: r["Operations"] || null,
      amd: r["AMD"] || null,
      ard: r["ARD"] || null,
      dataset: "aglipay" as const,
    })),
  ].filter(t => t.equipmentId !== 0);

  // Insert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < allTasks.length; i += batchSize) {
    const batch = allTasks.slice(i, i + batchSize);
    await db.insert(tasks).values(batch);
  }
  console.log(`Inserted ${allTasks.length} tasks`);

  console.log("Seed complete!");
}

seed().catch(console.error);
