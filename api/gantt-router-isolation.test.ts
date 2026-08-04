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

// Safety guard: refuse to run destructive integration cleanup on non-test databases.
function getDatabaseName(): string {
  const url = process.env.DATABASE_URL ?? "";
  try {
    return new URL(url).pathname.replace(/^\//, "") || "unknown";
  } catch {
    return "unknown";
  }
}
const isTestDatabase = getDatabaseName().startsWith("odmtest");
const testEnvEnabled = process.env.GANTT_ISOLATION_TEST_DB === "1";

const run = dbAvailable && migrationApplied && isTestDatabase && testEnvEnabled ? describe : describe.skip;

function makeCaller() {
  return appRouter.createCaller({
    user: null,
    req: new Request("https://example.com/gantt-planner"),
    resHeaders: new Headers(),
  } as any);
}

run("legacy ganttRouter isolation from shared projects", () => {
  const createdProjectIds: number[] = [];
  const createdTaskIds: number[] = [];
  const createdDepIds: number[] = [];
  let sharedTaskId = 0;
  let sharedDepId = 0;

  beforeEach(async () => {
    if (!migrationApplied) return;
    await db.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
    await db.delete(ganttDependencies).where(
      or_(
        inArray(ganttDependencies.id, createdDepIds),
        inArray(ganttDependencies.predecessorTaskId, createdTaskIds),
        inArray(ganttDependencies.successorTaskId, createdTaskIds)
      )
    );
    await db.delete(ganttTasks).where(inArray(ganttTasks.id, createdTaskIds));
    await db.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
    createdProjectIds.length = 0;
    createdTaskIds.length = 0;
    createdDepIds.length = 0;
  });

  afterAll(async () => {
    if (!migrationApplied) return;
    await db.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
    await db.delete(ganttDependencies).where(
      or_(
        inArray(ganttDependencies.id, createdDepIds),
        inArray(ganttDependencies.predecessorTaskId, createdTaskIds),
        inArray(ganttDependencies.successorTaskId, createdTaskIds)
      )
    );
    await db.delete(ganttTasks).where(inArray(ganttTasks.id, createdTaskIds));
    await db.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
  });

  async function createLegacyProject(name = "Legacy Coexist") {
    const caller = makeCaller();
    const saved = await caller.ganttProjects.save({ name });
    createdProjectIds.push(saved.id);
    return { caller, projectId: saved.id };
  }

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
    createdTaskIds.push(task.task.id);
    return { created, project, task: task.task, caller };
  }

  it("legacy and shared tasks coexist: legacy visible, shared hidden", async () => {
    const { caller, projectId } = await createLegacyProject();
    const legacyTask = await caller.gantt.saveTask({ taskName: "Legacy Task", projectId });
    createdTaskIds.push(legacyTask.id);

    await createSharedProjectWithTask();

    const tasks = await caller.gantt.tasks();
    expect(tasks.some((t: any) => t.id === legacyTask.id)).toBe(true);
    expect(tasks.some((t: any) => t.id === sharedTaskId)).toBe(false);
  });

  it("legacy task remains editable while shared task is protected", async () => {
    const { caller, projectId } = await createLegacyProject();
    const legacyTask = await caller.gantt.saveTask({ taskName: "Legacy Task", projectId });
    createdTaskIds.push(legacyTask.id);
    const { task: sharedTask } = await createSharedProjectWithTask();

    const updated = await caller.gantt.saveTask({ id: legacyTask.id, taskName: "Legacy Updated" });
    expect(updated.id).toBe(legacyTask.id);

    await expect(
      caller.gantt.saveTask({ id: sharedTask.id, taskName: "Tampered" })
    ).rejects.toThrow("link-based workspace");
  });

  it("legacy dependencies remain manageable while shared dependencies are protected", async () => {
    const { caller, projectId } = await createLegacyProject();
    const a = await caller.gantt.saveTask({ taskName: "Legacy A", projectId });
    const b = await caller.gantt.saveTask({ taskName: "Legacy B", projectId });
    createdTaskIds.push(a.id, b.id);

    const link = await caller.gantt.saveLink({ source: a.id, target: b.id, type: "FS", projectId });
    createdDepIds.push(link.id);

    const links = await caller.gantt.links();
    expect(links.some((l: any) => l.id === link.id)).toBe(true);

    await expect(caller.gantt.deleteLink({ id: link.id })).resolves.toBeDefined();
    createdDepIds.length = 0;

    const { task: sharedA, created: sharedProject } = await createSharedProjectWithTask();
    const sharedB = await makeCaller().sharedGantt.createTask({
      slug: sharedProject.slug!,
      access: sharedProject.editorToken,
      task: { taskName: "Shared B" },
    });
    createdTaskIds.push(sharedB.task.id);
    const sharedDep = await makeCaller().sharedGantt.createDependency({
      slug: sharedProject.slug!,
      access: sharedProject.editorToken,
      predecessorTaskId: sharedA.id,
      successorTaskId: sharedB.task.id,
    });
    sharedDepId = sharedDep.dependency.id;
    createdDepIds.push(sharedDep.dependency.id);

    await expect(caller.gantt.deleteLink({ id: sharedDepId })).rejects.toThrow("link-based workspace");
  });

  it("legacy resetGantt preserves shared rows and requires confirmation", async () => {
    const { caller, projectId } = await createLegacyProject();
    const legacyTask = await caller.gantt.saveTask({ taskName: "Legacy Reset", projectId });
    createdTaskIds.push(legacyTask.id);
    await createSharedProjectWithTask();

    const dryRun = await caller.gantt.resetGantt({ dryRun: true });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.wouldDelete?.tasks).toBeGreaterThanOrEqual(1);

    const unconfirmed = await caller.gantt.resetGantt({ confirmed: false });
    expect(unconfirmed.success).toBe(false);

    const confirmed = await caller.gantt.resetGantt({ confirmed: true });
    expect(confirmed.success).toBe(true);
    expect(confirmed.deleted?.tasks).toBeGreaterThanOrEqual(1);

    // Shared rows survived.
    const sharedStillExists = await db.select().from(ganttTasks).where(eq(ganttTasks.id, sharedTaskId));
    expect(sharedStillExists.length).toBe(1);
  });

  it("legacy rows with project_id NULL remain visible", async () => {
    const caller = makeCaller();
    const freeTask = await caller.gantt.saveTask({ taskName: "Free Legacy Task" });
    createdTaskIds.push(freeTask.id);
    await createSharedProjectWithTask();

    const tasks = await caller.gantt.tasks();
    expect(tasks.some((t: any) => t.id === freeTask.id)).toBe(true);
  });

  it("unrelated pre-existing rows survive the test lifecycle", async () => {
    const { caller: caller1, projectId } = await createLegacyProject();
    const survivor = await caller1.gantt.saveTask({ taskName: "Survivor", projectId });
    createdTaskIds.push(survivor.id);

    // Simulate a separate test that creates and removes its own data.
    const { caller: caller2, projectId: projectId2 } = await createLegacyProject();
    const temp = await caller2.gantt.saveTask({ taskName: "Temp", projectId: projectId2 });
    createdTaskIds.push(temp.id);
    await db.delete(ganttTasks).where(eq(ganttTasks.id, temp.id));
    createdTaskIds.splice(createdTaskIds.indexOf(temp.id), 1);

    const tasks = await caller1.gantt.tasks();
    expect(tasks.some((t: any) => t.id === survivor.id)).toBe(true);
  });
});

// Dummy import to satisfy eslint if needed; no actual usage beyond types.
function or_(...args: any[]) {
  return sql`(${sql.join(args, sql` OR `)})`;
}
