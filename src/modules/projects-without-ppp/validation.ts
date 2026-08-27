import { z } from "zod";
import { PROJECT_PHASES, LATEST_MILESTONES, SUB_PHASES } from "./types";

export const projectWithoutPPPSchema = z.object({
  trackingId: z.string().min(1).max(50),
  psCode: z.string().min(1).max(50),
  codingMask: z.string().max(50).optional(),
  projectPhase: z.enum(PROJECT_PHASES as unknown as [string, ...string[]]),
  latestMilestone: z.enum(LATEST_MILESTONES as unknown as [string, ...string[]]).optional(),
  subPhase: z.enum(SUB_PHASES as unknown as [string, ...string[]]).optional(),
  pmHeadline: z.string().max(255).optional(),
  workPackage: z.string().max(500).optional(),
  contractPackage: z.string().max(500).optional(),
  contractor: z.string().max(255).optional(),
  majorProjectTag: z.string().max(100).optional(),
  constructionManager: z.string().max(255).optional(),
  projectManager: z.string().max(255).optional(),
  withLSPs: z.boolean().default(false),
  amdGridHead: z.string().max(255).optional(),
});

export type ProjectWithoutPPPInput = z.infer<typeof projectWithoutPPPSchema>;