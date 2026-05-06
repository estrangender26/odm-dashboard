import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { equipment, tasks, governanceFacilities } from "@db/schema";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const seedRouter = createRouter({
  run: publicQuery.mutation(async () => {
    try {
      // Check if already seeded
      const existingTasks = await db.select().from(tasks);
      if (existingTasks.length > 0) {
        return { success: false, message: "Database already seeded", tasks: existingTasks.length };
      }

      // Read seed data
      const pmData = JSON.parse(fs.readFileSync(join(__dirname, "../db/seed-pm.json"), "utf-8"));
      const maintData = JSON.parse(fs.readFileSync(join(__dirname, "../db/seed-maint.json"), "utf-8"));

      function getInitials(name: string): string {
        return name.split(/[\s\-\(\[\/]+/).filter(w => w).map(w => w[0]).join("").substring(0, 3).toUpperCase();
      }

      // Insert PM (HTT STP) equipment
      const pmEquipMap = new Map<string, number>();
      for (const row of pmData) {
        const eqName = row["Equipment Type"] || "Unspecified";
        if (!pmEquipMap.has(eqName)) {
          const result = await db.insert(equipment).values({
            name: eqName,
            initials: getInitials(eqName),
          }).returning({ id: equipment.id });
          const id = result[0].id;
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

      // Insert Maintenance (Aglipay STP) equipment
      const maintEquipMap = new Map<string, number>();
      for (const row of maintData) {
        const eqName = row["Equipment Type"] || "Unspecified";
        if (!maintEquipMap.has(eqName)) {
          const result = await db.insert(equipment).values({
            name: eqName,
            initials: getInitials(eqName),
          }).returning({ id: equipment.id });
          const id = result[0].id;
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

      // Seed governance facilities
      await db.insert(governanceFacilities).values([
        { slug: "aglipay", name: "AGLIPAY Sewage Treatment Plant", shortName: "AGLIPAY STP" },
        { slug: "htt", name: "HTT Sewage Treatment Plant", shortName: "HTT STP" },
        { slug: "eastbay", name: "EASTBAY Phase 2 Treatment Plant", shortName: "EASTBAY PH-2 TP" },
        { slug: "kaysakat", name: "KAYSAKAT Treatment Plant", shortName: "KAYSAKAT TP" },
      ]).onConflictDoNothing();

      return {
        success: true,
        pmTasks: pmData.length,
        maintTasks: maintData.length,
        totalTasks: pmData.length + maintData.length,
      };
    } catch (error) {
      console.error("Seed error:", error);
      return { success: false, message: String(error) };
    }
  }),
});
