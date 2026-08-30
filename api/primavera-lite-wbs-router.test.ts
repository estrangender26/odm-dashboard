import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq, inArray, and, isNull } from "drizzle-orm";
import { ganttProjects, ganttWbsNodes, ganttActivities, ganttProjectEvents } from "@db/schema";
import { appRouter } from "./router";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

const DATABASE_URL = process.env.DATABASE_URL_TEST || "postgresql://postgres:postgres@localhost:5433/primavera_test?sslmode=disable";

const client = postgres(DATABASE_URL, { ssl: false, prepare: false, max: 5 });
const testDb = drizzle(client, { schema });

const caller = appRouter.createCaller({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: undefined,
} as any);

function extractToken(link: string): string {
  return new URL("http://localhost" + link).searchParams.get("access")!;
}

const createdProjectIds: number[] = [];

function assertDisposableTestDatabase() {
  if (process.env.PRIMAVERA_PR1_TEST_DB !== "1") {
    throw new Error("PRIMAVERA_PR1_TEST_DB=1 is required to run these tests");
  }
  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^(primavera_test|odmtest)/.test(dbName)) {
    throw new Error(`Refusing to run tests against non-disposable database: ${dbName}`);
  }
}

async function loadAdmin(project: { project: { slug: string }; adminLink: string }) {
  const token = extractToken(project.adminLink);
  const loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: token });
  return { token, loaded };
}

describe("primaveraLite WBS PR2", () => {
  beforeAll(async () => {
    assertDisposableTestDatabase();
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      const nodeIds = await testDb
        .select({ id: ganttWbsNodes.id })
        .from(ganttWbsNodes)
        .where(inArray(ganttWbsNodes.projectId, createdProjectIds));
      const activityIds = await testDb
        .select({ id: ganttActivities.id })
        .from(ganttActivities)
        .where(inArray(ganttActivities.projectId, createdProjectIds));

      await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
      await testDb.delete(ganttActivities).where(inArray(ganttActivities.id, activityIds.map((r) => r.id)));
      await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.id, nodeIds.map((r) => r.id)));
      await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
    }
    await client.end();
  });

  it("creates a child WBS node under root", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Child Test" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const result = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "Child A",
    });

    expect(result.node.code).toBe("1.1");
    expect(result.node.parentNodeId).toBe(root.id);
    expect(result.revision).toBe(loaded.revision + 1);

    const after = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const updatedRoot = after.wbsNodes.find((n) => n.id === root.id);
    expect(updatedRoot?.isLeaf).toBe(false);
  });

  it("renames a WBS node", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Rename Test" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "Child",
    });

    const renamed = await caller.primaveraLite.renameWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: child.revision,
      nodeId: child.node.id,
      name: "Renamed Child",
    });

    expect(renamed.node.name).toBe("Renamed Child");
  });

  it("rejects activity creation on parent WBS", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Parent Activity" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "Child",
    });

    await expect(
      caller.primaveraLite.createActivity({
        slug: created.project.slug,
        access: token,
        expectedRevision: child.revision,
        activity: { activityName: "On Parent" },
        wbsNodeId: root.id,
      })
    ).rejects.toThrow(/leaf WBS/);
  });

  it("allows activity creation on leaf WBS", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Leaf Activity" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const result = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      activity: { activityName: "On Root" },
    });

    expect(result.activity.activityName).toBe("On Root");
  });

  it("archives and restores a WBS node", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Archive Restore" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "To Archive",
    });

    const dryRun = await caller.primaveraLite.archiveWbsNodeDryRun({
      slug: created.project.slug,
      access: token,
      expectedRevision: child.revision,
      nodeId: child.node.id,
    });

    const archived = await caller.primaveraLite.archiveWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: child.revision,
      nodeId: child.node.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    expect(archived.node.archivedAt).toBeTruthy();

    const after = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    expect(after.wbsNodes.length).toBe(1);
    const updatedRoot = after.wbsNodes.find((n) => n.id === root.id);
    expect(updatedRoot?.isLeaf).toBe(true);

    const restored = await caller.primaveraLite.restoreWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: archived.revision,
      nodeId: child.node.id,
      confirmed: true,
    });

    expect(restored.node.archivedAt).toBeFalsy();
  });

  it("moves a WBS node and updates descendant codes", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Move Test" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const a = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "A",
    });
    const b = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: a.revision,
      parentNodeId: root.id,
      name: "B",
    });
    const b1 = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: b.revision,
      parentNodeId: b.node.id,
      name: "B1",
    });

    // Move B under A
    const moved = await caller.primaveraLite.moveWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: b1.revision,
      nodeId: b.node.id,
      newParentNodeId: a.node.id,
    });

    expect(moved.node.code).toBe("1.1.1");

    const tree = await caller.primaveraLite.listWbsTree({ slug: created.project.slug, access: token });
    const movedB1 = tree.nodes.find((n) => n.id === b1.node.id);
    expect(movedB1?.code).toBe("1.1.1.1");
  });

  it("reorders WBS siblings", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Reorder Test" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const a = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "A",
    });
    const b = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: a.revision,
      parentNodeId: root.id,
      name: "B",
    });

    const reordered = await caller.primaveraLite.reorderWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: b.revision,
      nodeId: b.node.id,
      newSortOrder: 0,
    });

    expect(reordered.node.sortOrder).toBe(0);

    const tree = await caller.primaveraLite.listWbsTree({ slug: created.project.slug, access: token });
    const sorted = tree.nodes.filter((n) => n.parentNodeId === root.id).sort((x, y) => x.sortOrder - y.sortOrder);
    expect(sorted[0].id).toBe(b.node.id);
    expect(sorted[1].id).toBe(a.node.id);
  });

  it("prevents WBS cycles", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Cycle Test" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const a = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "A",
    });
    const b = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: a.revision,
      parentNodeId: a.node.id,
      name: "B",
    });

    // Try moving A under B (cycle)
    await expect(
      caller.primaveraLite.moveWbsNode({
        slug: created.project.slug,
        access: token,
        expectedRevision: b.revision,
        nodeId: a.node.id,
        newParentNodeId: b.node.id,
      })
    ).rejects.toThrow(/beneath itself|descendant|cycle/);
  });

  it("rejects cross-project WBS node references", async () => {
    const a = await caller.primaveraLite.createProject({ name: "Cross Project A" });
    const b = await caller.primaveraLite.createProject({ name: "Cross Project B" });
    createdProjectIds.push(a.project.id, b.project.id);

    const aAdmin = extractToken(a.adminLink);
    const aLoaded = await caller.primaveraLite.load({ slug: a.project.slug, access: aAdmin });
    const aRoot = aLoaded.wbsNodes[0];

    const bAdmin = extractToken(b.adminLink);
    const bLoaded = await caller.primaveraLite.load({ slug: b.project.slug, access: bAdmin });
    const bRoot = bLoaded.wbsNodes[0];

    // Try to create a child under bRoot while authenticated as a admin
    await expect(
      caller.primaveraLite.createWbsNode({
        slug: a.project.slug,
        access: aAdmin,
        expectedRevision: aLoaded.revision,
        parentNodeId: bRoot.id,
        name: "Cross Child",
      })
    ).rejects.toThrow(/not found|Parent WBS/);
  });

  it("rejects duplicate WBS codes", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Duplicate Code" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const a = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "A",
    });

    // Manually insert a node with duplicate code bypassing API, then try create again
    await testDb.insert(ganttWbsNodes).values({
      projectId: created.project.id,
      parentNodeId: root.id,
      code: "1.2",
      name: "Inserted Duplicate",
      sortOrder: 2,
      isLeaf: true,
    });

    // Force recompute root leaf status
    await testDb
      .update(ganttWbsNodes)
      .set({ isLeaf: false, updatedAt: new Date() })
      .where(eq(ganttWbsNodes.id, root.id));

    // Next child should try 1.3 and succeed
    const next = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: a.revision,
      parentNodeId: root.id,
      name: "C",
    });

    expect(next.node.code).toBe("1.3");
  });

  it("maintains leaf status across create and archive", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Leaf Status" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "Child",
    });

    const grandchild = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: child.revision,
      parentNodeId: child.node.id,
      name: "Grandchild",
    });

    const afterCreate = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const childNode = afterCreate.wbsNodes.find((n) => n.id === child.node.id);
    expect(childNode?.isLeaf).toBe(false);

    const dryRun = await caller.primaveraLite.archiveWbsNodeDryRun({
      slug: created.project.slug,
      access: token,
      expectedRevision: grandchild.revision,
      nodeId: grandchild.node.id,
    });
    await caller.primaveraLite.archiveWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: grandchild.revision,
      nodeId: grandchild.node.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    const afterArchive = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const childAfter = afterArchive.wbsNodes.find((n) => n.id === child.node.id);
    expect(childAfter?.isLeaf).toBe(true);
  });

  it("returns CONFLICT on stale revision", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Stale Revision" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "Child",
    });

    await expect(
      caller.primaveraLite.renameWbsNode({
        slug: created.project.slug,
        access: token,
        expectedRevision: loaded.revision,
        nodeId: child.node.id,
        name: "Stale",
      })
    ).rejects.toThrow(/updated by another user|CONFLICT/);
  });

  it("rejects moving root WBS node", async () => {
    const created = await caller.primaveraLite.createProject({ name: "WBS Move Root" });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: "Child",
    });

    await expect(
      caller.primaveraLite.moveWbsNode({
        slug: created.project.slug,
        access: token,
        expectedRevision: child.revision,
        nodeId: root.id,
        newParentNodeId: child.node.id,
      })
    ).rejects.toThrow(/root/);
  });


  it('allows a child WBS node under a node that has an active activity; the activity stays attached', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Child Under Activity Parent' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    // Assign an activity to the root while it is a leaf.
    const act = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      activity: { activityName: 'Root Activity' },
    });
    expect(act.activity.wbsNodeId).toBe(root.id);

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      parentNodeId: root.id,
      name: 'Child A',
    });

    expect(child.node.code).toBe('1.1');
    expect(child.node.parentNodeId).toBe(root.id);
    expect(child.node.isLeaf).toBe(true);

    // The parent is no longer a leaf, but its activity is untouched.
    const after = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const updatedRoot = after.wbsNodes.find((n) => n.id === root.id);
    expect(updatedRoot?.isLeaf).toBe(false);
    const rootActivity = after.activities.find((a) => a.id === act.activity.id);
    expect(rootActivity).toBeTruthy();
    expect(rootActivity?.wbsNodeId).toBe(root.id);
    expect(rootActivity?.activityName).toBe('Root Activity');
    expect(rootActivity?.archivedAt).toBeFalsy();
  });

  it('allows multiple children under a node that has an active activity', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Multiple Children Under Activity Parent' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      activity: { activityName: 'Root Activity' },
    });

    const names = ['Child A', 'Child B', 'Child C'];
    const codes: string[] = [];
    for (const name of names) {
      const loadedBefore = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
      const result = await caller.primaveraLite.createWbsNode({
        slug: created.project.slug,
        access: token,
        expectedRevision: loadedBefore.revision,
        parentNodeId: root.id,
        name,
      });
      codes.push(result.node.code);
    }

    expect(codes).toEqual(['1.1', '1.2', '1.3']);

    const after = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    expect(after.wbsNodes.filter((n) => n.parentNodeId === root.id && !n.archivedAt)).toHaveLength(3);
    // The activity on the parent survives all three creates.
    expect(after.activities.find((a) => a.activityName === 'Root Activity')?.wbsNodeId).toBe(root.id);
    expect(after.wbsNodes.find((n) => n.id === root.id)?.isLeaf).toBe(false);
  });

  it('allows nested (grandchild) WBS under an activity parent and keeps all assignments', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Nested Under Activity Parent' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      activity: { activityName: 'Root Activity' },
    });

    const loaded1 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const childA = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded1.revision,
      parentNodeId: root.id,
      name: 'Child A',
    });

    // Put an activity on Child A, then decompose it further with a grandchild.
    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const childActivity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      activity: { activityName: 'Child A Activity' },
      wbsNodeId: childA.node.id,
    });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const grandchild = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded3.revision,
      parentNodeId: childA.node.id,
      name: 'Grandchild',
    });
    expect(grandchild.node.code).toBe('1.1.1');

    const after = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    expect(after.wbsNodes.find((n) => n.id === childA.node.id)?.isLeaf).toBe(false);
    expect(after.wbsNodes.find((n) => n.id === root.id)?.isLeaf).toBe(false);
    // Both the parent activity and the child activity remain attached.
    expect(after.activities.find((a) => a.id === childActivity.activity.id)?.wbsNodeId).toBe(childA.node.id);
    expect(after.activities.find((a) => a.activityName === 'Root Activity')?.wbsNodeId).toBe(root.id);
  });

  it('schedules a project whose WBS parents have both activities and children', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Schedule With Activity Parents' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    // Root activity (parent later gains children).
    const rootAct = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      activity: { activityName: 'Root Activity', originalDurationDays: 3 },
    });

    const loaded1 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const childA = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded1.revision,
      parentNodeId: root.id,
      name: 'Child A',
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const childAct = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      activity: { activityName: 'Child A Activity', originalDurationDays: 2 },
      wbsNodeId: childA.node.id,
    });

    // Decompose Child A further while it already has an activity.
    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const grandchild = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded3.revision,
      parentNodeId: childA.node.id,
      name: 'Grandchild',
    });
    expect(grandchild.node.code).toBe('1.1.1');

    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    await expect(
      caller.primaveraLite.runSchedule({
        slug: created.project.slug,
        access: token,
        expectedRevision: loaded4.revision,
      })
    ).resolves.toBeTruthy();

    const after = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    expect(after.project?.scheduleOutOfDate).toBe(false);
    // Both the parent activity and the child activity were scheduled.
    const scheduledRoot = after.activities.find((a) => a.id === rootAct.activity.id);
    const scheduledChild = after.activities.find((a) => a.id === childAct.activity.id);
    expect(scheduledRoot?.earlyStart).toBeTruthy();
    expect(scheduledChild?.earlyStart).toBeTruthy();
  });

  it('archive/restore keeps working for a node that has both activities and children', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Archive Activity Parent With Children' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const loaded1 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const childA = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded1.revision,
      parentNodeId: root.id,
      name: 'Child A',
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const childAct = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      activity: { activityName: 'Child A Activity' },
      wbsNodeId: childA.node.id,
    });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const grandchild = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded3.revision,
      parentNodeId: childA.node.id,
      name: 'Grandchild',
    });

    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const dryRun = await caller.primaveraLite.archiveWbsNodeDryRun({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded4.revision,
      nodeId: childA.node.id,
    });
    // The node's own activity plus the descendant node are archived together.
    expect(dryRun.wouldArchive.activities).toBe(1);
    expect(dryRun.wouldArchive.wbsNodes).toBe(2);

    await caller.primaveraLite.archiveWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded4.revision,
      nodeId: childA.node.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    const archivedRows = await testDb
      .select({ archivedAt: ganttActivities.archivedAt })
      .from(ganttActivities)
      .where(eq(ganttActivities.id, childAct.activity.id));
    expect(archivedRows[0].archivedAt).toBeTruthy();

    const loaded5 = await caller.primaveraLite.load({ slug: created.project.slug, access: token, includeArchived: true });
    const restored = await caller.primaveraLite.restoreWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded5.revision,
      nodeId: childA.node.id,
      confirmed: true,
    });
    expect(restored.node.archivedAt).toBeFalsy();

    const restoredActivityRows = await testDb
      .select({ archivedAt: ganttActivities.archivedAt })
      .from(ganttActivities)
      .where(eq(ganttActivities.id, childAct.activity.id));
    expect(restoredActivityRows[0].archivedAt).toBeFalsy();
    // Grandchild restored too.
    const grandchildRows = await testDb
      .select({ archivedAt: ganttWbsNodes.archivedAt })
      .from(ganttWbsNodes)
      .where(eq(ganttWbsNodes.id, grandchild.node.id));
    expect(grandchildRows[0].archivedAt).toBeFalsy();
  });

  it('cannot move node under node with active activity', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Move Parent Activity Block' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const a = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: 'A',
    });
    const b = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: a.revision,
      parentNodeId: root.id,
      name: 'B',
    });

    // Put an activity on A
    await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: b.revision,
      activity: { activityName: 'A Activity' },
      wbsNodeId: a.node.id,
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    await expect(
      caller.primaveraLite.moveWbsNode({
        slug: created.project.slug,
        access: token,
        expectedRevision: loaded2.revision,
        nodeId: b.node.id,
        newParentNodeId: a.node.id,
      })
    ).rejects.toThrow(/node that has activities/);
  });

  it('WBS archive archives active subtree activities', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Archive Activities' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: 'Child',
    });

    const act = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: child.revision,
      activity: { activityName: 'Child Activity' },
      wbsNodeId: child.node.id,
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const dryRun = await caller.primaveraLite.archiveWbsNodeDryRun({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      nodeId: child.node.id,
    });
    expect(dryRun.wouldArchive.activities).toBe(1);

    await caller.primaveraLite.archiveWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      nodeId: child.node.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    const archivedRows = await testDb
      .select({ archivedAt: ganttActivities.archivedAt })
      .from(ganttActivities)
      .where(eq(ganttActivities.id, act.activity.id));
    expect(archivedRows[0].archivedAt).toBeTruthy();
  });

  it('WBS restore restores only same-cascade activities and keeps independently archived', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Restore Activities' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: 'Child',
    });

    const independentActivity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: child.revision,
      activity: { activityName: 'Independent' },
      wbsNodeId: child.node.id,
    });

    // Archive the activity independently first (different timestamp).
    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const activityDryRun = await caller.primaveraLite.archiveActivityDryRun({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      activityId: independentActivity.activity.id,
    });
    await caller.primaveraLite.archiveActivity({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      activityId: independentActivity.activity.id,
      previewToken: activityDryRun.previewToken,
      confirmed: true,
    });

    // Now archive the WBS node; it should not overwrite the independently archived activity.
    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const dryRun = await caller.primaveraLite.archiveWbsNodeDryRun({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded3.revision,
      nodeId: child.node.id,
    });
    expect(dryRun.wouldArchive.activities).toBe(0);
    const archived = await caller.primaveraLite.archiveWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded3.revision,
      nodeId: child.node.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    // Restore the WBS node; the independently archived activity must stay archived.
    await caller.primaveraLite.restoreWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: archived.revision,
      nodeId: child.node.id,
      confirmed: true,
    });

    const rows = await testDb
      .select({ archivedAt: ganttActivities.archivedAt })
      .from(ganttActivities)
      .where(eq(ganttActivities.id, independentActivity.activity.id));
    expect(rows[0].archivedAt).toBeTruthy();
  });

  it('archived code is not reused', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Code Reserved' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const a = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: 'A',
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const dryRun = await caller.primaveraLite.archiveWbsNodeDryRun({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      nodeId: a.node.id,
    });
    await caller.primaveraLite.archiveWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      nodeId: a.node.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const b = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded3.revision,
      parentNodeId: root.id,
      name: 'B',
    });
    expect(b.node.code).toBe('1.2');  // 1.1 is reserved by archived A
  });

  it('restore collision returns controlled CONFLICT', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Restore Collision' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const a = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: 'A',
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const dryRun = await caller.primaveraLite.archiveWbsNodeDryRun({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      nodeId: a.node.id,
    });
    const archived = await caller.primaveraLite.archiveWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded2.revision,
      nodeId: a.node.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    // Manually insert an active node with code 1.1 to create a collision.
    await testDb.insert(ganttWbsNodes).values({
      projectId: created.project.id,
      parentNodeId: root.id,
      code: '1.1',
      name: 'Collision',
      sortOrder: 1,
      isLeaf: true,
    });

    // Restoring A should now conflict
    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    const activeBefore = await testDb
      .select({ id: ganttWbsNodes.id, code: ganttWbsNodes.code, archivedAt: ganttWbsNodes.archivedAt })
      .from(ganttWbsNodes)
      .where(and(eq(ganttWbsNodes.projectId, created.project.id), eq(ganttWbsNodes.code, '1.1')));
    console.log('// ', activeBefore);
    await expect(
      caller.primaveraLite.restoreWbsNode({
        slug: created.project.slug,
        access: token,
        expectedRevision: loaded4.revision,
        nodeId: a.node.id,
        confirmed: true,
      })
    ).rejects.toThrow(/WBS code collision|CONFLICT/);
  });

  it('cannot create second root', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS No Second Root' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    await expect(
      caller.primaveraLite.createWbsNode({
        slug: created.project.slug,
        access: token,
        expectedRevision: loaded.revision,
        parentNodeId: null,
        name: 'Fake Root',
      })
    ).rejects.toThrow(/Only the project root may have no parent/);
  });

  it('cannot move node to null', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS No Move To Root' });
    createdProjectIds.push(created.project.id);
    const { token, loaded } = await loadAdmin(created);
    const root = loaded.wbsNodes[0];

    const child = await caller.primaveraLite.createWbsNode({
      slug: created.project.slug,
      access: token,
      expectedRevision: loaded.revision,
      parentNodeId: root.id,
      name: 'Child',
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: token });
    await expect(
      caller.primaveraLite.moveWbsNode({
        slug: created.project.slug,
        access: token,
        expectedRevision: loaded2.revision,
        nodeId: child.node.id,
        newParentNodeId: null,
      })
    ).rejects.toThrow(/root/);
  });

  it('editor/viewer cannot list archived nodes', async () => {
    const created = await caller.primaveraLite.createProject({ name: 'WBS Admin Archived List' });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);
    const viewerToken = extractToken(created.viewerLink);

    await expect(
      caller.primaveraLite.listWbsTree({ slug: created.project.slug, access: editorToken, includeArchived: true })
    ).rejects.toThrow(/Admin token required|FORBIDDEN/);

    await expect(
      caller.primaveraLite.listWbsTree({ slug: created.project.slug, access: viewerToken, includeArchived: true })
    ).rejects.toThrow(/Admin token required|FORBIDDEN/);

    // Admin can
    const adminList = await caller.primaveraLite.listWbsTree({ slug: created.project.slug, access: adminToken, includeArchived: true });
    expect(adminList.nodes.length).toBeGreaterThanOrEqual(1);
  });
});
