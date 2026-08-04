import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "./router";
import { db } from "./queries/connection";
import { hashToken } from "@/modules/gantt/collaboration/accessToken";
import { eq, and, sql, inArray } from "drizzle-orm";
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
    req: new Request("https://example.com/gantt/p/test"),
    resHeaders: new Headers(),
  } as any);
}

run("sharedGanttRouter integration", () => {
  const createdProjectIds: number[] = [];

  afterAll(async () => {
    if (!migrationApplied || createdProjectIds.length === 0) return;
    await db.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
    await db.delete(ganttDependencies).where(inArray(ganttDependencies.projectId, createdProjectIds));
    await db.delete(ganttTasks).where(inArray(ganttTasks.projectId, createdProjectIds));
    await db.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
  });

  async function createProject(name = "Test Project") {
    const caller = makeCaller();
    const created = await caller.sharedGantt.createShared({
      name,
      projectName: name,
      actorName: "IntegrationTest",
    });
    const row = await db
      .select({ id: ganttProjects.id, editTokenHash: ganttProjects.editTokenHash, viewTokenHash: ganttProjects.viewTokenHash, revision: ganttProjects.revision })
      .from(ganttProjects)
      .where(eq(ganttProjects.slug, created.slug!));
    const project = row[0]!;
    createdProjectIds.push(project.id);
    return { created, project, caller };
  }

  it("creates a shared project and returns editor + viewer tokens", async () => {
    const { created, project } = await createProject();
    expect(created.editorToken).toBeTruthy();
    expect(created.viewToken).toBeTruthy();
    expect(created.editorToken).not.toBe(created.viewToken);
    expect(project.editTokenHash).toBe(await hashToken(created.editorToken));
    expect(project.viewTokenHash).toBe(await hashToken(created.viewToken));
  });

  it("viewer can load but cannot mutate", async () => {
    const { created, caller } = await createProject();
    const load = await caller.sharedGantt.load({ slug: created.slug!, access: created.viewToken });
    expect(load.role).toBe("viewer");
    await expect(
      caller.sharedGantt.createTask({
        slug: created.slug!,
        access: created.viewToken,
        task: { taskName: "Viewer task" },
      })
    ).rejects.toThrow("View-only link cannot modify");
  });

  it("editor can create and update a task", async () => {
    const { created, caller } = await createProject();
    const task = await caller.sharedGantt.createTask({
      slug: created.slug!,
      access: created.editorToken,
      task: { taskName: "Activity A" },
    });
    expect(task.success).toBe(true);
    expect(task.task.taskName).toBe("Activity A");

    const updated = await caller.sharedGantt.updateTask({
      slug: created.slug!,
      access: created.editorToken,
      taskId: task.task.id,
      expectedRevision: task.task.revision,
      changes: { progressPercent: 50 },
    });
    expect(updated.task.progressPercent).toBe(50);
    expect(updated.projectRevision).toBeGreaterThan(task.projectRevision);
  });

  it("rejects invalid and revoked tokens", async () => {
    const { created, caller } = await createProject();
    await expect(caller.sharedGantt.load({ slug: created.slug!, access: "bad-token" })).rejects.toThrow("Invalid access token");

    await caller.sharedGantt.share({
      slug: created.slug!,
      access: created.editorToken,
      operations: { revokeEditor: true, revokeViewer: true, confirmed: true },
    });
    await expect(caller.sharedGantt.load({ slug: created.slug!, access: created.editorToken })).rejects.toThrow("sharing is not enabled");
    await expect(caller.sharedGantt.load({ slug: created.slug!, access: created.viewToken })).rejects.toThrow("sharing is not enabled");
  });

  it("rejects mutation when sharing is disabled", async () => {
    const { created, caller } = await createProject();
    await db.update(ganttProjects).set({ sharingEnabled: 0 }).where(eq(ganttProjects.slug, created.slug!));
    await expect(caller.sharedGantt.load({ slug: created.slug!, access: created.editorToken })).rejects.toThrow("sharing is not enabled");
    await db.update(ganttProjects).set({ sharingEnabled: 1 }).where(eq(ganttProjects.slug, created.slug!));
  });

  it("regenerates editor and viewer tokens independently", async () => {
    const { created, caller } = await createProject();
    const regenEditor = await caller.sharedGantt.share({
      slug: created.slug!,
      access: created.editorToken,
      operations: { regenerateEditor: true, confirmed: true },
    });
    expect(regenEditor.editorToken).toBeTruthy();
    expect(regenEditor.viewToken).toBeNull();

    await expect(caller.sharedGantt.load({ slug: created.slug!, access: created.editorToken })).rejects.toThrow("Invalid access token");
    const load = await caller.sharedGantt.load({ slug: created.slug!, access: regenEditor.editorToken! });
    expect(load.role).toBe("editor");

    const viewLoad = await caller.sharedGantt.load({ slug: created.slug!, access: created.viewToken });
    expect(viewLoad.role).toBe("viewer");
  });

  it("returns CONFLICT when two participants update the same task revision", async () => {
    const { created, caller } = await createProject();
    const task = await caller.sharedGantt.createTask({
      slug: created.slug!,
      access: created.editorToken,
      task: { taskName: "Conflict test" },
    });
    await caller.sharedGantt.updateTask({
      slug: created.slug!,
      access: created.editorToken,
      taskId: task.task.id,
      expectedRevision: task.task.revision,
      changes: { taskName: "First edit" },
    });
    await expect(
      caller.sharedGantt.updateTask({
        slug: created.slug!,
        access: created.editorToken,
        taskId: task.task.id,
        expectedRevision: task.task.revision,
        changes: { taskName: "Stale edit" },
      })
    ).rejects.toThrow("updated by another participant");
  });

  it("allocates unique ordered project revisions for concurrent edits", async () => {
    const { created, caller, project } = await createProject();
    const taskA = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "A" } });
    const taskB = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "B" } });
    const [r1, r2] = await Promise.all([
      caller.sharedGantt.updateTask({
        slug: created.slug!,
        access: created.editorToken,
        taskId: taskA.task.id,
        expectedRevision: taskA.task.revision,
        changes: { progressPercent: 10 },
      }),
      caller.sharedGantt.updateTask({
        slug: created.slug!,
        access: created.editorToken,
        taskId: taskB.task.id,
        expectedRevision: taskB.task.revision,
        changes: { progressPercent: 20 },
      }),
    ]);
    expect(r1.projectRevision).not.toBe(r2.projectRevision);
    const events = await db
      .select({ projectRevision: ganttProjectEvents.projectRevision })
      .from(ganttProjectEvents)
      .where(eq(ganttProjectEvents.projectId, project.id))
      .orderBy(ganttProjectEvents.projectRevision);
    const revisions = events.map((e) => e.projectRevision).filter(Boolean) as number[];
    for (let i = 1; i < revisions.length; i++) {
      expect(revisions[i]).toBeGreaterThan(revisions[i - 1]);
    }
  });

  it("rejects cross-project dependencies", async () => {
    const p1 = await createProject("P1");
    const p2 = await createProject("P2");
    const p1Task = await p1.caller.sharedGantt.createTask({ slug: p1.created.slug!, access: p1.created.editorToken, task: { taskName: "P1 task" } });
    const p2Task = await p2.caller.sharedGantt.createTask({ slug: p2.created.slug!, access: p2.created.editorToken, task: { taskName: "P2 task" } });
    await expect(
      p1.caller.sharedGantt.createDependency({
        slug: p1.created.slug!,
        access: p1.created.editorToken,
        predecessorTaskId: p2Task.task.id,
        successorTaskId: p1Task.task.id,
      })
    ).rejects.toThrow("shared project");
  });

  it("rejects invalid dependency type and duplicates and cycles", async () => {
    const { created, caller } = await createProject();
    const a = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "A" } });
    const b = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "B" } });

    await expect(
      caller.sharedGantt.createDependency({
        slug: created.slug!,
        access: created.editorToken,
        predecessorTaskId: a.task.id,
        successorTaskId: b.task.id,
        dependencyType: "XX" as any,
      })
    ).rejects.toThrow();

    const dep = await caller.sharedGantt.createDependency({
      slug: created.slug!,
      access: created.editorToken,
      predecessorTaskId: a.task.id,
      successorTaskId: b.task.id,
    });
    expect(dep.success).toBe(true);

    await expect(
      caller.sharedGantt.createDependency({
        slug: created.slug!,
        access: created.editorToken,
        predecessorTaskId: a.task.id,
        successorTaskId: b.task.id,
      })
    ).rejects.toThrow("already exists");

    await expect(
      caller.sharedGantt.createDependency({
        slug: created.slug!,
        access: created.editorToken,
        predecessorTaskId: b.task.id,
        successorTaskId: a.task.id,
      })
    ).rejects.toThrow("cycle");
  });

  it("does not let another project cause a false dependency cycle", async () => {
    const p1 = await createProject("P1");
    const p2 = await createProject("P2");
    const p1A = await p1.caller.sharedGantt.createTask({ slug: p1.created.slug!, access: p1.created.editorToken, task: { taskName: "P1-A" } });
    const p1B = await p1.caller.sharedGantt.createTask({ slug: p1.created.slug!, access: p1.created.editorToken, task: { taskName: "P1-B" } });
    const p2C = await p2.caller.sharedGantt.createTask({ slug: p2.created.slug!, access: p2.created.editorToken, task: { taskName: "P2-C" } });
    const p2D = await p2.caller.sharedGantt.createTask({ slug: p2.created.slug!, access: p2.created.editorToken, task: { taskName: "P2-D" } });

    // A dependency in p2 must not affect cycle detection in p1.
    await p2.caller.sharedGantt.createDependency({
      slug: p2.created.slug!,
      access: p2.created.editorToken,
      predecessorTaskId: p2C.task.id,
      successorTaskId: p2D.task.id,
    });

    const dep = await p1.caller.sharedGantt.createDependency({
      slug: p1.created.slug!,
      access: p1.created.editorToken,
      predecessorTaskId: p1A.task.id,
      successorTaskId: p1B.task.id,
    });
    expect(dep.success).toBe(true);

    // The reverse in p1 should still be a cycle.
    await expect(
      p1.caller.sharedGantt.createDependency({
        slug: p1.created.slug!,
        access: p1.created.editorToken,
        predecessorTaskId: p1B.task.id,
        successorTaskId: p1A.task.id,
      })
    ).rejects.toThrow("cycle");
  });

  it("rejects direct and indirect WBS hierarchy cycles", async () => {
    const { created, caller } = await createProject();
    const a = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "A" } });

    // Direct self-parenting.
    await expect(
      caller.sharedGantt.updateTask({
        slug: created.slug!,
        access: created.editorToken,
        taskId: a.task.id,
        expectedRevision: a.task.revision,
        changes: { parentTaskId: a.task.id },
      })
    ).rejects.toThrow("own parent");

    const b = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "B", parentTaskId: a.task.id } });
    const c = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "C", parentTaskId: b.task.id } });

    // Indirect cycle: A under C.
    await expect(
      caller.sharedGantt.updateTask({
        slug: created.slug!,
        access: created.editorToken,
        taskId: a.task.id,
        expectedRevision: a.task.revision + 1,
        changes: { parentTaskId: c.task.id },
      })
    ).rejects.toThrow("WBS hierarchy cycle");
  });

  it("serializes WBS hierarchy validation under concurrent parent updates", async () => {
    const { created, caller } = await createProject();
    const a = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "A" } });
    const b = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "B" } });

    // Concurrent attempts to make A a child of B and B a child of A cannot both succeed.
    const [r1, r2] = await Promise.allSettled([
      caller.sharedGantt.updateTask({
        slug: created.slug!,
        access: created.editorToken,
        taskId: a.task.id,
        expectedRevision: a.task.revision,
        changes: { parentTaskId: b.task.id },
      }),
      caller.sharedGantt.updateTask({
        slug: created.slug!,
        access: created.editorToken,
        taskId: b.task.id,
        expectedRevision: b.task.revision,
        changes: { parentTaskId: a.task.id },
      }),
    ]);
    const succeeded = [r1, r2].filter((r) => r.status === "fulfilled").length;
    const failed = [r1, r2].filter((r) => r.status === "rejected").length;
    expect(succeeded).toBe(1);
    expect(failed).toBe(1);
  });

  it("enforces project task maximums under concurrent creation", async () => {
    const { created, caller } = await createProject();
    const original = process.env.GANTT_MAX_TASKS;
    process.env.GANTT_MAX_TASKS = "4";
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          caller.sharedGantt.createTask({
            slug: created.slug!,
            access: created.editorToken,
            task: { taskName: `Concurrent ${i}` },
          })
        )
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      expect(succeeded).toBeLessThanOrEqual(4);
      expect(succeeded + failed).toBe(6);
      const remaining = await db.select({ count: sql<number>`count(*)::int` }).from(ganttTasks).where(eq(ganttTasks.projectId, created.projectId));
      expect(remaining[0]?.count).toBeLessThanOrEqual(4);
    } finally {
      process.env.GANTT_MAX_TASKS = original;
    }
  });

  it("requires expected revision for task and dependency deletion", async () => {
    const { created, caller } = await createProject();
    const task = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "Delete me" } });
    const other = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "Other" } });
    await expect(
      caller.sharedGantt.deleteTask({
        slug: created.slug!,
        access: created.editorToken,
        taskId: task.task.id,
        expectedRevision: 999,
        confirmed: true,
      })
    ).rejects.toThrow("updated by another participant");

    const dep = await caller.sharedGantt.createDependency({
      slug: created.slug!,
      access: created.editorToken,
      predecessorTaskId: other.task.id,
      successorTaskId: task.task.id,
    });
    await expect(
      caller.sharedGantt.deleteDependency({
        slug: created.slug!,
        access: created.editorToken,
        dependencyId: dep.dependency.id,
        expectedRevision: 999,
      })
    ).rejects.toThrow("updated by another participant");
  });

  it("returns task deletion impact and prevents orphaned dependencies/hierarchy", async () => {
    const { created, caller, project } = await createProject();
    const parent = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "Parent", isParent: 1 } });
    const child = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "Child", parentTaskId: parent.task.id } });
    const other = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "Other" } });
    const dep = await caller.sharedGantt.createDependency({
      slug: created.slug!,
      access: created.editorToken,
      predecessorTaskId: other.task.id,
      successorTaskId: child.task.id,
    });

    const impact = await caller.sharedGantt.deleteTaskImpact({
      slug: created.slug!,
      access: created.editorToken,
      taskId: parent.task.id,
    });
    expect(impact.impact.childTasks.map((t) => t.id)).toContain(child.task.id);
    expect(impact.impact.predecessorDependencies.map((d) => d.id)).toContain(dep.dependency.id);

    await caller.sharedGantt.deleteTask({
      slug: created.slug!,
      access: created.editorToken,
      taskId: parent.task.id,
      expectedRevision: parent.task.revision,
      confirmed: true,
    });

    const remainingDeps = await db.select().from(ganttDependencies).where(eq(ganttDependencies.projectId, project.id));
    expect(remainingDeps.length).toBe(0);
    const remainingTasks = await db.select().from(ganttTasks).where(eq(ganttTasks.projectId, project.id));
    expect(remainingTasks.map((t) => t.taskName).sort()).toEqual(["Other"]);
  });

  it("polling returns correct revisions", async () => {
    const { created, caller } = await createProject();
    const before = await caller.sharedGantt.load({ slug: created.slug!, access: created.editorToken });
    const task = await caller.sharedGantt.createTask({ slug: created.slug!, access: created.editorToken, task: { taskName: "Poll test" } });
    const poll = await caller.sharedGantt.pollEvents({
      slug: created.slug!,
      access: created.editorToken,
      afterRevision: before.project.revision,
    });
    expect(poll.projectRevision).toBe(task.projectRevision);
    expect(poll.events.length).toBeGreaterThan(0);
  });

  it("enforces createShared input size limits", async () => {
    const caller = makeCaller();
    await expect(
      caller.sharedGantt.createShared({ name: "x", description: "a".repeat(10000) })
    ).rejects.toThrow();
  });

  it("does not regenerate tokens when regenerate flags are false", async () => {
    const { created, caller, project } = await createProject();
    await caller.sharedGantt.share({
      slug: created.slug!,
      access: created.editorToken,
      operations: { regenerateEditor: false, regenerateViewer: false, confirmed: true },
    });
    const after = await db.select({ editTokenHash: ganttProjects.editTokenHash, viewTokenHash: ganttProjects.viewTokenHash }).from(ganttProjects).where(eq(ganttProjects.id, project.id));
    expect(after[0]!.editTokenHash).toBe(project.editTokenHash);
    expect(after[0]!.viewTokenHash).toBe(project.viewTokenHash);
  });
});
