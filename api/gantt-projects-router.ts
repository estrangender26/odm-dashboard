import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "./queries/connection";
import { ganttProjects } from "@db/schema";
import { publicQuery } from "./middleware";
import { TRPCError } from "@trpc/server";

/* ─── Gantt Project Save/Open Router — STEP 2: save only ─── */
export const ganttProjectsRouter = {
  save: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        tasksData: z.string(), // JSON string
        linksData: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await db
          .insert(ganttProjects)
          .values({
            name: input.name,
            tasksData: input.tasksData,
            linksData: input.linksData ?? null,
            description: input.description ?? null,
          })
          .returning();
        return { id: result[0].id, name: result[0].name };
      } catch (err: any) {
        console.error("[ganttProjects.save] error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save project" });
      }
    }),
};
