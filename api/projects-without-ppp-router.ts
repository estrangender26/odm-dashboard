import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./queries/connection";
import { projectsWithoutPPP, projectWithoutPPPFiles } from "@db/schema";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import { projectWithoutPPPSchema } from "../src/modules/projects-without-ppp/validation";

// Tables are created exclusively through the standard Drizzle migration
// journal (db/migrations/0031_projects_without_ppp.sql). The router must not
// auto-create tables at runtime.

const projectMetadata = {
  id: projectsWithoutPPP.id,
  trackingId: projectsWithoutPPP.trackingId,
  psCode: projectsWithoutPPP.psCode,
  codingMask: projectsWithoutPPP.codingMask,
  projectPhase: projectsWithoutPPP.projectPhase,
  latestMilestone: projectsWithoutPPP.latestMilestone,
  subPhase: projectsWithoutPPP.subPhase,
  pmHeadline: projectsWithoutPPP.pmHeadline,
  workPackage: projectsWithoutPPP.workPackage,
  contractPackage: projectsWithoutPPP.contractPackage,
  contractor: projectsWithoutPPP.contractor,
  majorProjectTag: projectsWithoutPPP.majorProjectTag,
  constructionManager: projectsWithoutPPP.constructionManager,
  projectManager: projectsWithoutPPP.projectManager,
  withLSPs: projectsWithoutPPP.withLSPs,
  amdGridHead: projectsWithoutPPP.amdGridHead,
  submittedBy: projectsWithoutPPP.submittedBy,
  createdAt: projectsWithoutPPP.createdAt,
  updatedAt: projectsWithoutPPP.updatedAt,
};

export const projectsWithoutPPPRouter = createRouter({
  list: publicQuery.query(async () => {
    const rows = await db.select(projectMetadata).from(projectsWithoutPPP).orderBy(projectsWithoutPPP.trackingId);
    return { items: rows, count: rows.length };
  }),

  get: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await db.select().from(projectsWithoutPPP).where(eq(projectsWithoutPPP.id, input.id)).limit(1);
      if (!rows[0]) return null;
      const files = await db.select({
        id: projectWithoutPPPFiles.id,
        projectId: projectWithoutPPPFiles.projectId,
        fileName: projectWithoutPPPFiles.fileName,
        fileType: projectWithoutPPPFiles.fileType,
        fileSize: projectWithoutPPPFiles.fileSize,
        storagePath: projectWithoutPPPFiles.storagePath,
        storageBucket: projectWithoutPPPFiles.storageBucket,
        storageMimeType: projectWithoutPPPFiles.storageMimeType,
        uploadedBy: projectWithoutPPPFiles.uploadedBy,
        uploadedAt: projectWithoutPPPFiles.uploadedAt,
      }).from(projectWithoutPPPFiles).where(eq(projectWithoutPPPFiles.projectId, input.id));
      return { ...rows[0], files };
    }),

  create: authedQuery
    .input(projectWithoutPPPSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await db.insert(projectsWithoutPPP).values({
        trackingId: input.trackingId,
        psCode: input.psCode,
        codingMask: input.codingMask || null,
        projectPhase: input.projectPhase,
        latestMilestone: input.latestMilestone || null,
        subPhase: input.subPhase || null,
        pmHeadline: input.pmHeadline || null,
        workPackage: input.workPackage || null,
        contractPackage: input.contractPackage || null,
        contractor: input.contractor || null,
        majorProjectTag: input.majorProjectTag || null,
        constructionManager: input.constructionManager || null,
        projectManager: input.projectManager || null,
        withLSPs: input.withLSPs,
        amdGridHead: input.amdGridHead || null,
        submittedBy: ctx.user?.name || null,
      }).returning(projectMetadata);
      return result[0];
    }),

  update: authedQuery
    .input(z.object({
      id: z.number(),
      trackingId: z.string().min(1).max(50).optional(),
      psCode: z.string().min(1).max(50).optional(),
      codingMask: z.string().max(50).optional(),
      projectPhase: z.string().optional(),
      latestMilestone: z.string().optional(),
      subPhase: z.string().optional(),
      pmHeadline: z.string().max(255).optional(),
      workPackage: z.string().max(500).optional(),
      contractPackage: z.string().max(500).optional(),
      contractor: z.string().max(255).optional(),
      majorProjectTag: z.string().max(100).optional(),
      constructionManager: z.string().max(255).optional(),
      projectManager: z.string().max(255).optional(),
      withLSPs: z.boolean().optional(),
      amdGridHead: z.string().max(255).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const clean: Record<string, unknown> = {};
      if (data.trackingId !== undefined) clean.trackingId = data.trackingId;
      if (data.psCode !== undefined) clean.psCode = data.psCode;
      if (data.codingMask !== undefined) clean.codingMask = data.codingMask || null;
      if (data.projectPhase !== undefined) clean.projectPhase = data.projectPhase;
      if (data.latestMilestone !== undefined) clean.latestMilestone = data.latestMilestone || null;
      if (data.subPhase !== undefined) clean.subPhase = data.subPhase || null;
      if (data.pmHeadline !== undefined) clean.pmHeadline = data.pmHeadline || null;
      if (data.workPackage !== undefined) clean.workPackage = data.workPackage || null;
      if (data.contractPackage !== undefined) clean.contractPackage = data.contractPackage || null;
      if (data.contractor !== undefined) clean.contractor = data.contractor || null;
      if (data.majorProjectTag !== undefined) clean.majorProjectTag = data.majorProjectTag || null;
      if (data.constructionManager !== undefined) clean.constructionManager = data.constructionManager || null;
      if (data.projectManager !== undefined) clean.projectManager = data.projectManager || null;
      if (data.withLSPs !== undefined) clean.withLSPs = data.withLSPs;
      if (data.amdGridHead !== undefined) clean.amdGridHead = data.amdGridHead || null;
      clean.submittedBy = ctx.user?.name || null;
      clean.updatedAt = new Date();
      const result = await db.update(projectsWithoutPPP).set(clean).where(eq(projectsWithoutPPP.id, id)).returning(projectMetadata);
      return result[0];
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(projectsWithoutPPP).where(eq(projectsWithoutPPP.id, input.id));
      return { deleted: true, id: input.id };
    }),

  attachFileRecord: authedQuery
    .input(z.object({
      projectId: z.number(),
      fileName: z.string().min(1).max(255),
      fileType: z.string().optional(),
      fileSize: z.number().int().nonnegative().optional(),
      storageBucket: z.string().optional(),
      storagePath: z.string().optional(),
      storageMimeType: z.string().optional(),
      storageSize: z.number().int().nonnegative().optional(),
      storageEtag: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.insert(projectWithoutPPPFiles).values({
        projectId: input.projectId,
        fileName: input.fileName,
        fileType: input.fileType || null,
        fileSize: input.fileSize || null,
        uploadedBy: ctx.user?.name || null,
        storageBucket: input.storageBucket || null,
        storagePath: input.storagePath || null,
        storageMimeType: input.storageMimeType || null,
        storageSize: input.storageSize || null,
        storageEtag: input.storageEtag || null,
        storageProvider: input.storageBucket ? "supabase" : null,
        storageUploadedAt: input.storageBucket ? new Date() : null,
      }).returning({ id: projectWithoutPPPFiles.id });
      return result[0];
    }),

  listFiles: publicQuery
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return db.select({
        id: projectWithoutPPPFiles.id,
        projectId: projectWithoutPPPFiles.projectId,
        fileName: projectWithoutPPPFiles.fileName,
        fileType: projectWithoutPPPFiles.fileType,
        fileSize: projectWithoutPPPFiles.fileSize,
        storagePath: projectWithoutPPPFiles.storagePath,
        storageBucket: projectWithoutPPPFiles.storageBucket,
        storageMimeType: projectWithoutPPPFiles.storageMimeType,
        uploadedBy: projectWithoutPPPFiles.uploadedBy,
        uploadedAt: projectWithoutPPPFiles.uploadedAt,
      }).from(projectWithoutPPPFiles).where(eq(projectWithoutPPPFiles.projectId, input.projectId));
    }),

  seed: authedQuery.mutation(async () => {
    const existing = await db.select().from(projectsWithoutPPP);
    if (existing.length > 0) return { seeded: false, reason: "Projects already exist" };

    const demos = [
      { trackingId: "RR18-0616-01-01", psCode: "2024-0348", codingMask: "A1-ES-20240348", projectPhase: "Construction", latestMilestone: "Ongoing", subPhase: "North", pmHeadline: "North", workPackage: "Hinulugang Taktak Package 1-Terminal PS", contractPackage: "Hinulugang Taktak Package 1 Pumping Station- Mechanical Works", contractor: "PHILPOWER KONSTRUCT INC.", majorProjectTag: "HINULUGANG TAKTAK", constructionManager: "Lon Angco", projectManager: "Francis Cruz", withLSPs: true, amdGridHead: "Joey Delos Santos" },
      { trackingId: "RR23-0047-03-04", psCode: "2023-0592", codingMask: "B1-WS-20230592", projectPhase: "Completed", latestMilestone: "Physically Completed", subPhase: "North", pmHeadline: "No PM", workPackage: "San Mateo STP - Electromech", contractPackage: "San Mateo STP - Electromech", contractor: "AQUADRILL INC.", majorProjectTag: "DEEPWELL", constructionManager: "Edcel Colon", projectManager: "No PM", withLSPs: false, amdGridHead: "Joey Delos Santos" },
    ];

    await db.insert(projectsWithoutPPP).values(demos.map(d => ({ ...d, submittedBy: "system" })));
    return { seeded: true, count: demos.length };
  }),
});