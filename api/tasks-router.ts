import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { db } from "./queries/connection";
import { tasks, equipment } from "@db/schema";
import { eq, and, like, or, sql } from "drizzle-orm";

// ── Procedure Familiarity options ──
const FAMILIARITY_OPTIONS = ["", "Fully Familiar", "Partially Familiar", "Requires Guidance", "Not Familiar"] as const;
const FamiliarityValue = z.enum(FAMILIARITY_OPTIONS);

// ── Column existence cache ──
let _colExists: boolean | null = null;
async function familiarityColumnExists(): Promise<boolean> {
  if (_colExists !== null) return _colExists;
  try {
    const result = await db.execute(
      sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'procedure_familiarity' LIMIT 1`
    );
    _colExists = (result as any[]).length > 0;
    console.log("[DB] procedure_familiarity column exists:", _colExists);
  } catch {
    _colExists = false;
  }
  return _colExists;
}

// ── Safe raw query that returns familiarity only if column exists ──
async function safeListQuery(dataset: string, hasFamFilter: boolean) {
  const hasCol = await familiarityColumnExists();
  const famSelect = hasCol ? ', t."procedure_familiarity"' : '';
  const famJoin = hasFamFilter && hasCol ? 'AND t."procedure_familiarity" = $2' : '';

  const params: string[] = [dataset];
  if (hasFamFilter && hasCol) params.push('');

  const query = `
    SELECT
      t."id", t."equipment_id", t."task_list", t."frequency",
      t."responsible_personnel", t."operations", t."amd", t."ard",
      t."dataset"${famSelect},
      e."id" as e_id, e."name" as e_name, e."initials" as e_initials
    FROM tasks t
    INNER JOIN equipment e ON t."equipment_id" = e."id"
    WHERE t."dataset" = $1 ${famJoin}
    ORDER BY e."name", t."id"
  `;

  try {
    const rows = await db.execute(sql.raw(query, params));
    return (rows as any[]).map((r: any) => ({
      task: {
        id: r.id,
        equipmentId: r.equipment_id,
        taskList: r.task_list,
        frequency: r.frequency,
        responsiblePersonnel: r.responsible_personnel,
        operations: r.operations,
        amd: r.amd,
        ard: r.ard,
        dataset: r.dataset,
        procedureFamiliarity: hasCol ? r.procedure_familiarity : null,
      },
      equipment: {
        id: r.e_id,
        name: r.e_name,
        initials: r.e_initials,
      },
    }));
  } catch (err: any) {
    console.error("[tasksRouter] list query failed:", err.message);
    // Fallback: retry without the column
    _colExists = false;
    return safeListQuery(dataset, false);
  }
}

export const tasksRouter = createRouter({
  list: publicQuery
    .input(
      z.object({
        dataset: z.enum(["htt", "aglipay"]),
        search: z.string().optional(),
        equipFilter: z.string().optional(),
        freqFilter: z.string().optional(),
        personFilter: z.string().optional(),
        familiarityFilter: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      // Check if familiarity column exists — if not, skip the filter entirely
      const hasCol = await familiarityColumnExists();

      // Build conditions using Drizzle for columns we KNOW exist
      const conditions: any[] = [eq(tasks.dataset, input.dataset)];

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
      // Only apply familiarity filter if column exists AND user selected a value
      if (hasCol && input.familiarityFilter) {
        conditions.push(eq(tasks.procedureFamiliarity, input.familiarityFilter));
      }

      let rows: any[];
      try {
        rows = await db
          .select({ task: tasks, equipment: equipment })
          .from(tasks)
          .innerJoin(equipment, eq(tasks.equipmentId, equipment.id))
          .where(and(...conditions));
      } catch (err: any) {
        // If the query failed (e.g., column doesn't exist), fallback to safe query
        console.error("[tasksRouter] Drizzle list failed, using fallback:", err.message);
        rows = await safeListQuery(input.dataset, false);
      }

      // Client-side search fallback (if raw SQL didn't handle it)
      let result = rows;
      if (input.search) {
        const s = input.search.toLowerCase();
        result = result.filter((r: any) =>
          (r.task?.taskList || "").toLowerCase().includes(s) ||
          (r.equipment?.name || "").toLowerCase().includes(s)
        );
      }
      if (input.equipFilter) {
        result = result.filter((r: any) => r.equipment?.name === input.equipFilter);
      }

      const grouped = new Map<string, typeof result>();
      for (const row of result) {
        const eqName = row.equipment.name;
        if (!grouped.has(eqName)) grouped.set(eqName, []);
        grouped.get(eqName)!.push(row);
      }

      return {
        groups: Array.from(grouped.entries()).map(([, items]) => ({
          equipment: items[0].equipment,
          tasks: items.map((i: any) => i.task),
        })),
        totalTasks: result.length,
      };
    }),

  update: publicQuery
    .input(
      z.object({
        taskId: z.number(),
        operations: z.string().nullable().optional(),
        amd: z.string().nullable().optional(),
        ard: z.string().nullable().optional(),
        procedureFamiliarity: FamiliarityValue.nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      const updateData: Record<string, string | null> = {};
      if (input.operations !== undefined) updateData.operations = input.operations;
      if (input.amd !== undefined) updateData.amd = input.amd;
      if (input.ard !== undefined) updateData.ard = input.ard;

      // Only attempt to update familiarity if column exists
      if (input.procedureFamiliarity !== undefined) {
        const hasCol = await familiarityColumnExists();
        if (hasCol) {
          updateData.procedureFamiliarity = input.procedureFamiliarity;
        } else {
          console.log("[tasksRouter] Skipping familiarity update — column not found");
        }
      }

      try {
        await db.update(tasks).set(updateData).where(eq(tasks.id, input.taskId));
      } catch (err: any) {
        console.error("[tasksRouter] Update failed:", err.message);
        throw err;
      }
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
          procedureFamiliarity: FamiliarityValue.nullable().optional(),
        })
      )
    )
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      const hasCol = await familiarityColumnExists();
      let updated = 0;

      const promises = input.map((item) => {
        const updateData: Record<string, string | null> = {};
        if (item.operations !== undefined) updateData.operations = item.operations;
        if (item.amd !== undefined) updateData.amd = item.amd;
        if (item.ard !== undefined) updateData.ard = item.ard;
        if (hasCol && item.procedureFamiliarity !== undefined) {
          updateData.procedureFamiliarity = item.procedureFamiliarity;
        }
        if (Object.keys(updateData).length > 0) {
          updated++;
          return db.update(tasks).set(updateData).where(eq(tasks.id, item.taskId));
        }
        return Promise.resolve();
      });

      try {
        await Promise.all(promises);
      } catch (err: any) {
        console.error("[tasksRouter] Bulk update failed:", err.message);
        throw err;
      }
      return { success: true, updated, updatedBy: user?.name || null };
    }),

  filters: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]) }))
    .query(async ({ input }) => {
      // Select only columns that definitely exist
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

      for (const row of rows) {
        if (row.equipmentName) equipSet.add(row.equipmentName);
        if (row.frequency) freqSet.add(row.frequency);
        if (row.responsiblePersonnel) personSet.add(row.responsiblePersonnel);
      }

      // Try to get familiarity values separately
      try {
        const hasCol = await familiarityColumnExists();
        if (hasCol) {
          const famRows = await db
            .selectDistinct({ procedureFamiliarity: tasks.procedureFamiliarity })
            .from(tasks)
            .where(eq(tasks.dataset, input.dataset));
          for (const r of famRows) {
            if (r.procedureFamiliarity) famSet.add(r.procedureFamiliarity);
          }
        }
      } catch {
        // Column doesn't exist, return empty familiarity list
      }

      return {
        equipment: Array.from(equipSet).sort(),
        frequencies: Array.from(freqSet).sort(),
        personnel: Array.from(personSet).sort(),
        familiarity: Array.from(famSet).sort(),
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
      // Use safe query that handles missing column
      const hasCol = await familiarityColumnExists();

      const famSelect = hasCol ? ', t."procedure_familiarity"' : '';
      const query = `
        SELECT
          t."id", t."task_list", t."frequency",
          t."responsible_personnel", t."operations", t."amd", t."ard"${famSelect},
          e."name" as e_name
        FROM tasks t
        INNER JOIN equipment e ON t."equipment_id" = e."id"
        WHERE t."dataset" = $1
        ORDER BY e."name", t."id"
      `;

      let rows: any[];
      try {
        const rawRows = await db.execute(sql.raw(query, [input.dataset]));
        rows = (rawRows as any[]).map((r: any) => ({
          equipmentType: r.e_name,
          taskList: r.task_list,
          frequency: r.frequency,
          responsiblePersonnel: r.responsible_personnel,
          operations: r.operations,
          amd: r.amd,
          ard: r.ard,
          procedureFamiliarity: hasCol ? r.procedure_familiarity : null,
        }));
      } catch (err: any) {
        console.error("[tasksRouter] Export query failed:", err.message);
        // Fallback: query without the column
        const fallbackQuery = `
          SELECT t."id", t."task_list", t."frequency",
                 t."responsible_personnel", t."operations", t."amd", t."ard",
                 e."name" as e_name
          FROM tasks t INNER JOIN equipment e ON t."equipment_id" = e."id"
          WHERE t."dataset" = $1 ORDER BY e."name", t."id"
        `;
        const rawRows = await db.execute(sql.raw(fallbackQuery, [input.dataset]));
        rows = (rawRows as any[]).map((r: any) => ({
          equipmentType: r.e_name,
          taskList: r.task_list,
          frequency: r.frequency,
          responsiblePersonnel: r.responsible_personnel,
          operations: r.operations,
          amd: r.amd,
          ard: r.ard,
          procedureFamiliarity: null,
        }));
      }

      const filtered = input.selectedIds?.length
        ? rows.filter((r) => input.selectedIds!.includes(r.id))
        : rows;

      return filtered;
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
          procedureFamiliarity: z.string().nullable().optional(),
        })
      )
    )
    .mutation(async ({ input }) => {
      console.log("[SERVER IMPORT] Received", input.length, "rows");
      const hasCol = await familiarityColumnExists();
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
        if (item.operations !== undefined && item.operations !== null && item.operations.trim() !== "") updateData.operations = item.operations.trim();
        if (item.amd !== undefined && item.amd !== null && item.amd.trim() !== "") updateData.amd = item.amd.trim();
        if (item.ard !== undefined && item.ard !== null && item.ard.trim() !== "") updateData.ard = item.ard.trim();
        if (hasCol && item.procedureFamiliarity !== undefined && item.procedureFamiliarity !== null && item.procedureFamiliarity.trim() !== "") {
          updateData.procedureFamiliarity = item.procedureFamiliarity.trim();
        }

        if (Object.keys(updateData).length > 0) {
          try {
            await db.update(tasks).set(updateData).where(eq(tasks.id, taskId));
            updated++;
            console.log("[SERVER IMPORT] Updated task", taskId, "fields:", Object.keys(updateData));
          } catch (err: any) {
            console.error("[SERVER IMPORT] Update failed for task", taskId, err.message);
            skipped.push({ eq: item.equipmentType, task: item.taskList.substring(0, 50), reason: "Update error: " + err.message });
          }
        } else {
          console.log("[SERVER IMPORT] Skipped task", taskId, "(no non-empty fields to update)");
        }
      }
      console.log("[SERVER IMPORT] Done:", { updated, total: input.length, skipped: skipped.length });
      return { success: true, updated, total: input.length, skipped: skipped.slice(0, 10) };
    }),

  // ── Procedure Familiarity Summary (KPI) ──
  familiaritySummary: publicQuery
    .input(z.object({ dataset: z.enum(["htt", "aglipay"]) }))
    .query(async ({ input }) => {
      const hasCol = await familiarityColumnExists();
      if (!hasCol) {
        return { distribution: {}, total: 0 };
      }

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
        for (const row of counts) {
          const key = row.level || "Not Set";
          result[key] = row.count;
        }
        const total = Object.values(result).reduce((a, b) => a + b, 0);
        return { distribution: result, total };
      } catch (err: any) {
        console.error("[tasksRouter] familiaritySummary failed:", err.message);
        return { distribution: {}, total: 0 };
      }
    }),
});
