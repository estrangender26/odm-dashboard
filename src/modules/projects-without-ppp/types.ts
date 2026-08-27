export interface ProjectWithoutPPP {
  id: number;
  trackingId: string;
  psCode: string;
  codingMask: string | null;
  projectPhase: string;
  latestMilestone: string | null;
  subPhase: string | null;
  pmHeadline: string | null;
  workPackage: string | null;
  contractPackage: string | null;
  contractor: string | null;
  majorProjectTag: string | null;
  constructionManager: string | null;
  projectManager: string | null;
  withLSPs: boolean;
  amdGridHead: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface ProjectSubmissionForm {
  trackingId: string;
  psCode: string;
  codingMask: string;
  projectPhase: string;
  latestMilestone: string;
  subPhase: string;
  pmHeadline: string;
  workPackage: string;
  contractPackage: string;
  contractor: string;
  majorProjectTag: string;
  constructionManager: string;
  projectManager: string;
  withLSPs: boolean;
  amdGridHead: string;
  submittedBy?: string | null;
}

export interface ProjectFileAttachment {
  id: number;
  projectId: number;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  storagePath: string | null;
  storageBucket: string | null;
  storageMimeType: string | null;
  storageSize: number | null;
  storageEtag: string | null;
  uploadedBy: string | null;
  uploadedAt: Date | string | null;
}

export const PROJECT_PHASES = [
  "Construction",
  "Completed",
  "Planning",
  "Procurement",
  "Design",
  "Commissioning",
] as const;

export const LATEST_MILESTONES = [
  "Ongoing",
  "Physically Completed",
  "For Inspection",
  "For Testing",
  "For Turnover",
  "On Hold",
] as const;

export const SUB_PHASES = [
  "North",
  "South",
  "East",
  "West",
  "Central",
  "N/A",
] as const;