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
};

export type DeckGenerationContext = {
  generatedBy: string;
  reportingMonth?: string;
  businessUnit?: string;
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
