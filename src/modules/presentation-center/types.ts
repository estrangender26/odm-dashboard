export type PresentationCategory =
  | "Monthly KPI Scorecard"
  | "O&M Manual Library"
  | "O&M Manual Governance"
  | "Post-PPP Planning"
  | "Maintenance Planning"
  | "Standard Maintenance Procedures"
  | "Gantt Planner"
  | "Operator Driven Maintenance"
  | "Executive Dashboard"
  | "Uploaded Deck"
  | "Other";

export type UploadedPresentation = {
  id: string;
  name: string;
  uploadDate: string;
  uploadedBy: string;
  size: number;
  category: PresentationCategory;
  dataUrl: string;
};

export type GeneratedPresentation = {
  id: string;
  name: string;
  type: string;
  generatedDate: string;
  generatedBy: string;
  size: number;
  dataUrl: string;
  generatorId?: string;
  generatorName?: string;
  reportingYear?: number;
  reportingMonth?: number;
  businessUnit?: string;
  facility?: string;
  template?: string;
  filename?: string;
  generatedAt?: string;
};

export type MonthlyKpiTemplate = "Executive Scorecard";
export type OdmTemplate = "Executive Summary";
export type PresentationTemplate = MonthlyKpiTemplate | OdmTemplate;

export type DeckGenerationContext = {
  generatedBy: string;
  reportingYear?: number;
  reportingMonth?: number;
  businessUnit?: string;
  facility?: string;
  template?: PresentationTemplate;
};

export type DeckGeneratorStatus = "active" | "coming-soon";

export type DeckGenerator = {
  id: string;
  title: string;
  description: string;
  category: PresentationCategory;
  status: DeckGeneratorStatus;
  slideOutline: string[];
  enabled: boolean;
  generate?: (context: DeckGenerationContext) => Promise<GeneratedPresentation>;
};
