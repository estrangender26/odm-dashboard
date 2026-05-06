import { db } from "../api/queries/connection";
import { equipment, tasks } from "./schema";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read Excel data as JSON (pre-converted)
const pmData = JSON.parse(fs.readFileSync(join(__dirname, "seed-pm.json"), "utf-8"));
const maintData = JSON.parse(fs.readFileSync(join(__dirname, "seed-maint.json"), "utf-8"));

async function seed() {

  // Clear existing data
  await db.delete(tasks);
  await db.delete(equipment);

  // Helper to get initials
  function getInitials(name: string): string {
    return name.split(/[\s\-\(\[\/]+/).filter(w => w).map(w => w[0]).join("").substring(0, 3).toUpperCase();
  }

  // Insert PM (HTT STP) data
  const pmEquipMap = new Map<string, number>();
  for (const row of pmData) {
    const eqName = row["Equipment Type"] || "Unspecified";
    if (!pmEquipMap.has(eqName)) {
      const result = await db.insert(equipment).values({
        name: eqName,
        initials: getInitials(eqName),
      });
      const id = Number(result[0].insertId);
      pmEquipMap.set(eqName, id);
    }
    const equipId = pmEquipMap.get(eqName)!;
    await db.insert(tasks).values({
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

  // Insert Maintenance (Aglipay STP) data
  const maintEquipMap = new Map<string, number>();
  for (const row of maintData) {
    const eqName = row["Equipment Type"] || "Unspecified";
    if (!maintEquipMap.has(eqName)) {
      const result = await db.insert(equipment).values({
        name: eqName,
        initials: getInitials(eqName),
      });
      const id = Number(result[0].insertId);
      maintEquipMap.set(eqName, id);
    }
    const equipId = maintEquipMap.get(eqName)!;
    await db.insert(tasks).values({
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

  console.log("Seed complete!");
  console.log(`  HTT STP: ${pmData.length} tasks`);
  console.log(`  Aglipay STP: ${maintData.length} tasks`);
}

seed().catch(console.error);
