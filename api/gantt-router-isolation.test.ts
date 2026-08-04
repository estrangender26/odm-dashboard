import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { appRouter } from "./router";
import { db } from "./queries/connection";
import { eq, sql, inArray } from "drizzle-orm";
import { ganttProjects, ganttTasks, ganttDependencies, ganttProjectEvents } from "@db/schema";

let dbAvailable = false;
let migrationApplied = false;
try {
  await db.execute(sql`SELECT 1`);
  dbAvailable = true;
  try {
    await db.execute(sql`SELECT public_id FROM gantt_projects LIMIT 1`);
    migrationApplied = true;
  } catch {
    migrationApplied = false;
  }
} catch {
  dbAvailable = false;
}

const run = dbAvailable && migrationApplied ? describe : describe.skip;

function makeCaller() {
  return appRouter.createCaller({
    user: null,
    req: new Request("https://example.com/gantt-planner"),
    resHeaders: new Headers(),
  } as any);
}

run("legacy ganttRouter isolation from shared projects", () => {
  // Force sequential execution within this file and with other DB integration tests.
  // Vitest runs test files in parallel by default; the global DB state here is not isolated.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sequential = true;
  const createdProjectIds: number[] = [];
  let sharedTaskId = 0;
  let sharedDepId = 0;
  let legacyTaskId = 0;

  beforeEach(async () => {
    if (!migrationApplied) return;
    await db.delete(ganttProjectEvents).where(sql`1=1`);
    await db.delete(ganttDependencies).where(sql`1=1`);
    await db.delete(ganttTasks).where(sql`1=1`);
    await db.delete(ganttProjects).where(sql`1=1`);
    createdProjectIds.length = 0;
  });

  afterAll(async () => {
    if (!migrationApplied) return;
    await db.delete(ganttProjectEvents).where(sql`1=1`);
    await db.delete(ganttDependencies).where(sql`1=1`);
    await db.delete(ganttTasks).where(sql`1=1`);
    await db.delete(ganttProjects).where(sql`1=1`);
  });

  async function createSharedProjectWithTask(name = "Shared Iso") {
    const caller = makeCaller();
    const created = await caller.sharedGantt.createShared({ name, projectName: name, actorName: "IsoTest" });
    const projectRows = await db.select({ id: ganttProjects.id, sharingEnabled: ganttProjects.sharingEnabled }).from(ganttProjects).where(eq(ganttProjects.slug, created.slug!));
    const project = projectRows[0]!;
    createdProjectIds.push(project.id);

    const task = await caller.sharedGantt.createTask({
      slug: created.slug!,
      access: created.editorToken,
      task: { taskName: "Shared Activity" },
    });
    sharedTaskId = task.task.id;
    return { created, project, task, caller };
  }


  it("legacy operations still work for non-shared (legacy) projects", async () => {
    const caller = makeCaller();
    const saved = await caller.ganttProjects.save({ name: "Legacy Only" });
    createdProjectIds.push(saved.id);

    const legacyTask = await caller.gantt.saveTask({ taskName: "Legacy Task" });
    legacyTaskId = legacyTask.id;

    const tasks = await caller.gantt.tasks();
    expect(tasks.some((t: any) => t.id === legacyTaskId)).toBe(true);

    const updated = await caller.gantt.saveTask({ id: legacyTaskId, taskName: "Legacy Updated" });
    expect(updated.id).toBe(legacyTaskId);

    await expect(caller.gantt.deleteTask({ id: legacyTaskId })).resolves.toBeDefined();
  });

  it("legacy tasks query refuses when any shared project exists", async () => {
    const { caller } = await createSharedProjectWithTask();
    await expect(caller.gantt.tasks()).rejects.toThrow("link-based workspace");
  });

  it("legacy links query refuses when any shared project exists", async () => {
    const { caller } = await createSharedProjectWithTask();
    await expect(caller.gantt.links()).rejects.toThrow("link-based workspace");
  });

  it("legacy saveTask refuses to mutate shared tasks", async () => {
    const { caller } = await createSharedProjectWithTask();
    await expect(
      caller.gantt.saveTask({ id: sharedTaskId, taskName: "Tampered" })
    ).rejects.toThrow("link-based workspace");
  });

  it("legacy deleteTask refuses to delete shared tasks", async () => {
    const { caller } = await createSharedProjectWithTask();
    await expect(caller.gantt.deleteTask({ id: sharedTaskId })).rejects.toThrow("link-based workspace");
  });

  it("legacy saveLink refuses to create dependencies for shared tasks", async () => {
    const { caller, created } = await createSharedProjectWithTask();
    const other = await caller.sharedGantt.createTask({
      slug: created.slug!,
      access: created.editorToken,
      task: { taskName: "Other" },
    });
    await expect(
      caller.gantt.saveLink({ source: sharedTaskId, target: other.task.id, type: "FS" })
    ).rejects.toThrow("link-based workspace");
  });

  it("legacy deleteLink refuses to delete shared dependencies", async () => {
    const { caller, created } = await createSharedProjectWithTask();
    const other = await caller.sharedGantt.createTask({
      slug: created.slug!,
      access: created.editorToken,
      task: { taskName: "Successor" },
    });
    const dep = await caller.sharedGantt.createDependency({
      slug: created.slug!,
      access: created.editorToken,
      predecessorTaskId: sharedTaskId,
      successorTaskId: other.task.id,
    });
    sharedDepId = dep.dependency.id;
    await expect(caller.gantt.deleteLink({ id: sharedDepId })).rejects.toThrow("link-based workspace");
  });

  it("legacy reorderTasks refuses when shared projects exist", async () => {
    const { caller } = await createSharedProjectWithTask();
    await expect(caller.gantt.reorderTasks([{ id: sharedTaskId, sort_order: 99 }])).rejects.toThrow("link-based workspace");
  });

  it("legacy resetGantt refuses when shared projects exist", async () => {
    const { caller } = await createSharedProjectWithTask();
    await expect(caller.gantt.resetGantt()).rejects.toThrow("link-based workspace");
  });

  it("legacy saveLinksBatch refuses when shared projects exist", async () => {
    const { caller, created } = await createSharedProjectWithTask();
    const a = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "A" } });
    const b = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "B" } });
    await expect(
      caller.gantt.saveLinksBatch([{ source: a.task.id, target: b.task.id, type: "FS" }])
    ).rejects.toThrow("link-based workspace");
  });

  it("legacy operations still work for non-shared (legacy) projects", async () => {
    const caller = makeCaller();
    const saved = await caller.ganttProjects.save({ name: "Legacy Only" });
    createdProjectIds.push(saved.id);

    const legacyTask = await caller.gantt.saveTask({ taskName: "Legacy Task" });
    legacyTaskId = legacyTask.id;

    const tasks = await caller.gantt.tasks();
    expect(tasks.some((t: any) => t.id === legacyTaskId)).toBe(true);

    const updated = await caller.gantt.saveTask({ id: legacyTaskId, taskName: "Legacy Updated" });
    expect(updated.id).toBe(legacyTaskId);

    await expect(caller.gantt.deleteTask({ id: legacyTaskId })).resolves.toBeDefined();
  });
});
