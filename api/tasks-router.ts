import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { db } from "./queries/connection";
import { tasks, equipment } from "@db/schema";
import { eq, and, like, or } from "drizzle-orm";

export const tasksRouter = createRouter({
  list: publicQuery
    .input(
      z.object({
        dataset: z.enum(["htt", "aglipay"]),
        search: z.string().optional(),
        equipFilter: z.string().optional(),
        freqFilter: z.string().optional(),
        personFilter: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      // db is already imported
      const conditions: (ReturnType<typeof eq> | ReturnType<typeof and> | ReturnType<typeof or>)[] = [
        eq(tasks.dataset, input.dataset),
      ];

      if (input.search) {
        const s = `%${input.search}%`;
        conditions.push(or(like(tasks.taskList, s), like(equipment.name, s)));
      }
      if (input.equipFilter) {
        conditions.push(eq(equipment.name, input.equipFilter));
      }
      if (input.freqFilter) {
        conditions.push(eq(tasks.frequency, input.freqFilter));
      }
      if (input.personFilter) {
        conditions.push(eq(tasks.responsiblePersonnel, input.personFilter));
      }

      const rows = await db
        .select({ task: tasks, equipment: equipment })
        .from(tasks)
        .innerJoin(equipment, eq(tasks.equipmentId, equipment.id))
        .where(and(...conditions));

      const grouped = new Map<string, typeof rows>();
      for (const row of rows) {
        const eqName = row.equipment.name;
        if (!grouped.has(eqName)) grouped.set(eqName, []);
        grouped.get(eqName)!.push(row);
      }

      return {
        groups: Array.from(grouped.entries()).map(([, items]) => ({
          equipment: items[0].equipment,
          tasks: items.map((i) => i.task),
        })),
        totalTasks: rows.length,
      };
    }),

  update: publicQuery
    .input(
      z.object({
        taskId: z.number(),
        operations: z.string().nullable().optional(),
        amd: z.string().nullable().optional(),
        ard: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // db is already imported
      const user = ctx.user;
      const updateData: Record<string, string | null> = {};
      if (input.operations !== undefined) updateData.operations = input.operations;
      if (input.amd !== undefined) updateData.amd = input.amd;
      if (input.ard !== undefined) updateData.ard = input.ard;

      await db.update(tasks).set(updateData).where(eq(tasks.id, input.taskId));
      return { success: true, taskId: input.taskId, updatedBy: user?.name || null };
    }),

  bulkUpdate: publicQuery
    .input(
      z.array(
        z.object({
          taskId: z.number(),
          operations: z.string().nullable().optional(),
          amd: z.string().nullable().optional(),
          ard: z.string().nullable().optional(),
        })
      )
    )
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      let updated = 0;
      // Run updates in parallel for speed
      const promises = input.map((item) => {
        const updateData: Record<string, string | null> = {};
        if (item.operations !== undefined) updateData.operations = item.operations;
        if (item.amd !== undefined) updateData.amd = item.amd;
        if (item.ard !== undefined) updateData.ard = item.ard;
        if (Object.keys(updateData).length > 0) {
          updated++;
          return db.update(tasks).set(updateData).where(eq(tasks.id, item.taskId));
        }
        return Promise.resolve();
      });
      await Promise.all(promises);
      return { success: true, updated, updatedBy: user?.name || null };
    }),

  filters: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]) }))
    .query(async ({ input }) => {
      // db is already imported
      const rows = await db
        .selectDistinct({
          equipmentName: equipment.name,
          frequency: tasks.frequency,
          responsiblePersonnel: tasks.responsiblePersonnel,
        })
        .from(tasks)
        .innerJoin(equipment, eq(tasks.equipmentId, equipment.id))
        .where(eq(tasks.dataset, input.dataset));

      const equipSet = new Set<string>();
      const freqSet = new Set<string>();
      const personSet = new Set<string>();

      for (const row of rows) {
        if (row.equipmentName) equipSet.add(row.equipmentName);
        if (row.frequency) freqSet.add(row.frequency);
        if (row.responsiblePersonnel) personSet.add(row.responsiblePersonnel);
      }

      return {
        equipment: Array.from(equipSet).sort(),
        frequencies: Array.from(freqSet).sort(),
        personnel: Array.from(personSet).sort(),
      };
    }),

  export: publicQuery
    .input(
      z.object({
        dataset: z.enum(["htt", "aglipay"]),
        selectedIds: z.array(z.number()).optional(),
      })
    )
    .query(async ({ input }) => {
      // db is already imported
      const rows = await db
        .select({ task: tasks, equipment: equipment })
        .from(tasks)
        .innerJoin(equipment, eq(tasks.equipmentId, equipment.id))
        .where(eq(tasks.dataset, input.dataset));

      const filtered = input.selectedIds?.length
        ? rows.filter((r) => input.selectedIds!.includes(r.task.id))
        : rows;

      return filtered.map((r) => ({
        equipmentType: r.equipment.name,
        taskList: r.task.taskList,
        frequency: r.task.frequency,
        responsiblePersonnel: r.task.responsiblePersonnel,
        operations: r.task.operations,
        amd: r.task.amd,
        ard: r.task.ard,
      }));
    }),

  import: publicQuery
    .input(
      z.array(
        z.object({
          equipmentType: z.string(),
          taskList: z.string(),
          operations: z.string().nullable().optional(),
          amd: z.string().nullable().optional(),
          ard: z.string().nullable().optional(),
        })
      )
    )
    .mutation(async ({ input }) => {
      console.log("[SERVER IMPORT] Received", input.length, "rows");
      let updated = 0;
      const skipped: Array<{ eq: string; task: string; reason: string }> = [];

      for (const item of input) {
        const eqRows = await db
          .select()
          .from(equipment)
          .where(eq(equipment.name, item.equipmentType))
          .limit(1);

        if (eqRows.length === 0) {
          console.log("[SERVER IMPORT] Equipment not found:", item.equipmentType);
          skipped.push({ eq: item.equipmentType, task: item.taskList.substring(0, 50), reason: "Equipment not found" });
          continue;
        }
        const eqId = eqRows[0].id;

        const taskRows = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.equipmentId, eqId), eq(tasks.taskList, item.taskList)))
          .limit(1);

        if (taskRows.length === 0) {
          console.log("[SERVER IMPORT] Task not found:", item.equipmentType, ">", item.taskList.substring(0, 50));
          skipped.push({ eq: item.equipmentType, task: item.taskList.substring(0, 50), reason: "Task not found" });
          continue;
        }
        const taskId = taskRows[0].id;

        const updateData: Record<string, string | null> = {};
        // Only update fields that have non-empty values — skip blanks to avoid overwriting existing data
        if (item.operations !== undefined && item.operations !== null && item.operations.trim() !== "") updateData.operations = item.operations.trim();
        if (item.amd !== undefined && item.amd !== null && item.amd.trim() !== "") updateData.amd = item.amd.trim();
        if (item.ard !== undefined && item.ard !== null && item.ard.trim() !== "") updateData.ard = item.ard.trim();

        if (Object.keys(updateData).length > 0) {
          await db.update(tasks).set(updateData).where(eq(tasks.id, taskId));
          updated++;
          console.log("[SERVER IMPORT] Updated task", taskId, "fields:", Object.keys(updateData));
        } else {
          console.log("[SERVER IMPORT] Skipped task", taskId, "(no non-empty fields to update)");
        }
      }
      console.log("[SERVER IMPORT] Done:", { updated, total: input.length, skipped: skipped.length });
      return { success: true, updated, total: input.length, skipped: skipped.slice(0, 10) };
    }),
});
