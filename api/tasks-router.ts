import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { tasks, equipment } from "@db/schema";
import { eq, and, like, or, sql } from "drizzle-orm";

// ── Procedure Familiarity options ──
const FAMILIARITY_OPTIONS = ["", "Fully Familiar", "Partially Familiar", "Requires Guidance", "Not Familiar"] as const;
const FamiliarityValue = z.enum(FAMILIARITY_OPTIONS);

// ── Cache: does the column exist? Set once on first query ──
let _colExists: boolean | null = null;
async function checkCol(): Promise<boolean> {
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

// ── Raw SQL list query — safe single-line, no template literal tricks ──
async function rawList(dataset: string, famFilter?: string) {
  // Use the simple query we KNOW works (matching the working stats endpoint)
  const q1 = `SELECT t."id",t."equipment_id",t."task_list",t."frequency",t."responsible_personnel",t."operations",t."amd",t."ard",e."id" as eid,e."name" as ename,e."initials" as einit FROM tasks t INNER JOIN equipment e ON t."equipment_id"=e."id" WHERE t."dataset"=$1 ORDER BY e."name",t."id"`;

  let rows: any[];
  try {
    rows = await db.execute(sql.raw(q1, [dataset])) as any[];
  } catch (err: any) {
    console.error("[tasks] rawList base query failed:", err.message);
    return [];
  }

  // Try to get familiarity values separately only if column exists
  let hasCol = false;
  let famRows: Record<number, string | null> = {};
  try {
    const colCheck = await db.execute(
      sql`SELECT 1 FROM information_schema.columns WHERE table_name='tasks' AND column_name='procedure_familiarity' LIMIT 1`
    );
    hasCol = (colCheck as any[]).length > 0;
    if (hasCol) {
      const fr = await db.execute(sql.raw(
        `SELECT "id","procedure_familiarity" FROM tasks WHERE "dataset"=$1`,
        [dataset]
      )) as any[];
      for (const r of fr) famRows[r.id] = r.procedure_familiarity;
    }
  } catch { /* ignore familiarity errors */ }

  // Map results
  const result = rows.map(r => ({
    task: {
      id: r.id, equipmentId: r.equipment_id, taskList: r.task_list,
      frequency: r.frequency, responsiblePersonnel: r.responsible_personnel,
      operations: r.operations, amd: r.amd, ard: r.ard,
      dataset,
      procedureFamiliarity: hasCol ? famRows[r.id] || null : null,
    },
    equipment: { id: r.eid, name: r.ename, initials: r.einit },
  }));

  // Client-side familiarity filter
  if (famFilter) {
    return result.filter(r => r.task.procedureFamiliarity === famFilter);
  }
  return result;
}

export const tasksRouter = createRouter({
  stats: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]) }))
    .query(async ({ input }) => {
      const q = `SELECT COUNT(*) as c FROM tasks WHERE "dataset"=$1`;
      const rows = await db.execute(sql.raw(q, [input.dataset]));
      return { count: Number((rows as any[])[0]?.c || 0) };
    }),

  list: publicQuery
    .input(z.object({
      dataset: z.enum(["htt", "aglipay"]),
      search: z.string().optional(),
      equipFilter: z.string().optional(),
      freqFilter: z.string().optional(),
      personFilter: z.string().optional(),
      familiarityFilter: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const rows = await rawList(input.dataset, input.familiarityFilter || undefined);

      // Client-side filter for fields not in SQL
      let result = rows;
      if (input.search) {
        const s = input.search.toLowerCase();
        result = result.filter(r => (r.task.taskList || "").toLowerCase().includes(s) || (r.equipment.name || "").toLowerCase().includes(s));
      }
      if (input.equipFilter) result = result.filter(r => r.equipment.name === input.equipFilter);
      if (input.freqFilter) result = result.filter(r => r.task.frequency === input.freqFilter);
      if (input.personFilter) result = result.filter(r => r.task.responsiblePersonnel === input.personFilter);

      const grouped = new Map<string, typeof result>();
      for (const row of result) {
        const name = row.equipment.name;
        if (!grouped.has(name)) grouped.set(name, []);
        grouped.get(name)!.push(row);
      }

      return {
        groups: Array.from(grouped.entries()).map(([, items]) => ({
          equipment: items[0].equipment,
          tasks: items.map(i => i.task),
        })),
        totalTasks: result.length,
      };
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
        const hasCol = await checkCol();
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
      const hasCol = await checkCol();
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
      const rows = await db.selectDistinct({
        equipmentName: equipment.name,
        frequency: tasks.frequency,
        responsiblePersonnel: tasks.responsiblePersonnel,
      }).from(tasks).innerJoin(equipment, eq(tasks.equipmentId, equipment.id)).where(eq(tasks.dataset, input.dataset));

      const equipSet = new Set<string>(), freqSet = new Set<string>(), personSet = new Set<string>(), famSet = new Set<string>();
      for (const r of rows) {
        if (r.equipmentName) equipSet.add(r.equipmentName);
        if (r.frequency) freqSet.add(r.frequency);
        if (r.responsiblePersonnel) personSet.add(r.responsiblePersonnel);
      }

      try {
        const hasCol = await checkCol();
        if (hasCol) {
          const fr = await db.selectDistinct({ procedureFamiliarity: tasks.procedureFamiliarity })
            .from(tasks).where(eq(tasks.dataset, input.dataset));
          for (const r of fr) if (r.procedureFamiliarity) famSet.add(r.procedureFamiliarity);
        }
      } catch { /* ignore */ }

      return { equipment: Array.from(equipSet).sort(), frequencies: Array.from(freqSet).sort(), personnel: Array.from(personSet).sort(), familiarity: Array.from(famSet).sort() };
    }),

  export: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]), selectedIds: z.array(z.number()).optional() }))
    .query(async ({ input }) => {
      // Safe single-line query — no template interpolation in SELECT
      const q = `SELECT t."id",t."task_list",t."frequency",t."responsible_personnel",t."operations",t."amd",t."ard",e."name" as ename FROM tasks t INNER JOIN equipment e ON t."equipment_id"=e."id" WHERE t."dataset"=$1 ORDER BY e."name",t."id"`;
      const rows = await db.execute(sql.raw(q, [input.dataset])) as any[];
      const mapped = rows.map(r => ({ equipmentType: r.ename, taskList: r.task_list, frequency: r.frequency, responsiblePersonnel: r.responsible_personnel, operations: r.operations, amd: r.amd, ard: r.ard, procedureFamiliarity: null }));
      return input.selectedIds?.length ? mapped.filter(r => input.selectedIds!.includes(r.id)) : mapped;
    }),

  import: publicQuery
    .input(z.array(z.object({
      equipmentType: z.string(), taskList: z.string(),
      operations: z.string().nullable().optional(),
      amd: z.string().nullable().optional(),
      ard: z.string().nullable().optional(),
      procedureFamiliarity: z.string().nullable().optional(),
    })))
    .mutation(async ({ input }) => {
      const hasCol = await checkCol();
      let updated = 0;
      const skipped: Array<{ eq: string; task: string; reason: string }> = [];
      for (const item of input) {
        const eqRows = await db.select().from(equipment).where(eq(equipment.name, item.equipmentType)).limit(1);
        if (!eqRows.length) { skipped.push({ eq: item.equipmentType, task: item.taskList.slice(0,50), reason: "Equipment not found" }); continue; }
        const tRows = await db.select().from(tasks).where(and(eq(tasks.equipmentId, eqRows[0].id), eq(tasks.taskList, item.taskList))).limit(1);
        if (!tRows.length) { skipped.push({ eq: item.equipmentType, task: item.taskList.slice(0,50), reason: "Task not found" }); continue; }
        const d: Record<string, string | null> = {};
        if (item.operations?.trim()) d.operations = item.operations.trim();
        if (item.amd?.trim()) d.amd = item.amd.trim();
        if (item.ard?.trim()) d.ard = item.ard.trim();
        if (hasCol && item.procedureFamiliarity?.trim()) d.procedureFamiliarity = item.procedureFamiliarity.trim();
        if (Object.keys(d).length > 0) {
          try { await db.update(tasks).set(d).where(eq(tasks.id, tRows[0].id)); updated++; } catch (err: any) { skipped.push({ eq: item.equipmentType, task: item.taskList.slice(0,50), reason: err.message }); }
        }
      }
      return { success: true, updated, total: input.length, skipped: skipped.slice(0,10) };
    }),

  familiaritySummary: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]) }))
    .query(async ({ input }) => {
      const hasCol = await checkCol();
      if (!hasCol) return { distribution: {}, total: 0 };
      try {
        const counts = await db.select({ level: tasks.procedureFamiliarity, count: sql<number>`COUNT(*)` })
          .from(tasks).where(eq(tasks.dataset, input.dataset)).groupBy(tasks.procedureFamiliarity);
        const result: Record<string, number> = {};
        for (const r of counts) { result[r.level || "Not Set"] = r.count; }
        return { distribution: result, total: Object.values(result).reduce((a,b) => a+b, 0) };
      } catch (err: any) {
        console.error("[tasks] famSummary failed:", err.message);
        return { distribution: {}, total: 0 };
      }
    }),
});
