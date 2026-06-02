import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { tasks, equipment } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { MaintenanceImportError, buildMaintenanceTaskCode, importMaintenancePlanningRows, type MaintenanceDbLike } from "./tasks-import";

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

// ── Explicit column selection — only select procedure_familiarity after confirming it exists ──
const baseTaskCols = {
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
      const rows = await db.execute(sql`SELECT COUNT(*) as c FROM tasks WHERE "dataset"=${input.dataset}`);
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
      debugTaskIds: z.array(z.number()).max(10).optional(),
    }))
    .query(async ({ input }) => {
      console.log("[tasks/list] START dataset:", input.dataset);

      try {
        const hasCol = await hasFamiliarityCol();
        const taskCols = {
          ...baseTaskCols,
          procedureFamiliarity: hasCol ? tasks.procedureFamiliarity : sql<string | null>`null`,
        };

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

        if (input.debugTaskIds?.length) {
          const traceIds = new Set(input.debugTaskIds);
          const tracedRows = groups.flatMap((group) => group.tasks)
            .filter((task) => traceIds.has(task.id))
            .map((task) => ({
              task_id: task.id,
              procedureFamiliarity: task.procedureFamiliarity ?? null,
            }));
          console.info("[tasks/list] API response familiarity trace", {
            dataset: input.dataset,
            taskIds: input.debugTaskIds,
            rows: tracedRows,
          });
        }

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
      const hasCol = await hasFamiliarityCol();
      const rows = await db
        .select({
          id: tasks.id,
          equipmentCode: equipment.initials,
          equipmentName: equipment.name,
          taskList: tasks.taskList,
          frequency: tasks.frequency,
          responsiblePersonnel: tasks.responsiblePersonnel,
          operations: tasks.operations,
          amd: tasks.amd,
          ard: tasks.ard,
          procedureFamiliarity: hasCol ? tasks.procedureFamiliarity : sql<string | null>`null`,
        })
        .from(tasks)
        .innerJoin(equipment, eq(tasks.equipmentId, equipment.id))
        .where(eq(tasks.dataset, input.dataset))
        .orderBy(equipment.name, tasks.id);

      const selectedIds = input.selectedIds === undefined ? null : new Set(input.selectedIds);
      return rows
        .filter((row) => selectedIds === null || selectedIds.has(row.id))
        .map((row) => ({
          id: row.id,
          taskId: row.id,
          task_id: row.id,
          taskCode: buildMaintenanceTaskCode({ id: row.id, equipmentCode: row.equipmentCode, dataset: input.dataset }),
          task_code: buildMaintenanceTaskCode({ id: row.id, equipmentCode: row.equipmentCode, dataset: input.dataset }),
          dataset: input.dataset,
          equipmentCode: row.equipmentCode,
          equipmentName: row.equipmentName,
          equipmentType: row.equipmentName,
          taskList: row.taskList,
          frequency: row.frequency,
          responsiblePersonnel: row.responsiblePersonnel,
          operations: row.operations,
          amd: row.amd,
          ard: row.ard,
          procedureFamiliarity: row.procedureFamiliarity,
          systemCategory: null,
          facilityProgram: input.dataset === "htt" ? "HTT STP" : "Aglipay STP",
        }));
    }),

  import: publicQuery
    .input(z.object({
      dataset: z.enum(["htt", "aglipay"]),
      rows: z.array(z.object({
        taskId: z.union([z.number(), z.string()]).nullable().optional(),
        taskCode: z.string().nullable().optional(),
        facilityDataset: z.string().nullable().optional(),
        equipmentType: z.string(),
        taskList: z.string(),
        frequency: z.string().nullable().optional(),
        responsiblePersonnel: z.string().nullable().optional(),
        operations: z.string().nullable().optional(),
        amd: z.string().nullable().optional(),
        ard: z.string().nullable().optional(),
        procedureFamiliarity: z.string().nullable().optional(),
        familiarity: z.string().nullable().optional(),
        rowNumber: z.number().optional(),
      })),
      clientTimings: z.object({
        parseMs: z.number().nonnegative().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      console.info("[tasks/import] request received", {
        activeDataset: input.dataset,
        rows: input.rows.length,
        clientTimings: input.clientTimings,
        firstRows: input.rows.slice(0, 10).map((row) => ({
          rowNumber: row.rowNumber,
          taskId: row.taskId ?? null,
          taskCode: row.taskCode ?? null,
          facilityDataset: row.facilityDataset ?? null,
          equipment: row.equipmentType,
          taskDescription: row.taskList,
          parsedProcedureFamiliarity: row.procedureFamiliarity ?? row.familiarity ?? null,
          normalizedProcedureFamiliarity: String(row.procedureFamiliarity ?? row.familiarity ?? "").trim() || null,
        })),
      });
      try {
        const hasCol = await hasFamiliarityCol();
        const rows = input.rows.map((row) => ({
          ...row,
          procedureFamiliarity: row.procedureFamiliarity ?? row.familiarity,
        }));
        return await importMaintenancePlanningRows(db as unknown as MaintenanceDbLike, { ...input, rows }, hasCol);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const structuredPayload = error instanceof MaintenanceImportError ? error.toPayload() : undefined;
        console.error("[tasks/import] failed", {
          dataset: input.dataset,
          rows: input.rows.length,
          message: error.message,
          stack: error.stack,
          structuredPayload,
        });

        if (error instanceof MaintenanceImportError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
            cause: structuredPayload,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unexpected maintenance planning import failure: ${error.message || "Unknown error"}`,
          cause: error,
        });
      }
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
