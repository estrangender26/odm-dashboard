import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { tasks, equipment } from "@db/schema";
import { eq, and, like, or, sql } from "drizzle-orm";

const FAMILIARITY_OPTIONS = ["", "Fully Familiar", "Partially Familiar", "Requires Guidance", "Not Familiar"] as const;
const FamiliarityValue = z.enum(FAMILIARITY_OPTIONS);

// Cache column existence check
let _colExists: boolean | null = null;
async function hasFamiliarityCol(): Promise<boolean> {
  if (_colExists !== null) return _colExists;
  try {
    const r = await db.execute(
      sql`SELECT 1 FROM information_schema.columns WHERE table_name='tasks' AND column_name='procedure_familiarity' LIMIT 1`
    );
    _colExists = (r as any[]).length > 0;
  } catch {
    _colExists = false;
  }
  return _colExists;
}

// ── Explicit column selection — only columns known to exist ──
// This avoids Drizzle trying to SELECT procedure_familiarity when it doesn't exist in DB
const taskCols = {
  id: tasks.id,
  equipmentId: tasks.equipmentId,
  taskList: tasks.taskList,
  frequency: tasks.frequency,
  responsiblePersonnel: tasks.responsiblePersonnel,
  operations: tasks.operations,
  amd: tasks.amd,
  ard: tasks.ard,
  dataset: tasks.dataset,
};
const equipCols = {
  id: equipment.id,
  name: equipment.name,
  initials: equipment.initials,
};

export const tasksRouter = createRouter({
  stats: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]) }))
    .query(async ({ input }) => {
      console.log("[tasks/stats] dataset:", input.dataset);
      const q = `SELECT COUNT(*) as c FROM tasks WHERE "dataset"=$1`;
      const rows = await db.execute(sql.raw(q, [input.dataset]));
      const count = Number((rows as any[])[0]?.c || 0);
      console.log("[tasks/stats] count:", count);
      return { count };
    }),

  list: publicQuery
    .input(z.object({
      dataset: z.enum(["htt", "aglipay"]),
      search: z.string().optional(),
      equipFilter: z.string().optional(),
      freqFilter: z.string().optional(),
      personFilter: z.string().optional(),
    }))
    .query(async ({ input }) => {
      console.log("[tasks/list] START dataset:", input.dataset);

      try {
        // Use Drizzle ORM with explicit columns (no procedureFamiliarity)
        const rows = await db
          .select({ task: taskCols, equipment: equipCols })
          .from(tasks)
          .innerJoin(equipment, eq(tasks.equipmentId, equipment.id))
          .where(eq(tasks.dataset, input.dataset));

        console.log("[tasks/list] rows from DB:", rows.length);

        // Client-side filters
        let result = rows;
        if (input.search) {
          const s = input.search.toLowerCase();
          result = result.filter(r =>
            (r.task.taskList || "").toLowerCase().includes(s) ||
            (r.equipment.name || "").toLowerCase().includes(s)
          );
        }
        if (input.equipFilter) {
          result = result.filter(r => r.equipment.name === input.equipFilter);
        }
        if (input.freqFilter) {
          result = result.filter(r => r.task.frequency === input.freqFilter);
        }
        if (input.personFilter) {
          result = result.filter(r => r.task.responsiblePersonnel === input.personFilter);
        }

        console.log("[tasks/list] after filters:", result.length);

        // Group by equipment
        const grouped = new Map<string, typeof result>();
        for (const row of result) {
          const name = row.equipment.name;
          if (!grouped.has(name)) grouped.set(name, []);
          grouped.get(name)!.push(row);
        }

        const groups = Array.from(grouped.entries()).map(([, items]) => ({
          equipment: items[0].equipment,
          tasks: items.map(i => i.task),
        }));

        console.log("[tasks/list] groups:", groups.length, "totalTasks:", result.length);
        return { groups, totalTasks: result.length };

      } catch (err: any) {
        console.error("[tasks/list] ERROR:", err.message);
        // Return empty with error info
        return { groups: [], totalTasks: 0, _error: err.message };
      }
    }),

  update: publicQuery
    .input(z.object({
      taskId: z.number(),
      operations: z.string().nullable().optional(),
      amd: z.string().nullable().optional(),
      ard: z.string().nullable().optional(),
      procedureFamiliarity: FamiliarityValue.nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      const updateData: Record<string, string | null> = {};
      if (input.operations !== undefined) updateData.operations = input.operations;
      if (input.amd !== undefined) updateData.amd = input.amd;
      if (input.ard !== undefined) updateData.ard = input.ard;

      if (input.procedureFamiliarity !== undefined) {
        const hasCol = await hasFamiliarityCol();
        if (hasCol) updateData.procedureFamiliarity = input.procedureFamiliarity;
      }

      await db.update(tasks).set(updateData).where(eq(tasks.id, input.taskId));
      return { success: true, taskId: input.taskId, updatedBy: user?.name || null };
    }),

  bulkUpdate: publicQuery
    .input(z.array(z.object({
      taskId: z.number(),
      operations: z.string().nullable().optional(),
      amd: z.string().nullable().optional(),
      ard: z.string().nullable().optional(),
      procedureFamiliarity: FamiliarityValue.nullable().optional(),
    })))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      const hasCol = await hasFamiliarityCol();
      let updated = 0;

      await Promise.all(input.map(item => {
        const d: Record<string, string | null> = {};
        if (item.operations !== undefined) d.operations = item.operations;
        if (item.amd !== undefined) d.amd = item.amd;
        if (item.ard !== undefined) d.ard = item.ard;
        if (hasCol && item.procedureFamiliarity !== undefined) d.procedureFamiliarity = item.procedureFamiliarity;
        if (Object.keys(d).length === 0) return Promise.resolve();
        updated++;
        return db.update(tasks).set(d).where(eq(tasks.id, item.taskId));
      }));

      return { success: true, updated, updatedBy: user?.name || null };
    }),

  filters: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]) }))
    .query(async ({ input }) => {
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
      const famSet = new Set<string>();

      for (const r of rows) {
        if (r.equipmentName) equipSet.add(r.equipmentName);
        if (r.frequency) freqSet.add(r.frequency);
        if (r.responsiblePersonnel) personSet.add(r.responsiblePersonnel);
      }

      // Fetch familiarity values separately
      try {
        const hasCol = await hasFamiliarityCol();
        if (hasCol) {
          const fr = await db
            .selectDistinct({ procedureFamiliarity: tasks.procedureFamiliarity })
            .from(tasks)
            .where(eq(tasks.dataset, input.dataset));
          for (const r of fr) {
            if (r.procedureFamiliarity) famSet.add(r.procedureFamiliarity);
          }
        }
      } catch { /* ignore */ }

      return {
        equipment: Array.from(equipSet).sort(),
        frequencies: Array.from(freqSet).sort(),
        personnel: Array.from(personSet).sort(),
        familiarity: Array.from(famSet).sort(),
      };
    }),

  export: publicQuery
    .input(z.object({
      dataset: z.enum(["htt", "aglipay"]),
      selectedIds: z.array(z.number()).optional(),
    }))
    .query(async ({ input }) => {
      const q = `SELECT t."id",t."task_list",t."frequency",t."responsible_personnel",t."operations",t."amd",t."ard",e."name" as ename FROM tasks t INNER JOIN equipment e ON t."equipment_id"=e."id" WHERE t."dataset"=$1 ORDER BY e."name",t."id"`;
      const rows = await db.execute(sql.raw(q, [input.dataset])) as any[];
      const mapped = rows.map(r => ({
        equipmentType: r.ename,
        taskList: r.task_list,
        frequency: r.frequency,
        responsiblePersonnel: r.responsible_personnel,
        operations: r.operations,
        amd: r.amd,
        ard: r.ard,
        procedureFamiliarity: null,
      }));
      return input.selectedIds?.length
        ? mapped.filter(r => input.selectedIds!.includes(r.id))
        : mapped;
    }),

  import: publicQuery
    .input(z.array(z.object({
      equipmentType: z.string(),
      taskList: z.string(),
      operations: z.string().nullable().optional(),
      amd: z.string().nullable().optional(),
      ard: z.string().nullable().optional(),
      procedureFamiliarity: z.string().nullable().optional(),
    })))
    .mutation(async ({ input }) => {
      const hasCol = await hasFamiliarityCol();
      let updated = 0;
      const skipped: Array<{ eq: string; task: string; reason: string }> = [];

      for (const item of input) {
        const eqRows = await db.select().from(equipment).where(eq(equipment.name, item.equipmentType)).limit(1);
        if (!eqRows.length) {
          skipped.push({ eq: item.equipmentType, task: item.taskList.slice(0, 50), reason: "Equipment not found" });
          continue;
        }
        const tRows = await db.select().from(tasks)
          .where(and(eq(tasks.equipmentId, eqRows[0].id), eq(tasks.taskList, item.taskList)))
          .limit(1);
        if (!tRows.length) {
          skipped.push({ eq: item.equipmentType, task: item.taskList.slice(0, 50), reason: "Task not found" });
          continue;
        }

        const d: Record<string, string | null> = {};
        if (item.operations?.trim()) d.operations = item.operations.trim();
        if (item.amd?.trim()) d.amd = item.amd.trim();
        if (item.ard?.trim()) d.ard = item.ard.trim();
        if (hasCol && item.procedureFamiliarity?.trim()) d.procedureFamiliarity = item.procedureFamiliarity.trim();

        if (Object.keys(d).length > 0) {
          try {
            await db.update(tasks).set(d).where(eq(tasks.id, tRows[0].id));
            updated++;
          } catch (err: any) {
            skipped.push({ eq: item.equipmentType, task: item.taskList.slice(0, 50), reason: err.message });
          }
        }
      }

      return { success: true, updated, total: input.length, skipped: skipped.slice(0, 10) };
    }),

  familiaritySummary: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]) }))
    .query(async ({ input }) => {
      const hasCol = await hasFamiliarityCol();
      if (!hasCol) return { distribution: {}, total: 0 };

      try {
        const counts = await db
          .select({
            level: tasks.procedureFamiliarity,
            count: sql<number>`COUNT(*)`,
          })
          .from(tasks)
          .where(eq(tasks.dataset, input.dataset))
          .groupBy(tasks.procedureFamiliarity);

        const result: Record<string, number> = {};
        for (const r of counts) {
          result[r.level || "Not Set"] = r.count;
        }
        return { distribution: result, total: Object.values(result).reduce((a, b) => a + b, 0) };
      } catch {
        return { distribution: {}, total: 0 };
      }
    }),
});
