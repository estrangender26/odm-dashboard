import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { ganttProjects } from "@db/schema";
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

describe("primaveraLite router PR1", () => {
  let adminLink: string;
  let slug: string;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    await testDb.execute(sql`DELETE FROM gantt_activities WHERE 1=1`);
    await testDb.execute(sql`DELETE FROM gantt_wbs_nodes WHERE 1=1`);
    await testDb.execute(sql`DELETE FROM gantt_project_events WHERE 1=1`);
    await testDb.execute(sql`DELETE FROM gantt_projects WHERE slug LIKE 'pr1-test-%'`);
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates a project with admin/editor/viewer tokens and root WBS node", async () => {
    const created = await caller.primaveraLite.createProject({ name: "PR1 Test Project" });
    expect(created.project).toBeDefined();
    expect(created.rootWbsNode).toBeDefined();
    expect(created.rootWbsNode.code).toBe("1");
    expect(created.adminLink).toContain("/gantt/p/");
    expect(created.editorLink).toContain("/gantt/p/");
    expect(created.viewerLink).toContain("/gantt/p/");

    adminLink = created.adminLink;
    slug = created.project.slug;

    adminToken = new URL("http://localhost" + adminLink).searchParams.get("access")!;
    editorToken = new URL("http://localhost" + created.editorLink).searchParams.get("access")!;
    viewerToken = new URL("http://localhost" + created.viewerLink).searchParams.get("access")!;

    const rows = await testDb.select({ adminHash: ganttProjects.adminTokenHash, editorHash: ganttProjects.editTokenHash, viewerHash: ganttProjects.viewTokenHash }).from(ganttProjects).where(eq(ganttProjects.slug, slug));
    expect(rows[0].adminHash).not.toBe(adminToken);
    expect(rows[0].editorHash).not.toBe(editorToken);
    expect(rows[0].viewerHash).not.toBe(viewerToken);
    expect(rows[0].adminHash).toHaveLength(64);
  });

  it("loads project with role", async () => {
    const loaded = await caller.primaveraLite.load({ slug, access: adminToken });
    expect(loaded.role).toBe("admin");
    expect(loaded.wbsNodes.length).toBe(1);
    expect(loaded.activities.length).toBe(0);
  });

  it("editor can create an activity", async () => {
    const before = await caller.primaveraLite.load({ slug, access: editorToken });
    const created = await caller.primaveraLite.createActivity({ slug, access: editorToken, expectedRevision: before.revision, activity: { activityName: "Task A" } });
    expect(created.activity.activityName).toBe("Task A");
    expect(created.revision).toBe(before.revision + 1);
  });

  it("viewer cannot mutate", async () => {
    const loaded = await caller.primaveraLite.load({ slug, access: viewerToken });
    await expect(
      caller.primaveraLite.createActivity({ slug, access: viewerToken, expectedRevision: loaded.revision, activity: { activityName: "No" } })
    ).rejects.toThrow();
  });

  it("editor cannot archive project", async () => {
    const loaded = await caller.primaveraLite.load({ slug, access: editorToken });
    await expect(
      caller.primaveraLite.archiveProject({ slug, access: editorToken, expectedRevision: loaded.revision, confirmed: true })
    ).rejects.toThrow();
  });

  it("stale revision returns CONFLICT", async () => {
    const loaded = await caller.primaveraLite.load({ slug, access: adminToken });
    await expect(
      caller.primaveraLite.updateProjectMeta({ slug, access: adminToken, expectedRevision: loaded.revision - 1, changes: { name: "Old" } })
    ).rejects.toThrow(/updated by another user|CONFLICT/);
  });

  it("admin can archive project after dry-run", async () => {
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 Archive Project" });
    const freshSlug = fresh.project.slug;
    const freshAdmin = new URL("http://localhost" + fresh.adminLink).searchParams.get("access")!;
    const freshEditor = new URL("http://localhost" + fresh.editorLink).searchParams.get("access")!;
    const loaded = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    await caller.primaveraLite.createActivity({ slug: freshSlug, access: freshEditor, expectedRevision: loaded.revision, activity: { activityName: "Activity to archive" } });
    const loaded2 = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const dryRun = await caller.primaveraLite.archiveProjectDryRun({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded2.revision });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.wouldArchive.activities).toBeGreaterThanOrEqual(1);

    const archived = await caller.primaveraLite.archiveProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded2.revision, confirmed: true });
    expect(archived.project.archivedAt).toBeTruthy();

    await expect(caller.primaveraLite.load({ slug: freshSlug, access: new URL("http://localhost" + fresh.viewerLink).searchParams.get("access")! })).rejects.toThrow();
  });

  it("cross-project IDs rejected", async () => {
    const other = await caller.primaveraLite.createProject({ name: "Other PR1" });
    const otherToken = new URL("http://localhost" + other.adminLink).searchParams.get("access")!;
    const loaded = await caller.primaveraLite.load({ slug: other.project.slug, access: otherToken });
    await expect(
      caller.primaveraLite.updateActivity({ slug: other.project.slug, access: otherToken, expectedRevision: loaded.revision, activityId: 999999, changes: {} })
    ).rejects.toThrow();
  });
});
