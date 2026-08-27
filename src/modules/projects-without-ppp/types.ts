export type MasterdataSubmissionStatus = "submitted" | "not_submitted";

export interface ProjectWithoutPPPReference {
  id: number;
  trackingId: string;
  psCode: string;
  codingMask: string | null;
  projectPhase: string;
  latestMilestone: string | null;
  pmHeadline: string | null;
  projectName: string | null;
  workPackage: string | null;
  contractPackage: string | null;
  contractor: string | null;
  majorProjectTag: string | null;
  constructionManager: string | null;
  projectManager: string | null;
  withLSPs: boolean;
  amdGridHead: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface LatestSubmissionSummary {
  id: number;
  fileName: string;
  fileSize: number | null;
  submittedBy: string | null;
  submittedAt: Date | null;
}

export interface ProjectWithoutPPPRow extends ProjectWithoutPPPReference {
  status: MasterdataSubmissionStatus;
  fileCount: number;
  latestSubmission: LatestSubmissionSummary | null;
}

export interface ProjectWithoutPPPKpis {
  totalProjects: number;
  submitted: number;
  notSubmitted: number;
  submissionRate: number;
  totalFiles: number;
  submittedToday: number;
  submittedThisWeek: number;
}

export interface ProjectWithoutPPPDashboardFilterOptions {
  projectPhases: string[];
  majorProjectTags: string[];
  contractors: string[];
  constructionManagers: string[];
  projectManagers: string[];
  amdGridHeads: string[];
  withLSPs: string[];
  submissionStatuses: string[];
}

export interface ProjectWithoutPPPDashboard {
  kpis: ProjectWithoutPPPKpis;
  items: ProjectWithoutPPPRow[];
  filterOptions: ProjectWithoutPPPDashboardFilterOptions;
}

export interface ProjectMasterdataFile {
  id: number;
  projectId: number;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  storageBucket: string | null;
  storagePath: string | null;
  storageMimeType: string | null;
  uploadedBy: string | null;
  uploadedAt: Date | null;
  submittedAt: Date | null;
  supersededAt: Date | null;
  current: boolean;
}

export interface ProjectWithoutPPPDetail {
  project: ProjectWithoutPPPReference;
  status: MasterdataSubmissionStatus;
  files: ProjectMasterdataFile[];
}
