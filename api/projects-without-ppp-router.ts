import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./queries/connection";
import { projectWithoutPPPFiles, projectsWithoutPPP } from "@db/schema";
import { adminQuery, authedQuery, createRouter, publicQuery } from "./middleware";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  getDecodedBase64ByteLength,
  isBase64UploadSizeAllowed,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";
import { validateUploadDescriptor } from "./storage-validation";
import {
  computeSubmissionAggregates,
  countDistinctProjectsSubmittedInWindow,
  deriveProjectSubmissionStatus,
  startOfUtcDay,
  startOfUtcWeek,
} from "./projects-without-ppp-status";

// Tables are created exclusively through the standard Drizzle migration
// journal (db/migrations/0031_projects_without_ppp_submittal_monitoring.sql).
// The router must not auto-create tables at runtime.

const projectColumns = {
  id: projectsWithoutPPP.id,
  trackingId: projectsWithoutPPP.trackingId,
  psCode: projectsWithoutPPP.psCode,
  codingMask: projectsWithoutPPP.codingMask,
  projectPhase: projectsWithoutPPP.projectPhase,
  latestMilestone: projectsWithoutPPP.latestMilestone,
  pmHeadline: projectsWithoutPPP.pmHeadline,
  projectName: projectsWithoutPPP.projectName,
  workPackage: projectsWithoutPPP.workPackage,
  contractPackage: projectsWithoutPPP.contractPackage,
  contractor: projectsWithoutPPP.contractor,
  majorProjectTag: projectsWithoutPPP.majorProjectTag,
  constructionManager: projectsWithoutPPP.constructionManager,
  projectManager: projectsWithoutPPP.projectManager,
  withLSPs: projectsWithoutPPP.withLSPs,
  amdGridHead: projectsWithoutPPP.amdGridHead,
  createdAt: projectsWithoutPPP.createdAt,
  updatedAt: projectsWithoutPPP.updatedAt,
};

const currentFileColumns = {
  id: projectWithoutPPPFiles.id,
  projectId: projectWithoutPPPFiles.projectId,
  fileName: projectWithoutPPPFiles.fileName,
  fileType: projectWithoutPPPFiles.fileType,
  fileSize: projectWithoutPPPFiles.fileSize,
  storageBucket: projectWithoutPPPFiles.storageBucket,
  storagePath: projectWithoutPPPFiles.storagePath,
  storageMimeType: projectWithoutPPPFiles.storageMimeType,
  uploadedBy: projectWithoutPPPFiles.uploadedBy,
  submittedAt: projectWithoutPPPFiles.submittedAt,
};

export const projectsWithoutPPPRouter = createRouter({
  /**
   * Monitoring-first dashboard: KPIs (over the full authoritative population)
   * plus every project row with its DERIVED masterdata submission status.
   * Filtering is applied client-side over the returned rows; filter options are
   * populated from actual data.
   */
  dashboard: publicQuery.query(async () => {
    const projects = await db
      .select(projectColumns)
      .from(projectsWithoutPPP)
      .orderBy(projectsWithoutPPP.trackingId);

    const currentFiles = await db
      .select(currentFileColumns)
      .from(projectWithoutPPPFiles)
      .where(isNull(projectWithoutPPPFiles.supersededAt));

    const filesByProject = new Map<number, typeof currentFiles>();
    for (const file of currentFiles) {
      const list = filesByProject.get(file.projectId) ?? [];
      list.push(file);
      filesByProject.set(file.projectId, list);
    }

    const items = projects.map((project) => {
      const files = (filesByProject.get(project.id) ?? []).slice();
      files.sort(
        (a, b) =>
          new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime(),
      );
      const latest = files[0] ?? null;
      return {
        ...project,
        status: deriveProjectSubmissionStatus(files.length),
        fileCount: files.length,
        latestSubmission: latest
          ? {
              id: latest.id,
              fileName: latest.fileName,
              fileSize: latest.fileSize,
              submittedBy: latest.uploadedBy,
              submittedAt: latest.submittedAt,
            }
          : null,
      };
    });

    const aggregates = computeSubmissionAggregates(items.map((r) => r.status));
    const now = new Date();
    const submittedToday = countDistinctProjectsSubmittedInWindow(
      currentFiles,
      startOfUtcDay(now),
      now,
    );
    const submittedThisWeek = countDistinctProjectsSubmittedInWindow(
      currentFiles,
      startOfUtcWeek(now),
      now,
    );

    const distinct = <T,>(values: readonly (T | null | undefined)[]): T[] =>
      [...new Set(values.filter((v): v is T => v !== null && v !== undefined))].sort();

    const filterOptions = {
      projectPhases: distinct(projects.map((p) => p.projectPhase)),
      majorProjectTags: distinct(projects.map((p) => p.majorProjectTag)),
      contractors: distinct(projects.map((p) => p.contractor)),
      constructionManagers: distinct(projects.map((p) => p.constructionManager)),
      projectManagers: distinct(projects.map((p) => p.projectManager)),
      amdGridHeads: distinct(projects.map((p) => p.amdGridHead)),
      withLSPs: ["yes", "no"],
      submissionStatuses: ["submitted", "not_submitted"],
    };

    return {
      kpis: {
        totalProjects: aggregates.totalProjects,
        submitted: aggregates.submitted,
        notSubmitted: aggregates.notSubmitted,
        submissionRate: aggregates.submissionRate,
        totalFiles: currentFiles.length,
        submittedToday,
        submittedThisWeek,
      },
      items,
      filterOptions,
    };
  }),

  /**
   * Project detail: OWNER reference metadata plus all masterdata submission
   * files (current and superseded history), with derived status.
   */
  detail: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await db
        .select(projectColumns)
        .from(projectsWithoutPPP)
        .where(eq(projectsWithoutPPP.id, input.id))
        .limit(1);
      const project = rows[0];
      if (!project) return null;

      const files = await db
        .select({
          id: projectWithoutPPPFiles.id,
          projectId: projectWithoutPPPFiles.projectId,
          fileName: projectWithoutPPPFiles.fileName,
          fileType: projectWithoutPPPFiles.fileType,
          fileSize: projectWithoutPPPFiles.fileSize,
          storageBucket: projectWithoutPPPFiles.storageBucket,
          storagePath: projectWithoutPPPFiles.storagePath,
          storageMimeType: projectWithoutPPPFiles.storageMimeType,
          uploadedBy: projectWithoutPPPFiles.uploadedBy,
          uploadedAt: projectWithoutPPPFiles.uploadedAt,
          submittedAt: projectWithoutPPPFiles.submittedAt,
          supersededAt: projectWithoutPPPFiles.supersededAt,
        })
        .from(projectWithoutPPPFiles)
        .where(eq(projectWithoutPPPFiles.projectId, input.id))
        .orderBy(projectWithoutPPPFiles.submittedAt);

      const currentFiles = files.filter((f) => f.supersededAt === null);
      return {
        project,
        status: deriveProjectSubmissionStatus(currentFiles.length),
        files: files.map((f) => ({ ...f, current: f.supersededAt === null })),
      };
    }),

  /**
   * Governed fallback masterdata upload (used while the Supabase Storage
   * feature flag is disabled). Authenticated only; enforces the repository's
   * allowed formats (Excel/PDF) and the canonical 150 MB size guard.
   * Direct-storage uploads instead persist through the standard
   * authorize/resume/finalize flow (storage-router).
   */
  attachMasterdataFile: authedQuery
    .input(
      z.object({
        projectId: z.number().int().positive(),
        fileName: z.string().trim().min(1).max(255),
        fileType: z.string().trim().min(1).max(255),
        fileSize: z.number().int().nonnegative(),
        fileData: z
          .string()
          .refine(isBase64UploadSizeAllowed, MAX_UPLOAD_ERROR_MESSAGE)
          .optional(),
        storageBucket: z.string().optional(),
        storagePath: z.string().optional(),
        storageMimeType: z.string().optional(),
        storageSize: z.number().int().nonnegative().optional(),
        storageEtag: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const projects = await db
        .select({ id: projectsWithoutPPP.id })
        .from(projectsWithoutPPP)
        .where(eq(projectsWithoutPPP.id, input.projectId))
        .limit(1);
      if (!projects[0]) {
        throw new Error("Project not found.");
      }

      // Server-side format enforcement: extension + MIME via the repository's
      // canonical validator for the projects_without_ppp module.
      const descriptor = validateUploadDescriptor(
        "projects_without_ppp",
        input.fileName,
        input.fileType,
      );

      if (!isUploadFileSizeAllowed(input.fileSize)) {
        throw new Error(MAX_UPLOAD_ERROR_MESSAGE);
      }
      if (input.storageSize !== undefined && !isUploadFileSizeAllowed(input.storageSize)) {
        throw new Error(MAX_UPLOAD_ERROR_MESSAGE);
      }

      const hasFallbackData = input.fileData !== undefined && input.fileData.length > 0;
      const hasStorageEvidence =
        Boolean(input.storageBucket && input.storagePath);
      if (!hasFallbackData && !hasStorageEvidence) {
        throw new Error("Masterdata file content is required.");
      }

      // Strict base64 validation for the fallback payload: the decoded byte
      // size must be determinable, must match the declared file size, and must
      // stay within the canonical 150 MB boundary (the zod refine already
      // rejects over-limit decoded payloads). No magic-byte/content inspection
      // is performed anywhere in the repository — this is extension/MIME and
      // size validation only.
      if (hasFallbackData && input.fileData) {
        const decodedSize = getDecodedBase64ByteLength(input.fileData);
        if (decodedSize === null) {
          throw new Error("Masterdata file content is not valid base64.");
        }
        if (decodedSize !== input.fileSize) {
          throw new Error("Masterdata file size does not match the declared size.");
        }
      }

      const now = new Date();
      const result = await db
        .insert(projectWithoutPPPFiles)
        .values({
          projectId: input.projectId,
          fileName: input.fileName,
          fileType: descriptor.mimeType,
          fileSize: input.storageSize ?? input.fileSize,
          fileData: input.fileData ?? null,
          uploadedBy: ctx.user?.name ?? null,
          uploadedAt: now,
          submittedAt: now,
          storageProvider: hasStorageEvidence ? "supabase" : null,
          storageBucket: input.storageBucket ?? null,
          storagePath: input.storagePath ?? null,
          storageMimeType: input.storageMimeType ?? descriptor.mimeType,
          storageSize: input.storageSize ?? null,
          storageEtag: input.storageEtag ?? null,
          storageUploadedAt: hasStorageEvidence ? now : null,
        })
        .returning({ id: projectWithoutPPPFiles.id });
      return { fileId: result[0].id };
    }),

  /**
   * Safe removal of current submission evidence: marks a file as superseded
   * (history preserved) so the project derives back to Not Submitted when no
   * current file remains. Admin-only; there is no public file deletion.
   */
  supersedeMasterdataFile: adminQuery
    .input(z.object({ fileId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const files = await db
        .select({
          id: projectWithoutPPPFiles.id,
          projectId: projectWithoutPPPFiles.projectId,
          supersededAt: projectWithoutPPPFiles.supersededAt,
        })
        .from(projectWithoutPPPFiles)
        .where(eq(projectWithoutPPPFiles.id, input.fileId))
        .limit(1);
      const file = files[0];
      if (!file) throw new Error("File not found.");
      if (file.supersededAt !== null) {
        return { fileId: file.id, projectId: file.projectId, alreadySuperseded: true };
      }
      await db
        .update(projectWithoutPPPFiles)
        .set({ supersededAt: new Date() })
        .where(eq(projectWithoutPPPFiles.id, input.fileId));

      const remaining = await db
        .select({ id: projectWithoutPPPFiles.id })
        .from(projectWithoutPPPFiles)
        .where(
          and(
            eq(projectWithoutPPPFiles.projectId, file.projectId),
            isNull(projectWithoutPPPFiles.supersededAt),
          ),
        );
      return {
        fileId: file.id,
        projectId: file.projectId,
        status: deriveProjectSubmissionStatus(remaining.length),
        alreadySuperseded: false,
      };
    }),
});
