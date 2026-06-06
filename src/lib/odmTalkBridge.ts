import type { DashboardContext } from "@/components/AIAssistant";

export const ODM_TALK_THREAD_TYPES = [
  "General Discussion",
  "Maintenance Recommendation",
  "KPI Insight",
  "Risk Review",
  "Action Tracking",
  "Ownership Review",
  "Post-PPP Decision",
  "Gantt Coordination",
  "Manual Governance Review",
] as const;

export const ODM_TALK_SHARE_TYPES = [
  "AI recommendation",
  "AI summary",
  "AI-generated action items",
  "Risk",
  "Decision",
  "Maintenance recommendation",
  "Ownership recommendation",
  "KPI insight",
] as const;

export type OdmTalkThreadType = (typeof ODM_TALK_THREAD_TYPES)[number];
export type OdmTalkShareType = (typeof ODM_TALK_SHARE_TYPES)[number];

export type SourceModule =
  | "Maintenance Planning"
  | "Post-PPP Planning"
  | "Monthly KPI Scorecard"
  | "O&M Manual Governance"
  | "Gantt Charts"
  | "Existing Facilities Maintenance Plans"
  | "Standard Maintenance Procedures"
  | "Inspection Findings"
  | "Help";

export interface OdmTalkSourceMetadata {
  sourceModule: SourceModule;
  sourcePage: string;
  sourceRecordId: string;
  sourceRecordLabel?: string;
  sourceUrl: string;
  assistantName: string;
}

const CONTEXT_SOURCE_MODULE: Record<DashboardContext, SourceModule> = {
  maintenance: "Existing Facilities Maintenance Plans",
  gantt: "Gantt Charts",
  inspection: "Inspection Findings",
  smp: "Standard Maintenance Procedures",
  manuals: "O&M Manual Governance",
  scorecard: "Monthly KPI Scorecard",
  governance: "O&M Manual Governance",
  help: "Help",
  postPlanningInsights: "Post-PPP Planning",
};

const CONTEXT_ASSISTANT_NAME: Record<DashboardContext, string> = {
  maintenance: "Maintenance Planning AI",
  gantt: "Gantt AI",
  inspection: "Existing Facilities AI",
  smp: "SMP AI",
  manuals: "O&M Governance AI",
  scorecard: "Monthly KPI AI",
  governance: "O&M Governance AI",
  help: "Help AI",
  postPlanningInsights: "Post-PPP Planning AI",
};

export function inferOdmTalkSource(
  contextType: DashboardContext,
  title?: string,
  metadata?: Record<string, unknown>,
  filters?: Record<string, unknown>,
): OdmTalkSourceMetadata {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const search = typeof window !== "undefined" ? window.location.search : "";
  const page = `${path}${search}`;
  const sourceModule = (metadata?.sourceModule as SourceModule | undefined) || CONTEXT_SOURCE_MODULE[contextType];
  const assistantName = title || (metadata?.assistantName as string | undefined) || CONTEXT_ASSISTANT_NAME[contextType];
  const sourceRecordId = String(
    metadata?.sourceRecordId ||
      metadata?.currentProjectId ||
      metadata?.facilityName ||
      filters?.facility ||
      filters?.activePlant ||
      filters?.plant ||
      contextType,
  );
  const sourceRecordLabel = String(
    metadata?.sourceRecordLabel ||
      metadata?.currentProjectName ||
      metadata?.facilityName ||
      filters?.activePlant ||
      filters?.facility ||
      sourceRecordId,
  );

  return {
    sourceModule,
    sourcePage: page,
    sourceRecordId,
    sourceRecordLabel,
    sourceUrl: page,
    assistantName,
  };
}

export function formatOdmTalkAiPost(content: string, source: OdmTalkSourceMetadata) {
  return [
    "AI Generated",
    `Assistant Name: ${source.assistantName}`,
    `Module Name: ${source.sourceModule}`,
    `Source Module: ${source.sourceModule}`,
    `Source Record: ${source.sourceRecordLabel || source.sourceRecordId}`,
    `Open Source Record: ${source.sourceUrl}`,
    "",
    content,
  ].join("\n");
}
