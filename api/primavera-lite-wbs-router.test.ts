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
});
