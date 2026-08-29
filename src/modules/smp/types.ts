/**
 * Shared types for the SMP controlled-document repository module.
 * These mirror the tRPC router responses (api/smp-router.ts).
 */

export type SmpCriticality = "A" | "B" | "C" | string;

export type SmpStatus = "current" | "superseded" | string;

export interface SmpRevision {
  id: number;
  documentId: number;
  revision: string;
  revisionNumber: number;
  status: SmpStatus;
  effectivityDate: string | Date | null;
  supersededByRevisionId: number | null;
  originalFileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  uploadedBy: string | null;
  uploadedAt: string | Date | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  storageBucket: string | null;
  storagePath: string | null;
  hasFile: boolean;
}

export interface SmpDocumentListItem {
  id: number;
  code: string; // reference number
  smpId: string | null;
  title: string;
  smpFamily: string | null;
  assetName: string | null;
  assetType: string | null;
  equipmentType: string | null;
  facilityType: string | null;
  applicability: string[];
  criticality: SmpCriticality | null;
  documentOwner: string | null;
  preparedBy: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;
  effectivityDate: string | Date | null;
  revision: string | null;
  status: string | null;
  system: string | null;
  dateIssued: string | null;
  nextReview: string | null;
  responsibleParty: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileType: string | null;
  uploadedBy: string | null;
  uploadedAt: string | Date | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  revisionCount: number;
  hasCurrentRevision: boolean;
}

export interface SmpSection {
  id: number;
  documentId: number;
  sectionKey: string;
  title: string;
  body: string | null;
  position: number;
}

export type SmpTaskCategory = "operator_driven" | "technician_pm" | "technician_cbm" | "corrective";

export interface SmpTask {
  id: number;
  documentId: number;
  revisionId: number | null;
  category: string;
  responsibilityType: string | null;
  maintenanceClass: string | null;
  taskText: string;
  frequency: string | null;
  toolsMaterials: string | null;
  safetyControls: string | null;
  fieldCaptureData: unknown;
  escalationTrigger: string | null;
  failureMode: string | null;
  displayOrder: number;
  applicabilityTags: string[];
}

export interface SmpDetail {
  document: SmpDocumentListItem;
  revisions: SmpRevision[];
  sections: SmpSection[];
  tasks: SmpTask[];
}

export interface SmpFamily {
  id: number;
  name: string;
  code: string | null;
  typicalEquipment: string[];
  suggestedTags: string[];
  sortOrder: number;
}

export interface SmpListResult {
  items: SmpDocumentListItem[];
  count: number;
  filters: {
    families: string[];
    equipmentTypes: string[];
    facilityTypes: string[];
    criticalities: string[];
    revisions: string[];
    statuses: string[];
  };
}

export interface SmpListInput {
  search?: string;
  family?: string;
  equipmentType?: string;
  facilityType?: string;
  criticality?: string;
  revision?: string;
  status?: string;
}

export interface SmpMetadataInput {
  code: string;
  title: string;
  smpId?: string;
  smpFamily?: string;
  assetName?: string;
  assetType?: string;
  equipmentType?: string;
  facilityType?: string;
  applicability?: string[];
  criticality?: string;
  documentOwner?: string;
  preparedBy?: string;
  reviewedBy?: string;
  approvedBy?: string;
}

export const SMP_TASK_CATEGORY_LABELS: Record<SmpTaskCategory, string> = {
  operator_driven: "Operator Driven Tasks",
  technician_pm: "Technician Tasks — Preventive Maintenance",
  technician_cbm: "Technician Tasks — Condition-Based Maintenance",
  corrective: "Corrective Maintenance",
};
