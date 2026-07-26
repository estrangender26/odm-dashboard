/**
 * Governance Template Mapping
 * 
 * Maps the approved KPI PRES template slides to the Governance presentation.
 * 
 * Template: public/templates/governance/governance-master-template.pptx
 * Source: KPI PRES(3).pptx
 */

// Template slide selection based on inspection of KPI PRES.pptx
export const GOVERNANCE_TEMPLATE_SLIDES = {
  // Slide 1: "New Facilities Onboarding" - Title slide with facility list
  title: 1,
  
  // Slide 3: "Overview" - Has facility table, good for governance overview
  overview: 3,
  
  // Slide 4: "Aglipay and HTT remain aligned at 44%" - Has facility details
  facilityDetail: 4,
  
  // Slide 15: "Reliability KPI Scorecard – AMD/EZ" - Has table structure
  deliverables: 15,
} as const;

// Shape names in the template (to be confirmed via inspection)
export const GOVERNANCE_TEMPLATE_MAP = {
  title: {
    sourceSlide: GOVERNANCE_TEMPLATE_SLIDES.title,
    // These will be populated after inspecting the actual template
    shapes: {
      title: "Title 1",
      subtitle: "Subtitle 2", 
      date: "Date 3",
      sourceLine: "Source 4",
    },
  },
  overview: {
    sourceSlide: GOVERNANCE_TEMPLATE_SLIDES.overview,
    shapes: {
      heading: "Title 1",
      chartArea: "ChartArea",
      tableArea: "TableArea",
    },
  },
  facilitySCurves: {
    sourceSlide: GOVERNANCE_TEMPLATE_SLIDES.facilityDetail,
    shapes: {
      heading: "Title 1",
      facilityPanel1: "Facility1",
      facilityPanel2: "Facility2",
      facilityPanel3: "Facility3",
      facilityPanel4: "Facility4",
    },
  },
  deliverables: {
    sourceSlide: GOVERNANCE_TEMPLATE_SLIDES.deliverables,
    shapes: {
      heading: "Title 1",
      table: "Table 1",
    },
  },
} as const;

// RAG thresholds for status calculation
export const RAG_THRESHOLDS = {
  green: {
    minVariance: -5, // Within 5% of plan
    maxOutstanding: 2,
  },
  amber: {
    minVariance: -15, // Within 15% of plan
    maxOutstanding: 5,
  },
  red: {
    // Anything worse than amber thresholds
  },
} as const;

// Facility name aliases for normalization
export const FACILITY_ALIASES: Record<string, string> = {
  "AGLIPAY STP": "aglipay",
  "Aglipay STP": "aglipay",
  "HTT STP": "htt",
  "HTT Sewage Treatment Plant": "htt",
  "EASTBAY PH-2 TP": "eastbay",
  "Eastbay Phase 2 Treatment Plant": "eastbay",
  "Eastbay PH-2 TP": "eastbay",
  "KAYSAKAT TP": "kaysakat",
  "Kaysakat Treatment Plant": "kaysakat",
} as const;

/**
 * Normalize facility name to canonical slug
 */
export function normalizeFacilityName(name: string): string {
  const normalized = FACILITY_ALIASES[name];
  if (normalized) return normalized;
  
  // Fallback: lowercase and remove special chars
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Calculate RAG status based on variance and outstanding items
 */
export function calculateRAG(
  variance: number | null,
  outstanding: number,
  hasBaseline: boolean
): "green" | "amber" | "red" | "gray" {
  if (!hasBaseline) return "gray";
  if (variance === null) return "gray";
  
  // Red conditions
  if (variance < RAG_THRESHOLDS.amber.minVariance) return "red";
  if (outstanding > RAG_THRESHOLDS.amber.maxOutstanding) return "red";
  
  // Amber conditions
  if (variance < RAG_THRESHOLDS.green.minVariance) return "amber";
  if (outstanding > RAG_THRESHOLDS.green.maxOutstanding) return "amber";
  
  return "green";
}
